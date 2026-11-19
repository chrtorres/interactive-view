# Interactive review viewer template

Copy this directory into a versioned creation run, place the exact reviewed GLB at `model.glb`, and replace the synthetic values in `metadata.json`. Serve the directory over HTTP; do not open it directly with `file://`.

The template uses Three.js 0.180.0 and its `OrbitControls`/`GLTFLoader` modules from jsDelivr at runtime. A browser with WebGL and network access to the CDN is required. The template is a review aid, not a CAD editor, mesh validator, slicer, or load-certification tool.

For multipart models, export one uniquely named top-level GLB node per inspectable part. In `metadata.json`, give each part a `node` (its GLB name), a `label` (its picker label), and an `offset` (three translation components in GLB parent coordinates and units). Use an empty `parts` array for a single-part model. Unlisted top-level nodes are treated as assembly guides and hidden while exploded.

**Explode** reveals **Inspect part**. Choose a piece to isolate and frame it, **All parts** for the full exploded view, or **Reassemble** to restore the assembled positions and guides.

When `parts` is populated, exploded mode also renders numbered, clickable callouts with leader lines and an accessible part key. Keep one stable, uniquely named top-level node per inspectable part; labels are hidden in assembled mode and restore automatically on reassembly. The generic viewer does not infer hidden geometry or certify visual fidelity.

## Reference views

Optional fields in the metadata enable layered inspection.

| Field | Meaning |
| --- | --- |
| `modes` | Map of preset IDs to nonempty arrays of top-level node names. A preset displays exactly those nodes. Omit for the original assembled view. |
| `modeLabels`, `defaultMode` | Optional labels by preset ID and the starting preset. The first declared preset is the fallback. |
| `parts[].structures` | Optional array of `{node, label}` entries for direct children containing geometry. These appear when the parent part is isolated. |
| `parts[].description`, `parts[].evidence`, `parts[].sources` | Optional plain text and `{label, url}` links to the underlying research. Only HTTP(S) URLs without credentials become links. |

Use **View** to inspect assembled presets. Under **Explode**, pick a part, then use **Structure** to inspect a listed child. **All structures** restores its original children. **Reassemble** restores the preset and original transforms. Context nodes can appear in a preset without appearing in the exploded layout.

The preparation command accepts this metadata directly via `--metadata`. Pass `--three-dir` pointing to a local Three.js 0.180.0 package to embed the required modules and MIT license for offline use. The viewer itself serves all model data over HTTP.

## Animated models

The viewer discovers timed clips in the GLB. Choose a clip, play or pause it, scrub the timeline, or change the playback rate. **Loop** repeats the selected clip. A model with no timed clips has no playback toolbar. **Reset view** fits the current pose. When an assembly is exploded, the viewer restores the authored rest transforms and gives the layout control of the parts. Reassembly returns to the same paused animation time.

Optional metadata example:

```json
{
  "animation": {
    "defaultClip": "Traverse",
    "labels": { "Traverse": "Travel and bend" },
    "followNode": "Travel root",
    "autoplay": false,
    "loop": true
  }
}
```

- `defaultClip` and `labels` use clip names from the GLB. Unlabeled clips use their authored names.
- `followNode` identifies a uniquely named scene node or bone and enables **Follow motion**. The camera and orbit target translate with its evaluated world position, keeping the current viewing direction. GLB animation drives the model.
- `autoplay` and `loop` default to false. The browser's reduced-motion preference suppresses autoplay. Scrubbing pauses at the selected time, including the exact endpoint. Looping is best suited to clips authored with matching endpoints.
- This viewer supports animation tracks decoded by the bundled glTF loader. Physically measured accuracy, loop continuity between keys, material animation extensions, and compressed assets that require additional decoders have separate validation or integration requirements.
