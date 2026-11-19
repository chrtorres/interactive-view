import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

import { initiallyExploded, viewActive } from "./embedding.js";
import { createMotion } from "./motion.js";

const host = document.querySelector("#viewer");
const loading = document.querySelector("#loading");
const explodeButton = document.querySelector("#explode");
const inspection = document.querySelector("#part-inspection");
const partPicker = document.querySelector("#part");
const modePicker = document.querySelector("#mode");
const structurePicker = document.querySelector("#structure");
const partStatus = document.querySelector("#part-status");
const labelLayer = document.querySelector("#part-labels");
const leaderLayer = document.querySelector("#part-leaders");
const partKey = document.querySelector("#part-key");
const showPartLabels = document.querySelector("#show-part-labels");
showPartLabels.addEventListener("change", updatePartLabels);
const partKeyList = partKey.querySelector("ol");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
const defaultDirection = new THREE.Vector3(0, 0.95, 1.15).normalize();
camera.position.copy(defaultDirection);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
host.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xa9caff, 0x172033, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 4.0); key.position.set(260, -300, 420); scene.add(key);
const rim = new THREE.DirectionalLight(0x4b9cff, 3.0); rim.position.set(-300, 260, 150); scene.add(rim);
let needsFrame = true;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = true;
controls.addEventListener("change", () => { needsFrame = true; });
controls.update();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let model = null;
let motion = null;
let parts = [];
let guides = [];
let exploded = false;
let transition = null;
let presets = new Map();
let selectedPart = null;
let focusedStructure = null;
const materials = new Set();

function fitRenderer() {
  needsFrame = true;
  const rect = host.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
}
function frameView(direction = defaultDirection) {
  if (!model) return;
  const bounds = new THREE.Box3();
  if (motion && !motion.suspended) {
    model.updateMatrixWorld(true);
    model.traverseVisible((node) => { if (node.isSkinnedMesh) node.computeBoundingBox(); });
  }
  if (focusedStructure) {
    bounds.setFromObject(focusedStructure.node);
  } else {
    for (const node of model.children) if (node.visible) bounds.expandByObject(node);
  }
  needsFrame = true;
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(1e-6, bounds.getSize(new THREE.Vector3()).length());
  // Clear pending orbit deltas before moving to a newly fitted frame.
  const damping = controls.enableDamping;
  const autoRotate = controls.autoRotate;
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.update();
  camera.position.copy(center).add(direction);
  camera.lookAt(center);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.85;
  const horizontal = vertical * camera.aspect;
  let distance = span * 0.6;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        const padding = Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical);
        distance = Math.max(distance, corner.dot(direction) + padding);
      }
    }
  }

  controls.target.copy(center);
  controls.minDistance = span * 0.12;
  controls.maxDistance = distance * 4;
  camera.near = span / 1500;
  camera.far = controls.maxDistance + span;
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.updateProjectionMatrix();
  controls.update();
  controls.enableDamping = damping;
  controls.autoRotate = autoRotate;
}

function notice(message) {
  partStatus.textContent = [partStatus.textContent, message].filter(Boolean).join(" ");
  partStatus.hidden = false;
}

function registerPresets(metadata) {
  const definitions = metadata.modes;
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) return;
  const nodes = new Map(model.children.map(node => [node.name, node]));
  for (const [id, names] of Object.entries(definitions)) {
    const group = Array.isArray(names) && names.map(name => typeof name === "string" &&
      nodes.get(THREE.PropertyBinding.sanitizeNodeName(name)));
    if (!group || group.length === 0 || group.some(node => !node) || new Set(group).size !== group.length) {
      notice("A view preset references missing or duplicate top-level nodes.");
      continue;
    }
    presets.set(id, new Set(group));
    modePicker.add(new Option(metadata.modeLabels?.[id] || id.replace(/[-_]/g, " ").replace(/^./, letter => letter.toUpperCase()), id));
  }
  if (!presets.size) return;
  modePicker.value = presets.has(metadata.defaultMode) ? metadata.defaultMode : presets.keys().next().value;
  document.querySelector("#mode-control").hidden = false;
}

