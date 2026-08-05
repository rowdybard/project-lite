import { CanvasTexture, SRGBColorSpace, Texture, TextureLoader } from "three";
import { particleBudgetLimits } from "./budget";
import { buildColorLut, buildScalarLut, type ColorStop, type ScalarStop } from "./particleCurves";
import { createRadialSpriteTexture, type ParticleSystemOptions } from "./gpuParticles";

// Player-facing effect presets: JSON schema, built-ins authored in the same format the editor
// saves, validation with hard clamps (budget governor), localStorage persistence, and
// share-string/export helpers.

export type BuiltinTextureId = "soft-circle" | "spark" | "droplet" | "flame";

export type VfxPreset = {
  version: 1;
  name: string;
  texture: { kind: "builtin"; id: BuiltinTextureId } | { kind: "upload"; dataUrl: string };
  blending: "normal" | "additive";
  billboard: "camera" | "velocity";
  space: "world" | "local";
  emitter: { type: "point" } | { type: "sphere"; radius: number } | { type: "cone"; radius: number; angle: number };
  rate: number;
  life: [number, number];
  speed: [number, number];
  gravity: number;
  drag: number;
  curlNoise: number;
  startSize: [number, number];
  rotationSpeed: [number, number];
  stretch: number;
  groundFade: number;
  sizeOverLife: ScalarStop[];
  opacityOverLife: ScalarStop[];
  colorOverLife: ColorStop[];
  flipbook: { cols: number; rows: number; fps: number } | null;
  maxInstances: number;
};

const STORAGE_KEY = "vfxPresets.v1";

export const builtinTextureIds: { id: BuiltinTextureId; label: string }[] = [
  { id: "soft-circle", label: "Soft Circle" },
  { id: "spark", label: "Spark" },
  { id: "droplet", label: "Droplet Streak" },
  { id: "flame", label: "Flame" },
];

function createStreakTexture(width: number, height: number, coreAlpha: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(0.5, `rgba(255, 255, 255, ${coreAlpha})`);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  return new CanvasTexture(canvas);
}

function createSparkTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(0.42, "rgba(255, 255, 255, 0.18)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function createBuiltinTexture(id: BuiltinTextureId): Texture {
  let texture: Texture;
  switch (id) {
    case "spark":
      texture = createSparkTexture();
      break;
    case "droplet":
      texture = createStreakTexture(16, 128, 0.85);
      break;
    case "flame":
      texture = createRadialSpriteTexture(128, 0.95);
      break;
    default:
      texture = createRadialSpriteTexture();
  }
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export const builtinPresets: VfxPreset[] = [
  {
    version: 1,
    name: "Tire Smoke",
    texture: { kind: "builtin", id: "soft-circle" },
    blending: "normal",
    billboard: "camera",
    space: "world",
    emitter: { type: "point" },
    rate: 90,
    life: [0.9, 1.6],
    speed: [0.15, 0.5],
    gravity: 0.46,
    drag: 0.2,
    curlNoise: 0.25,
    startSize: [0.5, 0.85],
    rotationSpeed: [-0.9, 0.9],
    stretch: 0.12,
    groundFade: 0.45,
    sizeOverLife: [
      { t: 0, value: 1.25 },
      { t: 1, value: 3.05 },
    ],
    opacityOverLife: [
      { t: 0, value: 0.42 },
      { t: 0.18, value: 0.68 },
      { t: 0.58, value: 0.38 },
      { t: 1, value: 0 },
    ],
    colorOverLife: [{ t: 0, r: 0.92, g: 0.93, b: 0.94 }],
    flipbook: null,
    maxInstances: 640,
  },
  {
    version: 1,
    name: "Fire",
    texture: { kind: "builtin", id: "flame" },
    blending: "additive",
    billboard: "camera",
    space: "local",
    emitter: { type: "cone", radius: 0.35, angle: 0.32 },
    rate: 120,
    life: [0.5, 0.9],
    speed: [1.2, 2.2],
    gravity: 1.6,
    drag: 0.8,
    curlNoise: 0.5,
    startSize: [0.5, 0.8],
    rotationSpeed: [-1.6, 1.6],
    stretch: 0.12,
    groundFade: 0,
    sizeOverLife: [
      { t: 0, value: 0.6 },
      { t: 0.3, value: 1.2 },
      { t: 1, value: 1.8 },
    ],
    opacityOverLife: [
      { t: 0, value: 0.9 },
      { t: 0.6, value: 0.5 },
      { t: 1, value: 0 },
    ],
    colorOverLife: [
      { t: 0, r: 1, g: 0.86, b: 0.5 },
      { t: 0.45, r: 1, g: 0.42, b: 0.12 },
      { t: 1, r: 0.45, g: 0.06, b: 0.02 },
    ],
    flipbook: null,
    maxInstances: 512,
  },
  {
    version: 1,
    name: "Rain",
    texture: { kind: "builtin", id: "droplet" },
    blending: "normal",
    billboard: "velocity",
    space: "world",
    emitter: { type: "sphere", radius: 14 },
    rate: 600,
    life: [0.7, 0.9],
    speed: [16, 20],
    gravity: -6,
    drag: 0,
    curlNoise: 0,
    startSize: [0.06, 0.1],
    rotationSpeed: [0, 0],
    stretch: 0.09,
    groundFade: 0,
    sizeOverLife: [{ t: 0, value: 1 }],
    opacityOverLife: [
      { t: 0, value: 0.3 },
      { t: 0.15, value: 0.5 },
      { t: 0.85, value: 0.5 },
      { t: 1, value: 0 },
    ],
    colorOverLife: [{ t: 0, r: 0.7, g: 0.78, b: 0.88 }],
    flipbook: null,
    maxInstances: 1500,
  },
  {
    version: 1,
    name: "Sparks",
    texture: { kind: "builtin", id: "spark" },
    blending: "additive",
    billboard: "velocity",
    space: "world",
    emitter: { type: "cone", radius: 0.1, angle: 0.55 },
    rate: 220,
    life: [0.35, 0.8],
    speed: [6, 11],
    gravity: -14,
    drag: 1.4,
    curlNoise: 0,
    startSize: [0.08, 0.14],
    rotationSpeed: [0, 0],
    stretch: 0.05,
    groundFade: 0,
    sizeOverLife: [{ t: 0, value: 1 }],
    opacityOverLife: [
      { t: 0, value: 1 },
      { t: 0.7, value: 0.8 },
      { t: 1, value: 0 },
    ],
    colorOverLife: [
      { t: 0, r: 1, g: 0.92, b: 0.62 },
      { t: 1, r: 1, g: 0.45, b: 0.1 },
    ],
    flipbook: null,
    maxInstances: 640,
  },
];

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cleanRange(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return [fallback[0], fallback[1]];
  const a = num(value[0], fallback[0]);
  const b = num(value[1], fallback[1]);
  return a <= b ? [a, b] : [b, a];
}

function cleanScalarStops(value: unknown, fallback: ScalarStop[]): ScalarStop[] {
  if (!Array.isArray(value) || value.length === 0) return fallback.map((stop) => ({ ...stop }));
  return value.slice(0, 8).map((stop) => ({
    t: clamp(num(stop?.t, 0), 0, 1),
    value: clamp(num(stop?.value, 1), 0, 8),
  }));
}

function cleanColorStops(value: unknown, fallback: ColorStop[]): ColorStop[] {
  if (!Array.isArray(value) || value.length === 0) return fallback.map((stop) => ({ ...stop }));
  return value.slice(0, 8).map((stop) => ({
    t: clamp(num(stop?.t, 0), 0, 1),
    r: clamp(num(stop?.r, 1), 0, 1),
    g: clamp(num(stop?.g, 1), 0, 1),
    b: clamp(num(stop?.b, 1), 0, 1),
  }));
}

// Accepts unknown JSON (import/share string) and returns a fully-clamped, safe preset.
export function validatePreset(raw: unknown): VfxPreset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const fallback = builtinPresets[0];
  const textureRaw = data.texture as Record<string, unknown> | undefined;
  const texture: VfxPreset["texture"] =
    textureRaw?.kind === "upload" && typeof textureRaw.dataUrl === "string" && textureRaw.dataUrl.startsWith("data:image/png")
      ? { kind: "upload", dataUrl: textureRaw.dataUrl.slice(0, 2_000_000) }
      : { kind: "builtin", id: (["soft-circle", "spark", "droplet", "flame"] as const).includes(textureRaw?.id as BuiltinTextureId) ? (textureRaw!.id as BuiltinTextureId) : "soft-circle" };

  const emitterRaw = data.emitter as Record<string, unknown> | undefined;
  const emitter: VfxPreset["emitter"] =
    emitterRaw?.type === "sphere"
      ? { type: "sphere", radius: clamp(num(emitterRaw.radius, 1), 0, 60) }
      : emitterRaw?.type === "cone"
        ? { type: "cone", radius: clamp(num(emitterRaw.radius, 0.3), 0, 20), angle: clamp(num(emitterRaw.angle, 0.4), 0, 1.5) }
        : { type: "point" };

  const flipbookRaw = data.flipbook as Record<string, unknown> | null | undefined;
  const flipbook = flipbookRaw
    ? {
        cols: clamp(Math.round(num(flipbookRaw.cols, 1)), 1, 16),
        rows: clamp(Math.round(num(flipbookRaw.rows, 1)), 1, 16),
        fps: clamp(num(flipbookRaw.fps, 12), 0, 120),
      }
    : null;

  return {
    version: 1,
    name: String(data.name ?? "Custom Effect").slice(0, 40) || "Custom Effect",
    texture,
    blending: data.blending === "additive" ? "additive" : "normal",
    billboard: data.billboard === "velocity" ? "velocity" : "camera",
    space: data.space === "local" ? "local" : "world",
    emitter,
    rate: clamp(num(data.rate, fallback.rate), 0, particleBudgetLimits.maxRate),
    life: cleanRange(data.life, fallback.life),
    speed: cleanRange(data.speed, fallback.speed),
    gravity: clamp(num(data.gravity, fallback.gravity), -30, 30),
    drag: clamp(num(data.drag, fallback.drag), 0, 6),
    curlNoise: clamp(num(data.curlNoise, fallback.curlNoise), 0, 2),
    startSize: cleanRange(data.startSize, fallback.startSize),
    rotationSpeed: cleanRange(data.rotationSpeed, fallback.rotationSpeed),
    stretch: clamp(num(data.stretch, fallback.stretch), 0, 1),
    groundFade: clamp(num(data.groundFade, fallback.groundFade), 0, 2),
    sizeOverLife: cleanScalarStops(data.sizeOverLife, fallback.sizeOverLife),
    opacityOverLife: cleanScalarStops(data.opacityOverLife, fallback.opacityOverLife),
    colorOverLife: cleanColorStops(data.colorOverLife, fallback.colorOverLife),
    flipbook,
    maxInstances: clamp(Math.round(num(data.maxInstances, fallback.maxInstances)), 32, particleBudgetLimits.perSystem),
  };
}

