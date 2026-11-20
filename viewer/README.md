# Interactive review viewer template

Serve this directory over HTTP and choose **Open model** or drop a supported file into the viewer. For a packaged review, copy this directory into a versioned creation run, place the exact reviewed GLB at `model.glb`, and update `metadata.json` with the review values. Remove `"autoload": false` to open the packaged model on launch.

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

The preparation command accepts this metadata directly via `--metadata`. Pass `--three-dir` pointing to a local Three.js 0.180.0 package to embed the required modules and MIT license for offline use. Packaged models are served over HTTP, and files opened with the picker or drag-and-drop are read directly by the browser.

## Animated models

The viewer discovers timed clips in the GLB. Choose a clip, play or pause it, scrub the timeline, or change the playback rate. **Loop** repeats the selected clip. A model with no timed clips has no playback toolbar. **Reset view** fits the current pose. When an assembly is exploded, the viewer restores the authored rest transforms and gives the layout control of the parts. Reassembly returns to the same paused animation time.

Local GLB and glTF files play and loop their first clip on open. With reduced motion enabled, use **Play** to start. If the viewer detects a translating root that carries the model, **Follow motion** starts enabled. Turn it off to keep the camera fixed.

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
- For packaged reviews, `autoplay` and `loop` default to false. The browser's reduced-motion preference suppresses autoplay. Scrubbing pauses at the selected time, including the exact endpoint. Looping is best suited to clips authored with matching endpoints.
- This viewer supports animation tracks decoded by the bundled glTF loader. Physically measured accuracy, loop continuity between keys, material animation extensions, and compressed assets that require additional decoders have separate validation or integration requirements.

## Workspace lifecycle and path sampling

The workspace loads each view's `index.html` in a retained same-origin frame. Custom scene packages may copy the [embedding module](embedding.js) and import `viewActive()` in their animation loop. On an inactive frame, skip GPU rendering and simulation and clear the previous playback timestamp. Keep camera, pose, and control state in the child. The adapter accepts a typed activity message from the same-origin parent. The `embedded` class is available for hiding a redundant internal masthead. Standalone views continue to render normally. The host preserves panel dimensions when inactive to avoid a resize-induced camera reset.

The optional [path sampler](path-trace.js) accepts scene time in seconds and a world-space XYZ array. Use a single trace per independent clock.

```js
const path = createPathTrace({ interval: .12, duration: 12 });
// In the active scene's update, after sampling its world-space position.
if (path.sample(sceneTime, position.toArray())) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(
    path.points().map(xyz => new THREE.Vector3().fromArray(xyz))
  );
}
// On scene reset or a discontinuous teleport, call path.clear().
```

Invoke `sample` with the same time used to advance the scene. Samples expire by scene time and a rewind begins a new segment. The trace records past movement. A planned course or a scrubbed clip may have a separate trajectory and clock.