function registerParts(definitions = []) {
  if (Array.isArray(definitions) && definitions.length === 0) return;
  const valid = Array.isArray(definitions) && definitions.length >= 2 && definitions.every((part) =>
    typeof part?.node === "string" && part.node.trim() && typeof part.label === "string" && part.label.trim() &&
    Array.isArray(part.offset) && part.offset.length === 3 && part.offset.every(Number.isFinite)
  );
  if (!valid) {
    partStatus.textContent = "Explode requires at least two named parts with three-component offsets.";
    partStatus.hidden = false;
    return;
  }
  const byName = new Map(model.children.map((node) => [node.name, node]));
  const entries = definitions.map(({ node: name, label, offset, structures, description, evidence, sources }) => ({
    node: byName.get(THREE.PropertyBinding.sanitizeNodeName(name)),
    label, structures, description, evidence, sources,
    offset: new THREE.Vector3(...offset),
  }));
  if (entries.some(({ node }) => !node || !node.getObjectByProperty("isMesh", true)) ||
      new Set(entries.map(({ node }) => node)).size !== entries.length) {
    partStatus.textContent = "Check that each part matches a unique top-level GLB node containing geometry.";
    partStatus.hidden = false;
    return;
  }

  parts = entries.map((part, index) => {
    partPicker.add(new Option(part.label, String(index)));
    const assembled = part.node.position.clone();
    const children = new Map(part.node.children.filter(node => node.getObjectByProperty("isMesh", true))
      .map(node => [node.name, node]));
    const structures = [];
    for (const entry of Array.isArray(part.structures) ? part.structures : []) {
      const node = typeof entry?.node === "string" && children.get(THREE.PropertyBinding.sanitizeNodeName(entry.node));
      if (!node || structures.some(item => item.node === node)) {
        notice(`Check structure names for ${part.label}.`);
        continue;
      }
      structures.push({ node, label: entry.label || entry.node });
    }
    const anchor = part.node.worldToLocal(new THREE.Box3().setFromObject(part.node).getCenter(new THREE.Vector3()));
    return { ...part, structures, assembled, separated: assembled.clone().add(part.offset), anchor,
             visible: part.node.visible, childVisibility: part.node.children.map(node => [node, node.visible]) };

  });
  partKeyList.replaceChildren();
  parts.forEach((part, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button"; button.textContent = `${index + 1}. ${part.label}`;
    button.addEventListener("click", () => { partPicker.value = String(index); updateLayout(); });
    item.append(button); partKeyList.append(item);
  });
  const printable = new Set(parts.map(({ node }) => node));
  guides = model.children.filter((node) => !printable.has(node))
    .map((node) => ({ node, visible: node.visible }));
  explodeButton.disabled = false;
}

function inspect(part) {
  if (part !== selectedPart) {
    // Restore original child visibility before relinquishing the isolated group.
    for (const [node, visible] of selectedPart?.childVisibility || []) node.visible = visible;
    selectedPart = part;
    structurePicker.replaceChildren(new Option("All structures", ""));
    for (const [index, item] of (part?.structures || []).entries()) {
      structurePicker.add(new Option(item.label, String(index)));
    }
  }
  focusedStructure = structurePicker.value === "" ? null : part.structures[Number(structurePicker.value)];
  for (const [node, visible] of part?.childVisibility || []) node.visible = focusedStructure ? focusedStructure.node === node : visible;
  document.querySelector("#structure-control").hidden = !part?.structures.length;
  document.querySelector("#selection").hidden = !part;
  document.querySelector("#selection-title").textContent = focusedStructure?.label || part?.label || "";
  document.querySelector("#description").textContent = part?.description || "";

  const preset = presets.get(modePicker.value);
  const reference = part || (!exploded && preset
    ? parts.find(item => preset.has(item.node) && (item.evidence || item.sources?.length))
    : null);
  const links = document.querySelector("#sources");
  links.replaceChildren();
  for (const source of Array.isArray(reference?.sources) ? reference.sources : []) {
    if (typeof source?.label !== "string" || typeof source.url !== "string") continue;
    // Metadata is user-supplied. Only ordinary web links can become clickable.
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url.href;
    link.textContent = source.label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.append(link);
    links.append(item);
  }
  document.querySelector("#reference").hidden = !reference?.evidence && !links.childElementCount;
  document.querySelector("#evidence").textContent = reference?.evidence || "";
}

