import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  Object3D,
  Scene,
  SRGBColorSpace,
} from "three";
import type { Vec2 } from "../../game/types";

type LitScene = Scene & {
  userData: {
    drivingSun?: DirectionalLight;
    drivingSunTarget?: Object3D;
  };
};

export function createScene() {
  const scene = new Scene() as LitScene;
  const sky = createSkyEnvironment();
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.34;
  scene.fog = new Fog(0x91aab0, 165, 535);

  scene.add(new AmbientLight(0xe7eee8, 0.38));
  scene.add(new HemisphereLight(0xc5def0, 0x3d4d35, 1.28));

  const sunTarget = new Object3D();
  const sun = new DirectionalLight(0xffd6a1, 2.75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -62;
  sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62;
  sun.shadow.camera.bottom = -62;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.028;
  sun.target = sunTarget;
  scene.add(sun, sunTarget);

  const skyFill = new DirectionalLight(0x9fc5d4, 0.46);
  skyFill.position.set(76, 58, -112);
  scene.add(skyFill);
  scene.userData.drivingSun = sun;
  scene.userData.drivingSunTarget = sunTarget;
  updateSceneLighting(scene, { x: 0, z: 0 });

  return scene;
}

export function updateSceneLighting(scene: Scene, focus: Vec2) {
  const litScene = scene as LitScene;
  const sun = litScene.userData.drivingSun;
  const target = litScene.userData.drivingSunTarget;
  if (!sun || !target) return;
  target.position.set(focus.x, 0, focus.z);
  sun.position.set(focus.x - 82, 78, focus.z + 64);
  target.updateMatrixWorld();
}

export function createSkyEnvironment() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#638eb3");
  gradient.addColorStop(0.28, "#9fc5dc");
  gradient.addColorStop(0.52, "#d7dee0");
  gradient.addColorStop(0.7, "#d7bb86");
  gradient.addColorStop(1, "#526550");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const haze = ctx.createLinearGradient(0, canvas.height * 0.43, 0, canvas.height * 0.75);
  haze.addColorStop(0, "rgba(255, 245, 220, 0)");
  haze.addColorStop(1, "rgba(255, 224, 170, 0.28)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, canvas.height * 0.36, canvas.width, canvas.height * 0.42);

  ctx.fillStyle = "rgba(244, 250, 252, 0.16)";
  for (const cloud of [
    { x: 86, y: 104, w: 264, h: 16 },
    { x: 418, y: 148, w: 338, h: 21 },
    { x: 742, y: 91, w: 212, h: 14 },
    { x: -104, y: 184, w: 310, h: 18 },
  ]) {
    ctx.beginPath();
    ctx.ellipse(cloud.x + cloud.w / 2, cloud.y, cloud.w / 2, cloud.h, -0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
