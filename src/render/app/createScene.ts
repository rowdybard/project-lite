import { AmbientLight, Color, DirectionalLight, Fog, Scene } from "three";

export function createScene() {
  const scene = new Scene();
  scene.background = new Color(0x8db5d8);
  scene.fog = new Fog(0x8db5d8, 95, 245);

  const ambient = new AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  const sun = new DirectionalLight(0xffffff, 3.4);
  sun.position.set(-45, 70, 38);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  scene.add(sun);

  return scene;
}