function updateLayout(animateParts = false) {
  const direction = camera.position.clone().sub(controls.target).normalize();
  const starts = parts.map(({ node }) => node.position.clone());
  const ends = parts.map((part) => exploded ? part.separated : part.assembled);
  const pick = partPicker.value;
  inspect(exploded && pick !== "" ? parts[Number(pick)] : null);
  const preset = presets.get(modePicker.value);
  parts.forEach(({ node }, index) => {
    node.position.copy(ends[index]);
    node.visible = exploded ? pick === "" || index === Number(pick) : (preset?.has(node) ?? parts[index].visible);
  });
  for (const guide of guides) guide.node.visible = !exploded && (preset?.has(guide.node) ?? guide.visible);
  motion?.apply(false);
  frameView(direction);
  transition = null;
  if (animateParts && !reducedMotion.matches) {
    transition = { starts, ends, startTime: performance.now() };
    parts.forEach(({ node }, index) => node.position.copy(starts[index]));
  } else if (!exploded) {
    motion?.setSuspended(false);
  }
}
function updatePartLabels() {
  const labelsVisible = exploded && showPartLabels.checked;
  labelLayer.style.visibility = labelsVisible ? "" : "hidden";
  leaderLayer.style.visibility = labelsVisible ? "" : "hidden";
  partKey.hidden = !labelsVisible;
  const rect = host.getBoundingClientRect();
  labelLayer.replaceChildren(); leaderLayer.replaceChildren();
  if (!labelsVisible || !parts.length || !rect.width || !rect.height) return;
  leaderLayer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  const selected = partPicker.value;
  const points = [[], []];
  parts.forEach((part, index) => {
    if (selected !== "" && selected !== String(index)) return;
    const point = focusedStructure
      ? new THREE.Box3().setFromObject(focusedStructure.node).getCenter(new THREE.Vector3())
      : part.node.localToWorld(part.anchor.clone());
    point.project(camera);
    if (point.z < -1 || point.z > 1) return;
    const x = (point.x * .5 + .5) * rect.width;
    const y = (-point.y * .5 + .5) * rect.height;
    points[x < rect.width/2 ? 0 : 1].push({part,index,x,y});
  });
  // Side rails prevent labels on nearby parts from covering one another.
  for (const [side, entries] of points.entries()) {
    entries.sort((a,b) => a.y-b.y);
    const step = Math.min(28,(rect.height-58)/Math.max(1,entries.length));
    let previous = 20-step;
    for (const [i,{part,index,x,y}] of entries.entries()) {
      const labelY = THREE.MathUtils.clamp(y,previous+step,rect.height-38-(entries.length-i-1)*step);
      previous = labelY;
      const label = document.createElement("button");
      label.className = `part-label rail-${side}`;
      label.type = "button";
      label.textContent = `${index + 1}`;
      const name = document.createElement("span");
      name.textContent = `. ${part.label}`;
      label.append(name);
      label.title = part.label;
      label.setAttribute("aria-label", `Inspect ${part.label}`);
      label.style.top = `${labelY}px`;
      label.addEventListener("click", () => { partPicker.value = String(index); updateLayout(); });
      labelLayer.append(label);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const rail = label.offsetWidth+6;
      for (const [key,value] of Object.entries({x1:x,y1:y,x2:side ? rect.width-rail : rail,y2:labelY})) {
        line.setAttribute(key,String(value));
      }
      leaderLayer.append(line);
    }
  }
}

