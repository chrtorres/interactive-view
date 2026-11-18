# interactive-view

Prepare a local Three.js review from a 3D model file. The tool generates a browser-ready `model.glb`, writes review metadata, and creates a PNG screenshot by default. Multipart reviews support exploded and individual-part inspection.

## Quick start

```sh
python3 -m tools.prepare_review \
  path/to/model.blend \
  --output review
```

The generated `review/` directory contains the standalone viewer, `model.glb`, `metadata.json`, and `preview.png`. To inspect the model after preparation, serve that directory and open `http://127.0.0.1:8765/` in your browser.

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory review
```

Supported inputs:

- `.glb`: copied directly into the review package.
- `.blend`, `.stl`, `.obj`, `.ply`: imported/exported through Blender.

Conversion inputs require Blender. The screenshot and interactive review require a Chromium-compatible browser or equivalent WebGL support, plus access to the pinned Three.js CDN modules. Use `--no-screenshot` to prepare the package without launching a browser.

## Controls

Drag to orbit, scroll or pinch to zoom, right-drag to pan, and use Reset view, Auto-rotate, or Wireframe.

## Multipart review

Pass `--parts parts.json` when preparing an assembly. The file lists one inspectable part per unique top-level GLB node. Use the exported node name and a readable picker label. Offsets are display translations in GLB parent axes and units. An unlisted node stays in the assembled view and is hidden during exploded inspection.

```json
[
  {"node": "Left plate", "label": "Left plate", "offset": [-0.05, 0, 0]},
  {"node": "Right plate", "label": "Right plate", "offset": [0.05, 0, 0]}
]
```

```sh
python3 -m tools.prepare_review assembly.glb --parts parts.json --output review
```

Choose **Explode** to separate the parts, **Inspect part** to isolate and frame a piece, or **All parts** to return to the exploded overview. **Reassemble** restores the original positions and any assembly guides. When no part layout is supplied, the other viewer controls remain available.

## Print-part preview sheets

Generate an exploded sheet and an individual-part sheet from the actual print STLs. The print manifest specifies the display order, file identity, and offsets. Each file path is relative to the manifest. Offsets are in STL XYZ axes and millimeters. Pieces should share assembly axes. For a mesh moved for print placement, add an optional `assembly_translation` to recover its assembly position before applying the display offset.

```json
{
  "title": "Example assembly",
  "version": "1",
  "units": "millimeters",
  "parts": [
    {
      "file": "parts/left-plate.stl",
      "label": "Left plate",
      "sha256": "<full SHA-256 digest of left-plate.stl>",
      "offset": [-50, 0, 0]
    }
  ]
}
```

Add each individual STL to the list, then run the builder with Blender, Pillow, and DejaVu Sans available.

```sh
python3 -m tools.build_print_previews --manifest print-preview.json --output review/print-parts
```

The builder checks the hashes and writes `exploded-print-parts.png` and `individual-print-parts.png`. The individual sheet lists measured dimensions and source filenames. Preview offsets affect only the rendered display.

The installed command names are `interactive-view` and `interactive-view-print-previews`. Use `pip install '.[print]'` to install both commands with the sheet builder's optional Pillow dependency.

## Scope

This is a geometry review tool. It does not validate meshes, slice models, certify printability, estimate strength, or replace physical testing. Review files are local artifacts and are not automatically published.

## Development checks

```sh
python3 -m unittest discover -s tests -v
python3 -m py_compile tools/prepare_review.py
```
