import {
  CanvasTexture,
  RepeatWrapping,
  type MeshStandardMaterial,
  type Texture,
} from "three";

// Custom shader extensions on top of the standard PBR asphalt: a fine detail-normal layer for
// close-up grain, low-frequency roughness variation so arena light pools break up naturally,
// and a dormant wetness/puddle hook for the future rain phase. The base texture art is kept.

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
        const i00 = grid[y0 * (gridSize + 1) + x0];
        const i10 = grid[y0 * (gridSize + 1) + x0 + 1];
        const i01 = grid[(y0 + 1) * (gridSize + 1) + x0];
        const i11 = grid[(y0 + 1) * (gridSize + 1) + x0 + 1];
        const top = i00 + (i10 - i00) * sx;
        const bottom = i01 + (i11 - i01) * sx;
        heights[y * size + x] += (top + (bottom - top) * sy) * amplitude;
      }
    }
    totalAmplitude += amplitude;
    amplitude *= 0.5;
    gridSize *= 2;
  }
  for (let i = 0; i < heights.length; i++) heights[i] /= totalAmplitude;
  return heights;
}

function heightToNormalTexture(heights: Float32Array, size: number, strength: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const at = (x: number, y: number) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const invLength = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      image.data[i] = (-dx * invLength * 0.5 + 0.5) * 255;
      image.data[i + 1] = (-dy * invLength * 0.5 + 0.5) * 255;
      image.data[i + 2] = invLength * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

function heightsToGrayTexture(heights: Float32Array, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < heights.length; i++) {
    const v = heights[i] * 255;
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

let detailNormalMap: Texture | null = null;
let roughNoiseMap: Texture | null = null;
let puddlePlaceholder: Texture | null = null;

function getDetailNormalMap() {
  if (!detailNormalMap) detailNormalMap = heightToNormalTexture(buildValueNoise(256, 24, 3, 7331), 256, 2.2);
  return detailNormalMap;
}

function getRoughNoiseMap() {
  if (!roughNoiseMap) roughNoiseMap = heightsToGrayTexture(buildValueNoise(256, 6, 4, 1957), 256);
  return roughNoiseMap;
}

function getPuddlePlaceholder() {
  if (!puddlePlaceholder) puddlePlaceholder = heightsToGrayTexture(new Float32Array(4), 2);
  return puddlePlaceholder;
}

export type AsphaltDetailUniforms = {
  uWetness: { value: number };
  uPuddleMask: { value: Texture };
};

// Requires the material to have `map` (uses vMapUv) and a tangent-space normalMap.
// Returns the live uniforms so a future rain phase can drive uWetness/uPuddleMask.
export function applyAsphaltDetail(material: MeshStandardMaterial): AsphaltDetailUniforms {
  const uniforms: AsphaltDetailUniforms = {
    uWetness: { value: 0 },
    uPuddleMask: { value: getPuddlePlaceholder() },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetailNormalMap = { value: getDetailNormalMap() };
    shader.uniforms.uDetailTiling = { value: 3.5 };
    shader.uniforms.uDetailStrength = { value: 0.5 };
    shader.uniforms.uRoughNoiseMap = { value: getRoughNoiseMap() };
    shader.uniforms.uRoughNoiseTiling = { value: 0.22 };
    shader.uniforms.uRoughNoiseAmount = { value: 0.16 };
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uPuddleMask = uniforms.uPuddleMask;
    shader.uniforms.uPuddleTiling = { value: 0.1 };

    shader.fragmentShader = `
      uniform sampler2D uDetailNormalMap;
      uniform float uDetailTiling;
      uniform float uDetailStrength;
      uniform sampler2D uRoughNoiseMap;
      uniform float uRoughNoiseTiling;
      uniform float uRoughNoiseAmount;
      uniform float uWetness;
      uniform sampler2D uPuddleMask;
      uniform float uPuddleTiling;
    ` + shader.fragmentShader
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        {
          float roughNoise = texture2D( uRoughNoiseMap, vMapUv * uRoughNoiseTiling ).r;
          roughnessFactor = clamp( roughnessFactor * mix( 1.0 - uRoughNoiseAmount, 1.0 + uRoughNoiseAmount, roughNoise ), 0.05, 1.0 );
          float puddle = texture2D( uPuddleMask, vMapUv * uPuddleTiling ).r * uWetness;
          roughnessFactor = mix( roughnessFactor, 0.05, puddle );
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        {
          vec3 detailN = texture2D( uDetailNormalMap, vMapUv * uDetailTiling ).xyz * 2.0 - 1.0;
          normal = normalize( normal + tbn * vec3( detailN.xy * uDetailStrength, 0.0 ) );
          float puddleFlatten = texture2D( uPuddleMask, vMapUv * uPuddleTiling ).r * uWetness;
          normal = normalize( mix( normal, nonPerturbedNormal, puddleFlatten * 0.8 ) );
        }`,
      );
  };
  material.customProgramCacheKey = () => "asphalt-detail";
  return uniforms;
}
