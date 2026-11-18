import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

const host = document.querySelector("#viewer");
const loading = document.querySelector("#loading");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
camera.position.set(440, -440, 330);
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
controls.minDistance = 330; controls.maxDistance = 900; controls.target.set(0, 0, 0); controls.update();
let model = null; let modelBox = null; let rotating = false;
const initialCamera = new THREE.Vector3(440, -440, 330);

function fitRenderer() {
  const rect = host.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
}
function resetView() {
  camera.position.copy(initialCamera); controls.target.set(0, 0, 0);
  if (modelBox) controls.minDistance = Math.max(330, modelBox.getSize(new THREE.Vector3()).length() * 0.72);
  controls.update();
}
function setWireframe(enabled) {
  if (!model) return;
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.material = object.material.clone(); object.material.wireframe = enabled;
    object.material.transparent = enabled; object.material.opacity = enabled ? 0.92 : 1;
  });
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

fetch("metadata.json").then((response) => response.ok ? response.json() : {}).then(renderMetadata).catch(() => renderMetadata({}));
new GLTFLoader().load("model.glb", (gltf) => {
  model = gltf.scene; modelBox = new THREE.Box3().setFromObject(model);
  model.position.sub(modelBox.getCenter(new THREE.Vector3())); scene.add(model); loading.classList.add("hidden"); resetView();
}, undefined, (error) => { loading.textContent = "Could not load model.glb"; console.error(error); });
document.querySelector("#reset").addEventListener("click", resetView);
document.querySelector("#autoRotate").addEventListener("click", (event) => { rotating = !rotating; event.currentTarget.setAttribute("aria-pressed", String(rotating)); });
document.querySelector("#wireframe").addEventListener("click", (event) => { const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true"; event.currentTarget.setAttribute("aria-pressed", String(enabled)); setWireframe(enabled); });
window.addEventListener("resize", fitRenderer); fitRenderer();
function animate() { requestAnimationFrame(animate); if (rotating && model) model.rotation.y += 0.0025; controls.update(); renderer.render(scene, camera); }
animate();
