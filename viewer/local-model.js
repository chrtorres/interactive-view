import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";

export async function loadLocalModel(file, format) {
  switch (format) {
    case "glb":
    case "gltf": {
      const manager = new THREE.LoadingManager();
      let needsExternalResource = false;
      const externalResource = new Error("The model references an external resource.");
      manager.setURLModifier((url) => {
        if (/^(data|blob):/i.test(url)) return url;
        needsExternalResource = true;
        throw externalResource;
      });
      const gltf = await new GLTFLoader(manager).parseAsync(await file.arrayBuffer(), "");
      if (needsExternalResource) {
        disposeModel(gltf.scene);
        throw externalResource;
      }
      return gltf;
    }
    case "obj": {
      const { OBJLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/OBJLoader.js");
      return { scene: new OBJLoader().parse(await file.text()), animations: [] };
    }
    case "stl": {
      const { STLLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/STLLoader.js");
      const geometry = new STLLoader().parse(await file.arrayBuffer());
      return geometryScene(geometry);
    }
    case "ply": {
      const { PLYLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/PLYLoader.js");
      const data = await file.arrayBuffer();
      const geometry = new PLYLoader().parse(data);
      // PLY faces can be non-indexed after the loader applies per-face colors or UVs.
      const hasFaces = geometry.index || /^[ \t]*element[ \t]+face[ \t]+[1-9]\d*[ \t\r]*$/m.test(
        new TextDecoder().decode(data.slice(0, 65536)).split("end_header")[0]
      );
      return geometryScene(geometry, !hasFaces);
    }
  }
}

function geometryScene(geometry, pointCloud = false) {
  const color = geometry.hasAttribute("color") ? 0xffffff : 0x8fb8e5;
  const vertexColors = geometry.hasAttribute("color");
  let object;
  if (pointCloud) {
    object = new THREE.Points(geometry, new THREE.PointsMaterial({ color, vertexColors, size: 3, sizeAttenuation: false }));
  } else {
    if (!geometry.hasAttribute("normal") && geometry.hasAttribute("position")) geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, vertexColors, side: THREE.DoubleSide }));
  }
  const scene = new THREE.Group();
  scene.add(object);
  return { scene, animations: [] };
}

export function disposeModel(root) {
  const resources = new Set();
  const images = new Set();
  root.traverse((node) => {
    if (node.geometry) resources.add(node.geometry);
    if (node.skeleton) resources.add(node.skeleton);
    for (const material of [node.material].flat()) {
      if (!material || resources.has(material)) continue;
      resources.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        resources.add(value);
        if (typeof value.image?.close === "function") images.add(value.image);
      }
    }
  });
  for (const resource of resources) resource.dispose();
  for (const image of images) image.close();
}
