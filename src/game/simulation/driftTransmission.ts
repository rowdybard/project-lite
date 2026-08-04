import type { CarTuning } from "../types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const standardDriftTransmission = {
  gearRatios: [3.38, 2.36, 1.65, 1.16] as const,
  shiftUpRedlineFraction: 0.92,
  shiftDownRedlineFraction: 0.54,
  topSpeedHeadroom: 1.03,
  minFinalDrive: 3.2,
  maxFinalDrive: 5.2,
} as const;

export function applyStandardDriftTransmission(base: CarTuning): CarTuning {
  const topRatio = standardDriftTransmission.gearRatios.at(-1) ?? 1;
  const finalDrive =
    (base.redlineRpm * 2 * Math.PI * base.wheelRadius) /
    (60 * base.maxForwardSpeed * standardDriftTransmission.topSpeedHeadroom * topRatio);

  return {
    ...base,
    gearRatios: [...standardDriftTransmission.gearRatios],
    finalDrive: clamp(finalDrive, standardDriftTransmission.minFinalDrive, standardDriftTransmission.maxFinalDrive),
    shiftUpRpm: Math.round((base.redlineRpm * standardDriftTransmission.shiftUpRedlineFraction) / 50) * 50,
    shiftDownRpm: Math.round((base.redlineRpm * standardDriftTransmission.shiftDownRedlineFraction) / 50) * 50,
  };
}
