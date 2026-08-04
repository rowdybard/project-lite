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
