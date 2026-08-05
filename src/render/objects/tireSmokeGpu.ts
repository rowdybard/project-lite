import { Group, type Texture } from "three";
import type { CarState } from "../../game/types";
import { createGpuParticleSystem, createRadialSpriteTexture, type GpuParticleSystem, type ParticleSystemOptions } from "../../vfx/gpuParticles";
import { buildColorLut, buildScalarLut, disposeLuts } from "../../vfx/particleCurves";
import { buildSystemOptions, loadPresetTexture, loadSavedPresets, type VfxPreset } from "../../vfx/presets";

// Tire smoke on the GPU particle runtime: one emitter per rear wheel contact patch, intensity
// and heat-color driven by REAR SLIP + HEAT telemetry. Same public API as the old CPU system.

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;

// Default smoke resources — owned by the tire smoke system and disposed on teardown
function createDefaultOptions(): ParticleSystemOptions {
  return {
    texture: createRadialSpriteTexture(),
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
    sizeOverLife: buildScalarLut([
      { t: 0, value: 1.12 },
      { t: 0.58, value: 2.25 },
      { t: 1, value: 3.3 },
    ]),
    opacityOverLife: buildScalarLut([
      { t: 0, value: 0.56 },
      { t: 0.42, value: 0.27 },
      { t: 1, value: 0 },
    ]),
    colorOverLife: buildColorLut([
      { t: 0, r: 0.94, g: 0.94, b: 0.91 },
      { t: 0.58, r: 0.76, g: 0.76, b: 0.73 },
      { t: 1, r: 0.58, g: 0.58, b: 0.55 },
    ]),
    renderOrder: 12,
  };
}

const TIRE_SMOKE_PRESET_KEY = "driftAttack.tireSmokePreset.v1";

export function loadTireSmokePresetName(): string | null {
  return localStorage.getItem(TIRE_SMOKE_PRESET_KEY);
}

export function saveTireSmokePresetName(name: string) {
  localStorage.setItem(TIRE_SMOKE_PRESET_KEY, name);
}

export function clearTireSmokePresetName() {
  localStorage.removeItem(TIRE_SMOKE_PRESET_KEY);
}

export async function resolveTireSmokePreset(): Promise<VfxPreset | null> {
  const name = loadTireSmokePresetName();
  if (!name) return null;
  const saved = loadSavedPresets();
  const preset = saved.find((p) => p.name === name) ?? null;
  if (!preset) {
    // Preset was deleted — clear the stale key
    clearTireSmokePresetName();
  }
  return preset;
}

export function createTireSmoke() {
  const root = new Group();
  let generation = 0;  // Async race protection
  let disposed = false;

  // Shared resource ownership: the current texture and LUTs are owned here,
  // not by individual emitters. Emitters are disposed first, then shared resources.
  let currentTexture: Texture = createRadialSpriteTexture();
  let currentLuts: (import("three").DataTexture | null)[] = [];
  let usingDefault = true;
  // Optional paint-driven tint override. When set, smoke blends toward this color
  // instead of the default gray heat tint. Cleared by passing null.
  let paintTint: { r: number; g: number; b: number } | null = null;

  let emitters: GpuParticleSystem[] = rearOffsets.map(() => {
    const opts = createDefaultOptions();
    currentTexture = opts.texture!;
    return createGpuParticleSystem(opts);
  });
  for (const emitter of emitters) root.add(emitter.root);

  function disposeEmitters() {
    for (const emitter of emitters) {
      root.remove(emitter.root);
      emitter.dispose();
    }
    emitters = [];
  }

  function disposeSharedResources() {
    // Dispose LUTs exactly once
    if (currentLuts.length > 0) {
      disposeLuts(...currentLuts);
      currentLuts = [];
    }
    // Dispose the preset texture (but not the default radial sprite — it's recreated each time)
    if (!usingDefault && currentTexture) {
      currentTexture.dispose();
    }
    usingDefault = true;
  }

  function rebuildFromPreset(preset: VfxPreset, texture: Texture) {
    // 1. Dispose old emitters first (they reference shared resources)
    disposeEmitters();
    // 2. Dispose old shared resources
    disposeSharedResources();

    // 3. Build new shared resources
    const built = buildSystemOptions(preset, texture);
    currentTexture = texture;
    currentLuts = built.luts;
    usingDefault = false;

    // 4. Create new emitters sharing the new resources
    built.options.rate = 0;  // Update loop drives rate from slip telemetry
    emitters = rearOffsets.map(() => createGpuParticleSystem(built.options));
    for (const emitter of emitters) root.add(emitter.root);
  }

  function resetToDefault() {
    disposeEmitters();
    disposeSharedResources();

    const opts = createDefaultOptions();
    currentTexture = opts.texture!;
    usingDefault = true;
    emitters = rearOffsets.map(() => createGpuParticleSystem(opts));
    for (const emitter of emitters) root.add(emitter.root);
  }

  return {
    root,
    reset() {
      for (const emitter of emitters) {
        emitter.reset();
        emitter.setRate(0);
      }
    },
    async applyPreset(preset: VfxPreset) {
      const gen = ++generation;
      try {
        const texture = await loadPresetTexture(preset);
        if (disposed || gen !== generation) {
          // Superseded — dispose the texture we just loaded
          texture.dispose();
          return;
        }
        rebuildFromPreset(preset, texture);
      } catch {
        // Texture load failed — keep current smoke, don't save preset name
        if (gen === generation) {
          // Stay on whatever was active before
        }
      }
    },
    clearPreset() {
      generation++;  // Invalidate any pending preset application
      resetToDefault();
    },
    setPaintTint(tint: { r: number; g: number; b: number } | null) {
      paintTint = tint;
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

      // Default heat-based tint: white -> warm gray as tires heat up
      let tintR = 0.92 + (0.85 - 0.92) * heatTint;
      let tintG = 0.93 + (0.72 - 0.93) * heatTint;
      let tintB = 0.94 + (0.6 - 0.94) * heatTint;

      // When a paint tint is set, blend toward pink/white: fresh smoke is pink-tinted,
      // fading to white as it ages (driven by heatTint as a proxy for life).
      if (paintTint) {
        const pinkWeight = 1 - heatTint * 0.6;  // pink fades as heat rises
        tintR = paintTint.r * pinkWeight + 0.95 * (1 - pinkWeight);
        tintG = paintTint.g * pinkWeight + 0.95 * (1 - pinkWeight);
        tintB = paintTint.b * pinkWeight + 0.95 * (1 - pinkWeight);
      }

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
      generation++;  // Invalidate any pending async load
      disposeEmitters();
      disposeSharedResources();
      // Dispose the default texture if it's still active
      if (usingDefault && currentTexture) {
        currentTexture.dispose();
      }
    },
  };
}
