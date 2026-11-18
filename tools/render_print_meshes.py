"""Blender-side renderer for the print preview builder."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


PALETTE = ((0.18, 0.48, 0.65, 1), (0.29, 0.55, 0.51, 1),
           (0.82, 0.40, 0.18, 1), (0.43, 0.37, 0.69, 1))


def load_parts(manifest):
    config = json.loads(manifest.read_text())
    if config["units"] != "millimeters" or not config["parts"]:
        raise ValueError("List at least one individual STL in millimeters")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    parts = []
    for index, entry in enumerate(config["parts"]):
        source = manifest.parent / entry["file"]
        if (source.suffix.lower() != ".stl" or
                hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]):
            raise ValueError(f"STL identity check failed: {source}")
        bpy.ops.wm.stl_import(filepath=str(source), global_scale=1, use_scene_unit=False,
                             forward_axis="Y", up_axis="Z")
        part = bpy.context.view_layer.objects.active
        part.color = PALETTE[index % len(PALETTE)]
        bpy.context.view_layer.update()
        dimensions = list(part.dimensions)
        offset = entry["offset"]
        translation = entry.get("assembly_translation", [0, 0, 0])
        for vector in (offset, translation):
            if len(vector) != 3 or not all(math.isfinite(v) for v in vector):
                raise ValueError(f"Expected a finite XYZ translation for {source}")
        part.location += Vector(translation) + Vector(offset)
        parts.append((part, {"file": source.name, "label": entry["label"], "dimensions": dimensions}))
    return config, parts


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.display.render_aa = "32"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.studio_light = "paint.sl"
    shading.color_type = "OBJECT"
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    bpy.ops.object.camera_add()
    scene.camera = bpy.context.object
    scene.camera.data.type = "ORTHO"
    return scene


def frame_and_render(scene, parts, size, direction, path):
    camera = scene.camera
    scene.render.resolution_x, scene.render.resolution_y = size
    bpy.context.view_layer.update()
    points = [part.matrix_world @ Vector(corner) for part in parts for corner in part.bound_box]
    rotation = (-Vector(direction)).to_track_quat("-Z", "Y")
    inverse = rotation.inverted()
    projected = [inverse @ point for point in points]
    low = Vector([min(p[axis] for p in projected) for axis in range(3)])
    high = Vector([max(p[axis] for p in projected) for axis in range(3)])
    span = high - low
    scale = max(span.x, span.y * size[0] / size[1], 0.01) / 0.82
    camera.rotation_euler = rotation.to_euler()
    camera.location = rotation @ ((low + high) / 2 + Vector((0, 0, scale + span.z)))
    camera.data.ortho_scale = scale
    camera.data.clip_start = max(0.0001, scale / 10000)
    camera.data.clip_end = (scale + span.z) * 4
    bpy.context.view_layer.update()
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    config, parts = load_parts(args.manifest)
    scene = setup_scene()
    meshes = [part for part, _ in parts]
    size = (1520, 930)
    frame_and_render(scene, meshes, size, (0, -0.65, 1), args.scratch / "exploded.png")
    for part, record in parts:
        center = part.matrix_world @ (sum((Vector(c) for c in part.bound_box), Vector()) / 8)
        projected = world_to_camera_view(scene, scene.camera, center)
        record["anchor"] = [round(projected.x * size[0]), round((1 - projected.y) * size[1])]
        part.hide_render = True
    for index, (part, _) in enumerate(parts):
        part.hide_render = False
        frame_and_render(scene, [part], (480, 310), (0.24, -0.64, 1), args.scratch / f"{index}.png")
        part.hide_render = True
    (args.scratch / "rendered.json").write_text(json.dumps({
        "title": config["title"], "version": config["version"], "parts": [record for _, record in parts],
    }))


if __name__ == "__main__":
    main()
