import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  RGBAFormat,
} from "three";

// Over-lifetime curves baked into 64-entry 1D LUT textures, sampled in the vertex/fragment
// shaders at t = age/life. Stops are sorted by t and linearly interpolated.
export type ScalarStop = { t: number; value: number };
export type ColorStop = { t: number; r: number; g: number; b: number };

const LUT_SIZE = 64;

function sortStops<T extends { t: number }>(stops: T[]): T[] {
  return [...stops].sort((a, b) => a.t - b.t);
}

export function sampleScalarStops(stops: ScalarStop[], t: number): number {
  const sorted = sortStops(stops);
  if (sorted.length === 0) return 1;
  if (t <= sorted[0].t) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].value;
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].t) {
      const span = sorted[i].t - sorted[i - 1].t || 1;
      const mix = (t - sorted[i - 1].t) / span;
      return sorted[i - 1].value + (sorted[i].value - sorted[i - 1].value) * mix;
    }
  }
  return sorted[sorted.length - 1].value;
}

export function sampleColorStops(stops: ColorStop[], t: number): [number, number, number] {
  const sorted = sortStops(stops);
  if (sorted.length === 0) return [1, 1, 1];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (t <= first.t) return [first.r, first.g, first.b];
  if (t >= last.t) return [last.r, last.g, last.b];
  for (let i = 1; i < sorted.length; i++) {
    if (t <= sorted[i].t) {
      const span = sorted[i].t - sorted[i - 1].t || 1;
      const mix = (t - sorted[i - 1].t) / span;
      return [
        sorted[i - 1].r + (sorted[i].r - sorted[i - 1].r) * mix,
        sorted[i - 1].g + (sorted[i].g - sorted[i - 1].g) * mix,
        sorted[i - 1].b + (sorted[i].b - sorted[i - 1].b) * mix,
      ];
    }
  }
  return [last.r, last.g, last.b];
}

function finalize(texture: DataTexture) {
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

// Half-float LUTs: linear filtering on 16F is core WebGL2, while 32F filtering needs an
// extension that isn't universal. Values up to ~65k fit, so curve ranges are unconstrained.
function toHalfData(values: number[]): Uint16Array {
  const data = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) data[i] = DataUtils.toHalfFloat(values[i]);
  return data;
}

export function buildScalarLut(stops: ScalarStop[]): DataTexture {
  const values: number[] = [];
  for (let i = 0; i < LUT_SIZE; i++) values.push(sampleScalarStops(stops, i / (LUT_SIZE - 1)));
  return finalize(new DataTexture(toHalfData(values), LUT_SIZE, 1, RedFormat, HalfFloatType));
}

export function buildColorLut(stops: ColorStop[]): DataTexture {
  const values: number[] = [];
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b] = sampleColorStops(stops, i / (LUT_SIZE - 1));
    values.push(r, g, b, 1);
  }
  return finalize(new DataTexture(toHalfData(values), LUT_SIZE, 1, RGBAFormat, HalfFloatType));
}

export function disposeLuts(...textures: (DataTexture | null | undefined)[]) {
  for (const texture of textures) texture?.dispose();
}
