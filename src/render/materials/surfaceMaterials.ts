import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
} from "three";

type SurfaceRepeat = {
  x: number;
  y: number;
};

type PbrMaterialOptions = {
  id: "Asphalt025A" | "Road012A" | "Grass001" | "Gravel029" | "Concrete042A" | "RoadLines001" | "Rubber003";
  repeat: SurfaceRepeat;
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  aoIntensity?: number;
  displacementScale?: number;
  opacity?: number;
};

const loader = new TextureLoader();
const textureCache = new Map<string, Texture>();
const textureRoot = "/assets/textures/ambientcg";

function texturePath(id: PbrMaterialOptions["id"], map: string) {
  return `${textureRoot}/${id}/${id}_1K-JPG_${map}.jpg`;
}

function loadTexture(path: string, repeat: SurfaceRepeat, color = false) {
  const key = `${path}|${repeat.x}|${repeat.y}|${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const texture = loader.load(path);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat.x, repeat.y);
  texture.anisotropy = 8;
  if (color) texture.colorSpace = SRGBColorSpace;
  textureCache.set(key, texture);
  return texture;
}

function createPbrMaterial({
  id,
  repeat,
  color = 0xffffff,
  roughness = 0.9,
  metalness = 0,
  normalScale = 0.55,
  aoIntensity = 0.55,
  displacementScale = 0,
  opacity = 1,
}: PbrMaterialOptions) {
  const material = new MeshStandardMaterial({
    color,
    map: loadTexture(texturePath(id, "Color"), repeat, true),
    roughnessMap: loadTexture(texturePath(id, "Roughness"), repeat),
    roughness,
    metalness,
    transparent: opacity < 1,
    opacity,
  });
  if (normalScale > 0) {
    material.normalMap = loadTexture(texturePath(id, "NormalGL"), repeat);
    material.normalScale = new Vector2(normalScale, normalScale);
  }
  if (displacementScale > 0) {
    material.displacementMap = loadTexture(texturePath(id, "Displacement"), repeat);
    material.displacementScale = displacementScale;
    material.displacementBias = -displacementScale * 0.52;
  }
  const useAo = aoIntensity > 0 && id !== "RoadLines001" && id !== "Rubber003";
  if (useAo) {
    material.aoMap = loadTexture(texturePath(id, "AmbientOcclusion"), repeat);
    material.aoMapIntensity = aoIntensity;
  }
  return material;
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoiseTexture(base: string, seed: number, repeat: SurfaceRepeat, color = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const random = seededRandom(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 4200; i++) {
    const shade = 38 + random() * 84;
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.04 + random() * 0.12})`;
    const size = 1 + random() * 3.5;
    ctx.fillRect(random() * canvas.width, random() * canvas.height, size, size);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat.x, repeat.y);
  texture.anisotropy = 8;
  if (color) texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createAsphaltMaterial(repeat: SurfaceRepeat = { x: 22, y: 80 }) {
  const material = createPbrMaterial({
    id: "Asphalt025A",
    repeat,
    color: 0xffffff,
    roughness: 0.96,
    normalScale: 0.48,
    aoIntensity: 0.18,
    displacementScale: 0,
  });
  material.envMapIntensity = 0.04;
  return material;
}

export function createGrassMaterial(repeat: SurfaceRepeat = { x: 48, y: 42 }) {
  const material = createPbrMaterial({
    id: "Grass001",
    repeat,
    color: 0x5f7442,
    roughness: 1,
    normalScale: 0,
    aoIntensity: 0,
  });
  material.envMapIntensity = 0.02;
  return material;
}

export function createGravelMaterial(repeat: SurfaceRepeat = { x: 5, y: 4 }) {
  return createPbrMaterial({
    id: "Gravel029",
    repeat,
    color: 0x736d5c,
    roughness: 0.98,
    normalScale: 0,
    aoIntensity: 0,
  });
}

export function createConcreteMaterial(repeat: SurfaceRepeat = { x: 4, y: 3 }) {
  return createPbrMaterial({
    id: "Concrete042A",
    repeat,
    color: 0xb9b6a9,
    roughness: 0.9,
    normalScale: 0,
    aoIntensity: 0,
  });
}

export function createRoadPaintMaterial(repeat: SurfaceRepeat = { x: 1, y: 1 }, tint = 0xd8d2bf, opacity = 0.82) {
  return createPbrMaterial({
    id: "RoadLines001",
    repeat,
    color: tint,
    roughness: 0.86,
    normalScale: 0,
    opacity,
  });
}

export function createRubberMaterial(repeat: SurfaceRepeat = { x: 6, y: 2 }, opacity = 0.38) {
  return createPbrMaterial({
    id: "Rubber003",
    repeat,
    color: 0x0d0f10,
    roughness: 0.94,
    normalScale: 0,
    opacity,
  });
}

export function createShoulderMaterial() {
  const material = createGravelMaterial({ x: 9, y: 2 });
  material.color.set(0x4c4335);
  material.opacity = 0.82;
  material.transparent = true;
  return material;
}

export function createProceduralStainMaterial(color = 0x101214, opacity = 0.24) {
  const material = new MeshStandardMaterial({
    color,
    map: createNoiseTexture("#5f5f5f", 317, { x: 2, y: 2 }),
    roughness: 0.98,
    transparent: true,
    opacity,
  });
  return material;
}
