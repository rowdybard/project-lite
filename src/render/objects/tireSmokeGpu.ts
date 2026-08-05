import { DataTexture, Group, type Texture } from "three";
import type { CarState } from "../../game/types";
import { createGpuParticleSystem, createRadialSpriteTexture, type GpuParticleSystem, type ParticleSystemOptions } from "../../vfx/gpuParticles";
import { buildColorLut, buildScalarLut, disposeLuts } from "../../vfx/particleCurves";
import { buildSystemOptions, loadPresetTexture, loadSavedPresets, type VfxPreset } from "../../vfx/presets";

// Tire smoke on the GPU particle runtime: one emitter per rear wheel contact patch, intensity
// and heat-color driven by REAR SLIP + HEAT telemetry. Same public API as the old CPU system.

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;

// --- Explicit resource bundle ---
// The tire-smoke object owns exactly one bundle of shared resources.
// Both emitters share the same texture and LUTs. The bundle is disposed
// exactly once on teardown or when replaced by a preset.
type SmokeResources = {
  texture: Texture;
  luts: DataTexture[];
  options: ParticleSystemOptions;
  kind: "default" | "preset";
};

function createDefaultResources(): SmokeResources {
  const texture = createRadialSpriteTexture();
  const sizeOverLife = buildScalarLut([
    { t: 0, value: 1.12 },
    { t: 0.58, value: 2.25 },
    { t: 1, value: 3.3 },
  ]);
  const opacityOverLife = buildScalarLut([
    { t: 0, value: 0.56 },
    { t: 0.42, value: 0.27 },
    { t: 1, value: 0 },
  ]);
  const colorOverLife = buildColorLut([
    { t: 0, r: 0.94, g: 0.94, b: 0.91 },
    { t: 0.58, r: 0.76, g: 0.76, b: 0.73 },
    { t: 1, r: 0.58, g: 0.58, b: 0.55 },
  ]);
  return {
    texture,
    luts: [sizeOverLife, opacityOverLife, colorOverLife],
    options: {
      texture,
      maxInstances: 640,
      blending: "normal",
      billboard: "camera",
      space: "world",
      emitter: { type: "point" },
      rate: 0,
      life: [1.05, 1.8],
      speed: [0.28, 0.78],
      gravity: 0.62,
      drag: 0.28,
      curlNoise: 0.32,
      startSize: [0.62, 1.02],
      rotationSpeed: [-0.9, 0.9],
      groundFade: 0.38,
      sizeOverLife,
      opacityOverLife,
      colorOverLife,
      renderOrder: 12,
    },
    kind: "default",
  };
}

function disposeResources(resources: SmokeResources) {
  disposeLuts(...resources.luts);
  resources.texture.dispose();
}

const TIRE_SMOKE_PRESET_KEY = "driftAttack.tireSmokePreset.v1";

export function loadTireSmokePresetName(): string | null {
  try {
    return localStorage.getItem(TIRE_SMOKE_PRESET_KEY);
  } catch {
    return null;
  }
}

export function saveTireSmokePresetName(name: string): { saved: true } | { saved: false; reason: string } {
  try {
    localStorage.setItem(TIRE_SMOKE_PRESET_KEY, name);
    return { saved: true };
  } catch (error) {
    return { saved: false, reason: error instanceof Error ? error.message : "storage unavailable" };
  }
}

export function clearTireSmokePresetName() {
  try {
    localStorage.removeItem(TIRE_SMOKE_PRESET_KEY);
  } catch {
    // Storage disabled — silently ignore
  }
}

export async function resolveTireSmokePreset(): Promise<VfxPreset | null> {
  const name = loadTireSmokePresetName();
  if (!name) return null;
  try {
    const saved = loadSavedPresets();
    const preset = saved.find((p) => p.name === name) ?? null;
    if (!preset) {
      // Preset was deleted — clear the stale key
      clearTireSmokePresetName();
    }
    return preset;
  } catch {
    return null;
  }
}

// Result type for applyPreset — reports whether the preset actually applied
export type ApplyPresetResult = { applied: true } | { applied: false; reason: string };

