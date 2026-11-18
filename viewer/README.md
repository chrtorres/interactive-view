# Interactive review viewer template

Copy this directory into a versioned creation run, place the exact reviewed GLB at `model.glb`, and replace the synthetic values in `metadata.json`. Serve the directory over HTTP; do not open it directly with `file://`.

The template uses Three.js 0.180.0 and its `OrbitControls`/`GLTFLoader` modules from jsDelivr at runtime. A browser with WebGL and network access to the CDN is required. The template is a review aid, not a CAD editor, mesh validator, slicer, or load-certification tool.

For multipart models, export one uniquely named top-level GLB node per inspectable part. In `metadata.json`, give each part a `node` (its GLB name), a `label` (its picker label), and an `offset` (three translation components in GLB parent coordinates and units). Use an empty `parts` array for a single-part model. Unlisted top-level nodes are treated as assembly guides and hidden while exploded.

**Explode** reveals **Inspect part**. Choose a piece to isolate and frame it, **All parts** for the full exploded view, or **Reassemble** to restore the assembled positions and guides.
