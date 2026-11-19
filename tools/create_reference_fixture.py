"""Generate a synthetic layered model for testing the review contract in Blender."""
import json
import sys
from pathlib import Path

import bpy

target = Path(sys.argv[-1]).resolve()
target.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def group(name):
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    return parent


def shape(parent, name, location, scale, color, kind="cube"):
    if kind == "torus":
        bpy.ops.mesh.primitive_torus_add(location=location)
    else:
        bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.parent = parent
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    obj.data.materials.append(material)


housing = group("Housing")
shape(housing, "Base", (0, 0, -.19), (.55, .34, .055), (.17, .42, .56))
shape(housing, "Guide rail", (-.30, 0, -.06), (.06, .30, .09), (.19, .44, .49))
shape(housing, "Unlisted bracket", (.39, 0, -.06), (.045, .23, .10), (.29, .34, .46))
rotor = group("Rotor")
shape(rotor, "Ring", (.06, 0, .03), (.21, .21, .13), (.66, .32, .13), "torus")
shape(rotor, "Hub", (.06, 0, .03), (.06, .06, .07), (.66, .57, .26))
cover = group("Cover")
shape(cover, "Lid", (0, 0, .24), (.56, .35, .04), (.50, .62, .68))
bpy.ops.wm.save_as_mainfile(filepath=str(target/"fixture.blend"))
bpy.ops.export_scene.gltf(filepath=str(target/"fixture.glb"), export_format="GLB", export_cameras=False)
(target/"metadata.json").write_text(json.dumps({
    "title": "Synthetic assembly reference",
    "status": "Fixture · review only",
    "modes": {"assembled": ["Housing","Rotor","Cover"], "internal": ["Housing","Rotor"]},
    "modeLabels": {"assembled":"Assembled","internal":"Internal"},
    "defaultMode":"internal",
    "parts": [
        {"node":"Housing","label":"Housing","offset":[-.70,0,0],
         "description":"Supports the internal assembly.", "evidence":"Synthetic dimensions. The guide geometry is illustrative.",
         "sources":[{"label":"Synthetic reference URL","url":"https://example.org/"}],
         "structures":[{"node":"Base","label":"Base"},{"node":"Guide rail","label":"Guide rail"}]},
        {"node":"Rotor","label":"Rotor","offset":[.70,0,0],
         "structures":[{"node":"Ring","label":"Ring"},{"node":"Hub","label":"Hub"}]},
    ],
}, indent=2)+"\n")
