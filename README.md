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

## Photo-based refinement

Use reference photos and published dimensions to refine a model, then prepare a multipart review of each revision. Record the source, model revision, datum, and the view used for each measurement. Calibrate each image axis with a known dimension in the same plane, or rectify the image first. Keep matched top, side, or underside renders and an exploded view alongside the results. Mark hidden geometry and dimensions inferred from perspective as estimates.

The landmark tool reads world-space XYZ bounds in millimeters from your modeling script. A synthetic geometry input looks like this:

```json
{"units": "mm", "part_bounds_xyz_mm": {"Plate": [[-20, 0, 0], [20, 20, 3]]}}
```

Provide a separate landmark list. Readings for `center`, `min`, and `max` are signed pixel offsets from the aligned datum. `span` is a width along the indicated axis. Use `fit` for measurements used to tune the model and `holdout` for independent checks.

```json
[
  {
    "feature": "Plate width", "part": "Plate", "axis": "x", "kind": "span",
    "basis": "fit", "reading_px": 80, "allowance_px": 2,
    "calibration": {"span_px": 80, "span_mm": 40}
  }
]
```

```sh
python3 -m tools.compare_landmarks geometry.json landmarks.json > landmark-report.json
```

The installed command is `interactive-view-compare-landmarks`. The report gives per-feature errors and pixel-reading allowances converted to millimeters. Perspective, depth, and calibration uncertainty require separate assessment. Whole-model fidelity requires a defined metric and independent surface coverage. Review the same revision with Explode, Inspect part, and Reassemble to verify viewer behavior.

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

## Source-linked layered inspection

Prepare a package from an existing GLB and the review metadata that describes its scene.

```sh
python3 tools/prepare_review.py <model.glb> --metadata <metadata.json> \
  --output <review-directory> --no-screenshot
python3 -m http.server <port> --bind 127.0.0.1 --directory <review-directory>
```

Add `--three-dir <three-package-directory>` to bundle the pinned Three.js modules for offline review. Get the matching package with `npm pack three@0.180.0` and extract it to an isolated dependency directory. The existing `--parts` option can also override the part list. See the [viewer metadata contract](viewer/README.md).

For a runnable example, generate the synthetic cube-and-ring assembly with Blender 4.5 LTS. The fixture includes two presets, nested parts, an intentionally unlisted child, and an example citation.

```sh
blender -b --factory-startup --python-exit-code 1 --python tools/create_reference_fixture.py -- <fixture-directory>
```

Prepare its `fixture.glb` and `metadata.json` using the command above. Run `node tests/check_reference_review.mjs <review-url> <evidence-directory> <playwright-module>` with Node.js, Playwright, its Chromium installation, and an offline-prepared package to check the rendered viewer.
