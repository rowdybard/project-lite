import { AmbientLight, CanvasTexture, Color, DirectionalLight, EquirectangularReflectionMapping, Fog, HemisphereLight, Scene } from "three";

export function createScene() {
  const scene = new Scene();
  scene.background = new Color(0xb3cce0);
  scene.environment = createSkyEnvironment();
  scene.fog = new Fog(0xb3cce0, 115, 380);

  const ambient = new AmbientLight(0xf1f6f0, 0.3);
  scene.add(ambient);
  scene.add(new HemisphereLight(0xd8edff, 0x516238, 0.9));

  const sun = new DirectionalLight(0xffdfad, 2.25);
  sun.position.set(-118, 58, 94);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -185;
  sun.shadow.camera.right = 185;
  sun.shadow.camera.top = 185;
  sun.shadow.camera.bottom = -185;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  const skyFill = new DirectionalLight(0xb6d8f0, 0.32);
  skyFill.position.set(70, 42, -90);
  scene.add(skyFill);

  return scene;
}

function createSkyEnvironment() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#d8edff");
  gradient.addColorStop(0.38, "#a9cce3");
  gradient.addColorStop(0.72, "#d6bd82");
  gradient.addColorStop(1, "#6f8152");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 18; i++) {
    const x = (i * 83) % canvas.width;
    const y = 28 + (i * 29) % 70;
    ctx.fillRect(x, y, 90 + (i % 5) * 28, 3 + (i % 3));
  }

  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
