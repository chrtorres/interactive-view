# interactive-view

Prepare a local interactive Three.js review from a 3D model file. The tool loads the source, generates a browser-ready `model.glb`, writes review metadata, serves the viewer over HTTP, and creates a PNG screenshot preview by default.

## Quick start

```sh
python3 -m tools.prepare_review \
  path/to/model.blend \
  --output review
```

Then open the printed local URL. The generated `review/` directory contains the standalone viewer, `model.glb`, `metadata.json`, and `preview.png`.

Supported inputs:

- `.glb`: copied directly into the review package.
- `.blend`, `.stl`, `.obj`, `.ply`: imported/exported through Blender.

The default screenshot requires Blender for conversion inputs, a Chromium-compatible browser, WebGL, and network access to the pinned Three.js CDN modules. Use `--no-screenshot` to prepare the viewer without launching a browser.

## Controls

Drag to orbit, scroll or pinch to zoom, right-drag to pan, and use Reset view, Auto-rotate, or Wireframe.

## Scope

This is a geometry review tool. It does not validate meshes, slice models, certify printability, estimate strength, or replace physical testing. Review files are local artifacts and are not automatically published.

## Development checks

```sh
python3 -m unittest discover -s tests -v
python3 -m py_compile tools/prepare_review.py
```
