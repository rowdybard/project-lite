import { Group, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadGltf(path?: string): Promise<Object3D | null> {
  if (!path) return null;

  const gltf = await loader.loadAsync(path);
  const root = gltf.scene;

  root.traverse((node) => {
    node.castShadow = true;
    node.receiveShadow = true;
  });

  return root;
}

export function createPlaceholderCar() {
  return new Group();
}
