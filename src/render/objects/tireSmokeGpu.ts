import { Group } from "three";
import type { CarState } from "../../game/types";
import { createGpuParticleSystem, createRadialSpriteTexture, type GpuParticleSystem } from "../../vfx/gpuParticles";
import { buildColorLut, buildScalarLut } from "../../vfx/particleCurves";

// Tire smoke on the GPU particle runtime: one emitter per rear wheel contact patch, intensity
// and heat-color driven by REAR SLIP + HEAT telemetry. Same public API as the old CPU system.

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;

function createSmokeEmitter(): GpuParticleSystem {
  return createGpuParticleSystem({
    texture: createRadialSpriteTexture(),
    maxInstances: 640,
    blending: "normal",
    billboard: "camera",
    space: "world",
    emitter: { type: "point" },
    rate: 0,
    life: [0.9, 1.6],
    speed: [0.15, 0.5],
    gravity: 0.46,
    drag: 0.2,
    curlNoise: 0.25,
    startSize: [0.5, 0.85],
    rotationSpeed: [-0.9, 0.9],
    groundFade: 0.45,
    sizeOverLife: buildScalarLut([
      { t: 0, value: 1.25 },
      { t: 1, value: 3.05 },
    ]),
    opacityOverLife: buildScalarLut([
      { t: 0, value: 0.42 },
      { t: 0.45, value: 0.18 },
      { t: 1, value: 0 },
    ]),
    colorOverLife: buildColorLut([
      { t: 0, r: 0.96, g: 0.96, b: 0.94 },
      { t: 0.6, r: 0.82, g: 0.82, b: 0.8 },
      { t: 1, r: 0.7, g: 0.7, b: 0.68 },
    ]),
    renderOrder: 12,
  });
}

export function createTireSmoke() {
  const root = new Group();
  const emitters = rearOffsets.map(() => createSmokeEmitter());
  for (const emitter of emitters) root.add(emitter.root);

  return {
    root,
    reset() {
      for (const emitter of emitters) {
        emitter.reset();
        emitter.setRate(0);
      }
    },
    update(car: CarState, onTrack: boolean, dt: number) {
      const activeSlide = Math.max(0, car.rearSlipVisual - 0.18);
      const heatBoost = 0.72 + car.tireHeat * 0.48;
      const strength = activeSlide * heatBoost * 1.18 * (onTrack ? 1 : 0.35);
      const rate = strength > 0.12 ? strength * car.speed * 3 : 0;

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