export function createTireSmoke() {
  const root = new Group();
  let generation = 0;  // Async race protection
  let disposed = false;

  // One explicit resource bundle — shared between both emitters
  let resources: SmokeResources = createDefaultResources();
  // Paint tint override — only applies to default smoke, not presets
  let paintTint: { r: number; g: number; b: number } | null = null;
  // Dedicated override LUT for paint tint (separate from the bundle's colorOverLife)
  let paintOverrideLut: DataTexture | null = null;

  function disposePaintOverride() {
    paintOverrideLut?.dispose();
    paintOverrideLut = null;
  }

  function restoreBundleColorLut() {
    resources.options.colorOverLife = resources.luts[2];
  }

  function sameTint(
    a: { r: number; g: number; b: number } | null,
    b: { r: number; g: number; b: number } | null,
  ) {
    if (a === null || b === null) return a === b;
    return (
      Math.abs(a.r - b.r) < 1e-6 &&
      Math.abs(a.g - b.g) < 1e-6 &&
      Math.abs(a.b - b.b) < 1e-6
    );
  }

  let emitters: GpuParticleSystem[] = rearOffsets.map(() => {
    return createGpuParticleSystem(resources.options);
  });
  for (const emitter of emitters) root.add(emitter.root);

  function disposeEmitters() {
    for (const emitter of emitters) {
      root.remove(emitter.root);
      emitter.dispose();
    }
    emitters = [];
  }

  function rebuildEmittersFromResources() {
    disposeEmitters();
    resources.options.rate = 0;  // Update loop drives rate from slip telemetry
    emitters = rearOffsets.map(() => createGpuParticleSystem(resources.options));
    for (const emitter of emitters) root.add(emitter.root);
  }

  // Install paint tint curve on default smoke — disposes prior override, rebuilds emitters once
  function installDefaultPaintCurve() {
    disposePaintOverride();
    if (!paintTint) {
      restoreBundleColorLut();
    } else {
      // Create a pink-to-white color curve based on normalized particle age
      paintOverrideLut = buildColorLut([
        { t: 0, r: paintTint.r, g: paintTint.g, b: paintTint.b },
        { t: 0.5, r: paintTint.r * 0.6 + 0.95 * 0.4, g: paintTint.g * 0.6 + 0.95 * 0.4, b: paintTint.b * 0.6 + 0.95 * 0.4 },
        { t: 1, r: 0.95, g: 0.95, b: 0.95 },
      ]);
      resources.options.colorOverLife = paintOverrideLut;
    }
    rebuildEmittersFromResources();
  }

  // Build preset resources fully before destroying active smoke
  async function buildPresetResources(preset: VfxPreset): Promise<SmokeResources> {
    const texture = await loadPresetTexture(preset);
    let built: ReturnType<typeof buildSystemOptions> | null = null;
    try {
      built = buildSystemOptions(preset, texture);
      return {
        texture,
        luts: built.luts,
        options: {
          ...built.options,
          rate: 0,
        },
        kind: "preset",
      };
    } catch (error) {
      if (built) disposeLuts(...built.luts);
      texture.dispose();
      throw error;
    }
  }

  return {
    root,
    reset() {
      for (const emitter of emitters) {
        emitter.reset();
        emitter.setRate(0);
      }
    },
    async applyPreset(preset: VfxPreset): Promise<ApplyPresetResult> {
      const requestGeneration = ++generation;
      let candidate: SmokeResources;

      try {
        candidate = await buildPresetResources(preset);
      } catch (error) {
        return {
          applied: false,
          reason: error instanceof Error ? error.message : "Could not build preset resources",
        };
      }

      if (disposed || requestGeneration !== generation) {
        disposeResources(candidate);
        return { applied: false, reason: "superseded" };
      }

      // Candidate is fully valid before active smoke is touched
      disposeEmitters();
      disposePaintOverride();
      disposeResources(resources);

      resources = candidate;
      rebuildEmittersFromResources();

      return { applied: true };
    },
    clearPreset() {
      generation += 1;  // Invalidate any pending preset application
      disposeEmitters();
      disposePaintOverride();
      disposeResources(resources);

      resources = createDefaultResources();
      installDefaultPaintCurve();
    },
    setPaintTint(next: { r: number; g: number; b: number } | null) {
      if (sameTint(paintTint, next)) return;
      paintTint = next ? { ...next } : null;
      // Paint tint only applies to default smoke, not presets
      if (resources.kind === "default") {
        installDefaultPaintCurve();
      }
    },
    update(car: CarState, onTrack: boolean, dt: number) {
      const wheelSlip = Math.max(car.rearSlipVisual, car.handbrakeAmount * 0.72, car.slipAmount * 0.55);
      const activeSlide = Math.max(0, wheelSlip - 0.09);
      const heatBoost = 0.78 + car.tireHeat * 0.52;
      const strength = activeSlide * heatBoost * 1.28 * (onTrack ? 1 : 0.18);
      const rate = strength > 0.05 ? strength * Math.max(car.speed, 4) * 4.8 : 0;

      const sin = Math.sin(car.heading);
      const cos = Math.cos(car.heading);
      const heatTint = Math.min(1, car.tireHeat);

      // Heat-based tint: white -> warm gray as tires heat up.
      // For default smoke with paint tint, the color curve handles pink-to-white,
      // so we only apply heat tint to the setTint uniform (affects brightness, not hue).
      const tintR = 0.92 + (0.85 - 0.92) * heatTint;
      const tintG = 0.93 + (0.72 - 0.93) * heatTint;
      const tintB = 0.94 + (0.6 - 0.94) * heatTint;

      for (let i = 0; i < emitters.length; i++) {
        const offset = rearOffsets[i];
        const emitter = emitters[i];
        emitter.root.position.set(
          car.position.x + offset * cos + rearAxleZ * sin,
          0.3,
          car.position.z - offset * sin + rearAxleZ * cos,
        );
        emitter.setRate(rate);
        emitter.setTint(tintR, tintG, tintB);
        emitter.update(dt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      disposeEmitters();
      disposePaintOverride();
      disposeResources(resources);
    },
  };
}
