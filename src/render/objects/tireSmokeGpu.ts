import { Group } from "three";
import type { CarState } from "../../game/types";
import { createGpuParticleSystem, createRadialSpriteTexture, type GpuParticleSystem, type ParticleSystemOptions } from "../../vfx/gpuParticles";
import { buildColorLut, buildScalarLut } from "../../vfx/particleCurves";
import { buildSystemOptions, loadPresetTexture, loadSavedPresets, type VfxPreset } from "../../vfx/presets";

// Tire smoke on the GPU particle runtime: one emitter per rear wheel contact patch, intensity
// and heat-color driven by REAR SLIP + HEAT telemetry. Same public API as the old CPU system.

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;

const defaultSmokeOptions: ParticleSystemOptions = {
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

function createSmokeEmitter(options?: ParticleSystemOptions): GpuParticleSystem {
  return createGpuParticleSystem(options ?? defaultSmokeOptions);
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
  return saved.find((p) => p.name === name) ?? null;
}

export function createTireSmoke() {
  const root = new Group();
  let emitters = rearOffsets.map(() => createSmokeEmitter());
  for (const emitter of emitters) root.add(emitter.root);

  function rebuildFromPreset(preset: VfxPreset, texture: import("three").Texture) {
    // Dispose old emitters
    for (const emitter of emitters) {
      root.remove(emitter.root);
      emitter.dispose();
    }
    const built = buildSystemOptions(preset, texture);
    // Force rate to 0 — the update loop drives it from slip telemetry
    built.options.rate = 0;
    emitters = rearOffsets.map(() => createSmokeEmitter(built.options));
    for (const emitter of emitters) root.add(emitter.root);
  }

  function resetToDefault() {
    for (const emitter of emitters) {
      root.remove(emitter.root);
      emitter.dispose();
    }
    emitters = rearOffsets.map(() => createSmokeEmitter());
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
      const texture = await loadPresetTexture(preset);
      rebuildFromPreset(preset, texture);
    },
    clearPreset() {
      resetToDefault();
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
  };
}
