import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const host = document.querySelector("#viewer");
const loading = document.querySelector("#loading");
const explodeButton = document.querySelector("#explode");
const inspection = document.querySelector("#part-inspection");
const partPicker = document.querySelector("#part");
const partStatus = document.querySelector("#part-status");
const labelLayer = document.querySelector("#part-labels");
const leaderLayer = document.querySelector("#part-leaders");
const partKey = document.querySelector("#part-key");
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
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = true;
controls.addEventListener("change", schedulePartLabels);
controls.update();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let model = null;
let parts = [];
let guides = [];
let exploded = false;
let transition = null;
let labelUpdateQueued = false;
const materials = new Set();

function fitRenderer() {
  const rect = host.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
}
function frameView(direction = defaultDirection) {
  if (!model) return;
  const bounds = new THREE.Box3();
  if (exploded) {
    for (const { node } of parts) {
      if (node.visible) bounds.expandByObject(node);
    }
  } else {
    bounds.setFromObject(model);
  }
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(1e-6, bounds.getSize(new THREE.Vector3()).length());
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
  const entries = definitions.map(({ node: name, label, offset }) => ({
    node: byName.get(THREE.PropertyBinding.sanitizeNodeName(name)),
    label,
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
    return { ...part, assembled, separated: assembled.clone().add(part.offset) };
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

function updateLayout(animateParts = false) {
  const direction = camera.position.clone().sub(controls.target).normalize();
  const starts = parts.map(({ node }) => node.position.clone());
  const ends = parts.map((part) => exploded ? part.separated : part.assembled);
  const pick = partPicker.value;
  parts.forEach(({ node }, index) => {
    node.position.copy(ends[index]);
    node.visible = !exploded || pick === "" || index === Number(pick);
  });
  for (const guide of guides) guide.node.visible = !exploded && guide.visible;
  partKey.hidden = !exploded;
  frameView(direction);
  transition = null;
  if (animateParts && !reducedMotion.matches) {
    transition = { starts, ends, startTime: performance.now() };
    parts.forEach(({ node }, index) => node.position.copy(starts[index]));
  }
}
function updatePartLabels() {
  const rect = host.getBoundingClientRect();
  labelLayer.replaceChildren(); leaderLayer.replaceChildren();
  if (!exploded || !parts.length || !rect.width || !rect.height) return;
  leaderLayer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  const selected = partPicker.value;
  parts.forEach((part, index) => {
    if (selected !== "" && selected !== String(index)) return;
    const point = new THREE.Box3().setFromObject(part.node).getCenter(new THREE.Vector3()).project(camera);
    if (point.z < -1 || point.z > 1) return;
    const x = (point.x * .5 + .5) * rect.width;
    const y = (-point.y * .5 + .5) * rect.height;
    const label = document.createElement("button"); label.className = "part-label"; label.type = "button";
    label.textContent = `${index + 1}. ${part.label}`; label.title = part.label; label.setAttribute("aria-label", `Inspect ${part.label}`);
    const labelX = Math.max(42, Math.min(rect.width - 42, x + 42));
    const labelY = Math.max(24, Math.min(rect.height - 24, y - 24));
    label.style.left = `${labelX}px`; label.style.top = `${labelY}px`;
    label.addEventListener("click", () => { partPicker.value = String(index); updateLayout(); });
    labelLayer.append(label);
    const lx = labelX, ly = labelY;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x)); line.setAttribute("y1", String(y)); line.setAttribute("x2", String(lx)); line.setAttribute("y2", String(ly)); line.setAttribute("stroke", "#8bc3ff"); line.setAttribute("stroke-width", "1.2"); line.setAttribute("opacity", ".8");
    leaderLayer.append(line);
  });
}
function schedulePartLabels() {
  if (labelUpdateQueued) return;
  labelUpdateQueued = true;
  requestAnimationFrame(() => { labelUpdateQueued = false; updatePartLabels(); });
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
  scene.add(model);
  frameView();
  updateLayout();
  loading.classList.add("hidden");
}, undefined, (error) => { loading.textContent = "Could not load model.glb"; console.error(error); });

explodeButton.addEventListener("click", () => {
  exploded = !exploded;
  explodeButton.textContent = exploded ? "Reassemble" : "Explode";
  explodeButton.setAttribute("aria-pressed", String(exploded));
  inspection.hidden = !exploded;
  partPicker.value = "";
  updateLayout(true);
});
partPicker.addEventListener("change", () => updateLayout());
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
});
window.addEventListener("resize", () => {
  fitRenderer();
  if (transition) updateLayout();
  frameView();
});
fitRenderer();

function animate(time) {
  requestAnimationFrame(animate);
  if (transition) {
    const amount = THREE.MathUtils.smoothstep(time - transition.startTime, 0, 320);
    parts.forEach(({ node }, index) => {
      if (amount === 1) {
        node.position.copy(transition.ends[index]);
      } else {
        node.position.lerpVectors(transition.starts[index], transition.ends[index], amount);
      }
    });
    if (amount === 1) transition = null;
  }
  updatePartLabels();
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
