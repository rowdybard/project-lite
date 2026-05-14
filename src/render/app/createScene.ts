import { AmbientLight, CanvasTexture, Color, DirectionalLight, EquirectangularReflectionMapping, Fog, HemisphereLight, Scene } from "three";

export function createScene() {
  const scene = new Scene();
  scene.background = new Color(0x91b8d8);
  scene.environment = createSkyEnvironment();
  scene.fog = new Fog(0x91b8d8, 120, 320);

  const ambient = new AmbientLight(0xdfe8f5, 0.72);
  scene.add(ambient);
  scene.add(new HemisphereLight(0xc9e1ff, 0x40513e, 1.5));

  const sun = new DirectionalLight(0xfff0d4, 4.8);
  sun.position.set(-72, 96, 54);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -185;
  sun.shadow.camera.right = 185;
  sun.shadow.camera.top = 185;
  sun.shadow.camera.bottom = -185;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  return scene;
}

function createSkyEnvironment() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#cde5ff");
  gradient.addColorStop(0.48, "#91b8d8");
  gradient.addColorStop(0.78, "#d9caa7");
  gradient.addColorStop(1, "#465945");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