export function loadSavedPresets(): VfxPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.map(validatePreset).filter((preset): preset is VfxPreset => preset !== null);
  } catch {
    return [];
  }
}

export function savePreset(preset: VfxPreset): VfxPreset[] {
  const presets = loadSavedPresets().filter((item) => item.name !== preset.name);
  presets.push(preset);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "QuotaExceededError"
      ? "Storage quota exceeded — delete a preset or use a smaller texture."
      : "Could not save preset (storage unavailable).");
  }
  return presets;
}

export function deletePreset(name: string): VfxPreset[] {
  const presets = loadSavedPresets().filter((item) => item.name !== name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Deletion failed — return current list
  }
  return presets;
}

export function presetToShareString(preset: VfxPreset): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(preset))));
}

export function presetFromShareString(share: string): VfxPreset | null {
  try {
    return validatePreset(JSON.parse(decodeURIComponent(escape(atob(share.trim())))));
  } catch {
    return null;
  }
}

export async function loadPresetTexture(preset: VfxPreset): Promise<Texture> {
  if (preset.texture.kind === "builtin") return createBuiltinTexture(preset.texture.id);
  const texture = await new TextureLoader().loadAsync(preset.texture.dataUrl);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildSystemOptions(preset: VfxPreset, texture: Texture) {
  const sizeLut = buildScalarLut(preset.sizeOverLife);
  const opacityLut = buildScalarLut(preset.opacityOverLife);
  const colorLut = buildColorLut(preset.colorOverLife);
  const options: ParticleSystemOptions = {
    texture,
    maxInstances: preset.maxInstances,
    blending: preset.blending,
    billboard: preset.billboard,
    space: preset.space,
    emitter: preset.emitter,
    rate: preset.rate,
    life: preset.life,
    speed: preset.speed,
    gravity: preset.gravity,
    drag: preset.drag,
    curlNoise: preset.curlNoise,
    startSize: preset.startSize,
    rotationSpeed: preset.rotationSpeed,
    stretch: preset.stretch,
    groundFade: preset.groundFade,
    sizeOverLife: sizeLut,
    opacityOverLife: opacityLut,
    colorOverLife: colorLut,
    flipbook: preset.flipbook,
    renderOrder: 12,
  };
  return { options, luts: [sizeLut, opacityLut, colorLut] };
}
