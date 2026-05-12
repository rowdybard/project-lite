import {
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Mesh,
  MeshStandardMaterial,
  WebGLRenderer,
} from "three";
import type { CarCustomization } from "../../game/customization";
import { createCarView } from "../objects/carView";
import { createPreviewCarState } from "./previewCarState";

let thumbnailRenderer: WebGLRenderer | null = null;

function getThumbnailRenderer() {
  if (!thumbnailRenderer) {
    thumbnailRenderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbnailRenderer.setClearColor(new Color(0x000000), 0);
  }
  return thumbnailRenderer;
}

export function renderMiniCarPreview(image: HTMLImageElement, customization: CarCustomization) {
  const renderer = getThumbnailRenderer();
  const width = 220;
  const height = 126;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, width / height, 0.1, 40);
  camera.position.set(3.4, 1.8, 5.1);
  camera.lookAt(0, 0.62, 0);

  scene.add(new AmbientLight(0xb8d4f0, 1.4));
  const keyLight = new DirectionalLight(0xfff0cf, 3.2);
  keyLight.position.set(3, 4, 4);
  scene.add(keyLight);

  const floor = new Mesh(
    new PlaneGeometry(5.8, 4.2),
    new MeshStandardMaterial({ color: 0x131922, roughness: 0.84, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const car = createPreviewCarState();
  car.heading = 0.55;
  const carView = createCarView(0.72);
  carView.applyCustomization(customization);
  carView.sync(car);
  scene.add(carView.root);
  renderer.render(scene, camera);

  image.src = renderer.domElement.toDataURL("image/png");
}
