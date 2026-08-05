import {
  CanvasTexture,
  ClampToEdgeWrapping,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";

// Procedural PBR car paint: builds an orange-peel detail normal map and a subtle
// clearcoat roughness variation map once, then applies them to any MeshPhysicalMaterial
// so every paint color gets the same believable surface without per-color texture work.
//
// The maps are small (256) and tiled loosely so the surface reads as a real painted
// panel under arena lights — fine grain where the clearcoat catches, soft low-frequency
// variation where it doesn't. No metalflake flake noise (kept the design subtle per spec).

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

function buildValueNoise(size: number, cells: number, octaves: number, seed: number) {
  const random = seededRandom(seed);
  const heights = new Float32Array(size * size);
  let amplitude = 1;
  let totalAmplitude = 0;
  let gridSize = cells;
  for (let octave = 0; octave < octaves; octave++) {
    const grid = new Float32Array((gridSize + 1) * (gridSize + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = random();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * gridSize;
        const gy = (y / size) * gridSize;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const tx = gx - x0;
        const ty = gy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const ix0 = y0 * (gridSize + 1);
        const ix1 = ix0 + (gridSize + 1);
        const v =
          grid[ix0 + x0] * (1 - sx) * (1 - sy) +
          grid[ix0 + x0 + 1] * sx * (1 - sy) +
          grid[ix1 + x0] * (1 - sx) * sy +
          grid[ix1 + x0 + 1] * sx * sy;
        heights[y * size + x] += v * amplitude;
      }
    }
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    gridSize *= 2;
  }
  for (let i = 0; i < heights.length; i++) heights[i] /= totalAmplitude;
  return heights;
}

function buildOrangePeelNormal(size = 512): CanvasTexture {
  // Orange peel reads as low-frequency gentle bumps with fine grain on top.
  const lowFreq = buildValueNoise(size, 6, 3, 1337);
  const highFreq = buildValueNoise(size, 48, 2, 7331);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size, size);
  const strength = 1.1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yu = (y - 1 + size) % size;
      const yd = (y + 1) % size;
      const h = lowFreq[i] * 0.7 + highFreq[i] * 0.3;
      const hl = lowFreq[y * size + xl] * 0.7 + highFreq[y * size + xl] * 0.3;
      const hr = lowFreq[y * size + xr] * 0.7 + highFreq[y * size + xr] * 0.3;
      const hu = lowFreq[yu * size + x] * 0.7 + highFreq[yu * size + x] * 0.3;
      const hd = lowFreq[yd * size + x] * 0.7 + highFreq[yd * size + x] * 0.3;
      const dx = (hr - hl) * strength;
      const dy = (hd - hu) * strength;
      const nx = dx;
      const ny = dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = i * 4;
      imageData.data[o] = (nx / len) * 127 + 128;
      imageData.data[o + 1] = (ny / len) * 127 + 128;
      imageData.data[o + 2] = (nz / len) * 127 + 128;
      imageData.data[o + 3] = 255;
      void h;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function buildMicroScratchNormal(size = 256): CanvasTexture {
  // Fine high-frequency scratches/swirl marks — subtle but visible under bright light
  const noise = buildValueNoise(size, 64, 2, 9123);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size, size);
  const strength = 0.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const dx = (noise[y * size + xr] - noise[y * size + xl]) * strength;
      const dy = (noise[((y + 1) % size) * size + x] - noise[((y - 1 + size) % size) * size + x]) * strength * 0.3;
      const len = Math.hypot(dx, dy, 1) || 1;
      const o = i * 4;
      imageData.data[o] = (dx / len) * 127 + 128;
      imageData.data[o + 1] = (dy / len) * 127 + 128;
      imageData.data[o + 2] = (1 / len) * 127 + 128;
      imageData.data[o + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(8, 8);
  return texture;
}

function buildColorDepthMap(size = 256): CanvasTexture {
  // Subtle low-frequency color variation so panels don't read as flat single-color
  const lowFreq = buildValueNoise(size, 4, 2, 5555);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < lowFreq.length; i++) {
    const v = 0.94 + lowFreq[i] * 0.12;
    const c = Math.round(Math.min(255, Math.max(0, v * 255)));
    const o = i * 4;
    imageData.data[o] = c;
    imageData.data[o + 1] = c;
    imageData.data[o + 2] = c;
    imageData.data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function buildClearcoatRoughness(size = 256): CanvasTexture {
  // Subtle low-frequency variation + metallic flake speckle so the clearcoat
  // doesn't read as a uniform mirror.
  const lowFreq = buildValueNoise(size, 4, 2, 4242);
  const flake = buildValueNoise(size, 80, 1, 8877);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < lowFreq.length; i++) {
    const base = 0.18 + lowFreq[i] * 0.14;
    const flakeBoost = flake[i] > 0.85 ? -0.06 : 0;
    const v = Math.max(0.08, Math.min(0.5, base + flakeBoost));
    const c = Math.round(v * 255);
    const o = i * 4;
    imageData.data[o] = c;
    imageData.data[o + 1] = c;
    imageData.data[o + 2] = c;
    imageData.data[o + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

let cachedNormal: Texture | null = null;
let cachedMicroScratch: Texture | null = null;
let cachedColorDepth: Texture | null = null;
let cachedRoughness: Texture | null = null;

function getOrangePeelNormal(): Texture {
  if (!cachedNormal) cachedNormal = buildOrangePeelNormal();
  return cachedNormal;
}

function getMicroScratchNormal(): Texture {
  if (!cachedMicroScratch) cachedMicroScratch = buildMicroScratchNormal();
  return cachedMicroScratch;
}

function getColorDepthMap(): Texture {
  if (!cachedColorDepth) cachedColorDepth = buildColorDepthMap();
  return cachedColorDepth;
}

function getClearcoatRoughness(): Texture {
  if (!cachedRoughness) cachedRoughness = buildClearcoatRoughness();
  return cachedRoughness;
}

// Apply procedural PBR paint to a MeshPhysicalMaterial. Call after setting color.
export function applyProceduralPaint(material: MeshPhysicalMaterial, _paintHex: number) {
  material.normalMap = getOrangePeelNormal();
  material.normalScale.set(0.42, 0.42);
  material.clearcoatRoughnessMap = getClearcoatRoughness();
  material.clearcoatRoughness = 0.22;
  material.roughness = 0.38;
  material.metalness = 0.06;
  material.envMapIntensity = 0.55;
  material.clearcoat = 0.75;
  // Subtle color depth: multiply the base color with a low-freq variation map
  // so panels don't read as a single flat color.
  if (!material.map) material.map = getColorDepthMap();
  material.needsUpdate = true;

  // Inject a second detail normal (micro-scratches) on top of the orange peel.
  const microScratch = getMicroScratchNormal();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMicroScratchMap = { value: microScratch };
    shader.fragmentShader = `
      uniform sampler2D uMicroScratchMap;
    ` + shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      {
        vec3 microN = texture2D(uMicroScratchMap, vNormalMapUv).xyz * 2.0 - 1.0;
        normal = normalize(normal + tbn * vec3(microN.xy * 0.15, 0.0));
      }`,
    );
  };
  material.customProgramCacheKey = () => "car-paint-detail";
}

// Dispose the cached textures (only call on full teardown / scene swap).
export function disposeProceduralPaint() {
  cachedNormal?.dispose();
  cachedMicroScratch?.dispose();
  cachedColorDepth?.dispose();
  cachedRoughness?.dispose();
  cachedNormal = null;
  cachedMicroScratch = null;
  cachedColorDepth = null;
  cachedRoughness = null;
}

// Keep the texture wrapping sane if the body UVs are stretched.
export function setPaintRepeat(material: MeshPhysicalMaterial, repeatX: number, repeatY: number) {
  if (material.normalMap) material.normalMap.repeat.set(repeatX, repeatY);
  if (material.clearcoatRoughnessMap) material.clearcoatRoughnessMap.repeat.set(repeatX, repeatY);
  if (material.map) material.map.repeat.set(repeatX, repeatY);
}

// Re-exported for callers that want to set their own wrapping mode.
export { ClampToEdgeWrapping };
