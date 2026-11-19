"""Build small animated GLBs for playback and geometry regression checks in Blender."""

import argparse
import json
import math
from pathlib import Path
import sys

import bpy

FPS = 24
DURATION = 2.0


def bake_action(owner, name, duration, fps, evaluate):
    """Bake local pose channels from evaluate(seconds) into a stored Blender action.

    Return values map (RNA data path, component index) to a scalar for each sample.
    """
    if not math.isfinite(duration) or duration <= 0 or not isinstance(fps, int) or fps < 1:
        raise ValueError("duration and integer frame rate must be positive")
    frame_count = round(duration * fps)
    if frame_count < 1 or not math.isclose(frame_count, duration * fps, abs_tol=1e-7):
        raise ValueError("duration must span a whole number of sampled frames")
    samples = [evaluate(frame / fps) for frame in range(frame_count + 1)]
    if not samples[0] or any(sample.keys() != samples[0].keys() or
                             not all(math.isfinite(value) for value in sample.values()) for sample in samples):
        raise ValueError("every sample needs the same finite channel values")
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    slot = action.slots.new("OBJECT", owner.name)
    bag = action.layers.new("Sampled motion").strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
    for data_path, component in samples[0]:
        curve = bag.fcurves.new(data_path, index=component)
        curve.keyframe_points.add(len(samples))
        curve.keyframe_points.foreach_set("co", [
            value for i, sample in enumerate(samples)
            for value in (i + 1, sample[data_path, component])
        ])
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
        curve.update()
    data = owner.animation_data_create()
    track = data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    return action, slot


def box(name, center, dimensions, color):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    obj.data.materials.append(material)
    return obj


def articulated():
    pedestal = box("Pedestal", (0, 0, -.32), (1.35, 1.05, .18), (.16, .35, .50))
    hinge = bpy.data.objects.new("Hinge", None)
    bpy.context.collection.objects.link(hinge)
    panel = box("Panel", (.48, 0, .07), (.96, .13, .62), (.92, .32, .12))
    panel.parent = hinge

    def swing(t):
        return {("rotation_euler", 2): math.radians(95) * t / DURATION,
                ("location", 1): .30 * t / DURATION}

    def oscillate(t):
        phase = math.tau * t / DURATION
        return {("rotation_euler", 2): .64 * math.sin(phase),
                ("location", 1): .40 * (1 - math.cos(phase))}

    actions = [bake_action(hinge, "Swing", DURATION, FPS, swing),
               bake_action(hinge, "Oscillate", DURATION, FPS, oscillate)]
    return hinge, actions, {
        "title": "Hinge motion fixture",
        "animation": {"defaultClip": "Swing", "loop": False, "followNode": hinge.name,
                      "labels": {"Swing": "Open panel", "Oscillate": "Repeat swing"}},
        "parts": [
            {"node": hinge.name, "label": "Hinge and panel", "offset": [.60, 0, 0]},
            {"node": pedestal.name, "label": "Pedestal", "offset": [-.60, 0, 0]},
        ],
    }


def flexible():
    armature = bpy.data.armatures.new("Flexible rig")
    rig = bpy.data.objects.new("Flexible rig", armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    root = armature.edit_bones.new("Travel root")
    root.head, root.tail = (0, 0, 0), (0, .3, 0)
    base = armature.edit_bones.new("Base section")
    base.head, base.tail, base.parent = (0, 0, 0), (0, .5, 0), root
    tip = armature.edit_bones.new("Tip section")
    tip.head, tip.tail, tip.parent = (0, .65, 0), (0, 1.3, 0), base
    bpy.ops.object.mode_set(mode="OBJECT")

    points = []
    faces = []
    rings, sides = 19, 10
    for ring in range(rings):
        u = ring / (rings - 1)
        for side in range(sides):
            angle = math.tau * side / sides
            radius = .19 * (1 - .7 * u)
            points.append((radius * math.cos(angle), 1.3 * u, radius * math.sin(angle)))
    for ring in range(rings - 1):
        for side in range(sides):
            a, b = ring * sides + side, ring * sides + (side + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend((tuple(reversed(range(sides))), tuple(range((rings-1)*sides, rings*sides))))
    mesh = bpy.data.meshes.new("Flexible surface")
    mesh.from_pydata(points, [], faces)
    surface = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.collection.objects.link(surface)
    surface.parent = rig
    modifier = surface.modifiers.new("Skin", "ARMATURE")
    modifier.object = rig
    mat = bpy.data.materials.new("Ceramic green")
    mat.diffuse_color = (.055, .61, .33, 1)
    mesh.materials.append(mat)
    groups = [surface.vertex_groups.new(name=name) for name in ("Base section", "Tip section")]
    for ring in range(rings):
        weight = max(0, min(1, (ring / (rings - 1) - .34) / .32))
        ids = list(range(ring*sides, (ring+1)*sides))
        for group, value in zip(groups, (1-weight, weight)):
            if value:
                group.add(ids, value, "REPLACE")

    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"

    def wave(t, amplitude, travel):
        phase = math.tau * t / DURATION
        # Separate root travel from joint articulation so each can be measured independently.
        return {('pose.bones["Travel root"].location', 0): travel * (1 - math.cos(phase)),
                ('pose.bones["Base section"].rotation_euler', 2): .20 * amplitude * math.sin(phase),
                ('pose.bones["Tip section"].rotation_euler', 2): amplitude * math.sin(phase - .45)}

    actions = [
        bake_action(rig, "Traverse", DURATION, FPS, lambda t: wave(t, .70, .65)),
        bake_action(rig, "Flex", DURATION, FPS, lambda t: wave(t, .90, 0)),
    ]
    return rig, actions, {"title": "Flexible figure fixture",
                          "animation": {"defaultClip": "Traverse", "autoplay": True,
                                        "loop": True, "followNode": "Travel root"}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("articulated", "flexible"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, round(FPS * DURATION) + 1
    owner, actions, metadata = (articulated if args.kind == "articulated" else flexible)()
    scene.frame_set(scene.frame_start)
    bpy.ops.export_scene.gltf(filepath=str(out / "fixture.glb"), export_format="GLB",
                              export_animation_mode="NLA_TRACKS", export_anim_slide_to_zero=True)
    for track in list(owner.animation_data.nla_tracks):
        owner.animation_data.nla_tracks.remove(track)
    owner.animation_data.action, owner.animation_data.action_slot = actions[0]
    scene.frame_set(scene.frame_start)
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "fixture.blend"))
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    main()
