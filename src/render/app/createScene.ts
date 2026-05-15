import { AmbientLight, CanvasTexture, Color, DirectionalLight, EquirectangularReflectionMapping, Fog, HemisphereLight, Scene } from "three";

export function createScene() {
  const scene = new Scene();
  scene.background = new Color(0x7f949f);
  scene.environment = createSkyEnvironment();
  scene.fog = new Fog(0x7f949f, 90, 310);

  const ambient = new AmbientLight(0xdfe8f5, 0.22);
  scene.add(ambient);
  scene.add(new HemisphereLight(0xc8dded, 0x2a3528, 0.72));

  const sun = new DirectionalLight(0xf4d2a6, 2.75);
  sun.position.set(-112, 52, 88);
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

  const skyFill = new DirectionalLight(0x8fb2d6, 0.22);
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
  gradient.addColorStop(0, "#c4d2da");
  gradient.addColorStop(0.38, "#7f949f");
  gradient.addColorStop(0.72, "#b69f70");
  gradient.addColorStop(1, "#344130");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.11)";
  for (let i = 0; i < 18; i++) {
    const x = (i * 83) % canvas.width;
    const y = 28 + (i * 29) % 70;
    ctx.fillRect(x, y, 90 + (i % 5) * 28, 3 + (i % 3));
  }

  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}