// Read-only scene state for browser regression checks.
export function inspectLayout() {
  return {
    moving: transition !== null,
    motion: motion?.inspect(),
    frame: renderer.info.render.frame,
    camera: camera.position.toArray(),
    nodes: (model?.children || []).map(node => ({
      name: node.name, visible: node.visible, position: node.position.toArray(),
      children: node.children.map(child => ({ name: child.name, visible: child.visible })),
    })),
  };
}
function renderMetadata(metadata) {
  document.querySelector("#title").textContent = metadata.title || "3D model review";
  document.querySelector("#status").textContent = metadata.status || "Unapproved · review geometry";
  document.querySelector("#note").textContent = metadata.note || "Interactive viewing does not certify printability, fit, strength, or load capacity.";
  document.querySelector("#prompt").textContent = metadata.prompt || "Inspect the model from several angles, then send feedback or approve this exact version.";
  const facts = document.querySelector("#facts");
  for (const [key, value] of Object.entries(metadata.facts || {})) {
    const row = document.createElement("div");
    const label = document.createElement("dt"); label.textContent = key;
    const detail = document.createElement("dd"); detail.textContent = value;
    row.append(label, detail); facts.appendChild(row);
  }
}

const metadataRequest = fetch("metadata.json")
  .then((response) => response.ok ? response.json() : {})
  .then((metadata) => metadata || {})
  .catch(() => ({}));
metadataRequest.then(renderMetadata);
new GLTFLoader().load("model.glb", async (gltf) => {
  model = gltf.scene;
  model.traverse((node) => {
    if (node.isMesh) {
      for (const material of [node.material].flat()) materials.add(material);
    }
  });
  const metadata = await metadataRequest;
  registerParts(metadata.parts);
  if (!parts.length) guides = model.children.map(node => ({ node, visible: node.visible }));
  registerPresets(metadata);
  scene.add(model);
  updateLayout();
  motion = createMotion(model, gltf.animations, metadata.animation || {}, {
    camera, controls, reducedMotion, notice,
    redraw: () => { needsFrame = true; },
    fit: () => frameView(camera.position.clone().sub(controls.target).normalize()),
  });
  if (motion) frameView();
  if (initiallyExploded && !explodeButton.disabled) explodeButton.click();
  loading.classList.add("hidden");
}, undefined, (error) => { loading.textContent = "Could not load model.glb"; console.error(error); });

explodeButton.addEventListener("click", () => {
  exploded = !exploded;
  if (exploded) motion?.setSuspended(true);
  explodeButton.textContent = exploded ? "Reassemble" : "Explode";
  explodeButton.setAttribute("aria-pressed", String(exploded));
  inspection.hidden = !exploded;
  partPicker.value = "";
  updateLayout(true);
});
partPicker.addEventListener("change", () => updateLayout());
structurePicker.addEventListener("change", () => updateLayout());
modePicker.addEventListener("change", () => {
  if (exploded) explodeButton.click();
  else updateLayout();
});
document.querySelector("#reset").addEventListener("click", () => {
  if (transition) updateLayout();
  frameView();
});
document.querySelector("#autoRotate").addEventListener("click", (event) => {
  controls.autoRotate = !controls.autoRotate;
  event.currentTarget.setAttribute("aria-pressed", String(controls.autoRotate));
});
document.querySelector("#wireframe").addEventListener("click", (event) => {
  const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
  for (const material of materials) material.wireframe = enabled;
  needsFrame = true;
});
window.addEventListener("resize", () => {
  fitRenderer();
  if (transition) updateLayout();
  frameView();
});
fitRenderer();

function animate(time) {
  requestAnimationFrame(animate);
  if (!viewActive()) {
    motion?.resetClock();
    return;
  }
  motion?.tick(time);
  if (transition) {
    needsFrame = true;
    const amount = THREE.MathUtils.smoothstep(time - transition.startTime, 0, 320);
    parts.forEach(({ node }, index) => {
      if (amount === 1) {
        node.position.copy(transition.ends[index]);
      } else {
        node.position.lerpVectors(transition.starts[index], transition.ends[index], amount);
      }
    });
    if (amount === 1) {
      transition = null;
      if (!exploded) motion?.setSuspended(false);
    }
  }
  controls.update();
  if (needsFrame) {
    renderer.render(scene, camera);
    updatePartLabels();
    needsFrame = false;
  }
}
requestAnimationFrame(animate);

document.addEventListener("visibilitychange", () => motion?.resetClock());
