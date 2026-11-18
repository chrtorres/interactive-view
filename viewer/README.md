# Interactive review viewer template

Copy this directory into a versioned creation run, place the exact reviewed GLB at `model.glb`, and replace the synthetic values in `metadata.json`. Serve the directory over HTTP; do not open it directly with `file://`.

The template uses Three.js 0.180.0 and its `OrbitControls`/`GLTFLoader` modules from jsDelivr at runtime. A browser with WebGL and network access to the CDN is required. The template is a review aid, not a CAD editor, mesh validator, slicer, or load-certification tool.
