import type { CarTuning } from "../types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function applyVehicleGeometryTuning(base: CarTuning): CarTuning {
  const tuning: CarTuning = { ...base, gearRatios: [...base.gearRatios] };
  const wheelbaseScale = clamp(tuning.wheelbaseScale ?? 1, 0.86, 1.18);
  const trackWidthScale = clamp(tuning.trackWidthScale ?? 1, 0.9, 1.14);
  const massScale = clamp(tuning.massScale ?? 1, 0.82, 1.22);
  const longWheelbase = wheelbaseScale - 1;

  tuning.frontAxle *= wheelbaseScale;
  tuning.rearAxle *= wheelbaseScale;
  tuning.yawInertia *= wheelbaseScale * wheelbaseScale * massScale;

  tuning.steerResponse *= clamp(1 - longWheelbase * 0.34, 0.86, 1.12);
  tuning.maxSteerAngle *= clamp(1 - longWheelbase * 0.16, 0.94, 1.08);
  tuning.steeringAtSpeed *= clamp(1 - longWheelbase * 0.18, 0.92, 1.06);
  tuning.counterSteerAssist *= clamp(1 + longWheelbase * 0.42, 0.94, 1.08);
  tuning.yawDamping *= clamp(1 + longWheelbase * 0.22 + (massScale - 1) * 0.12, 0.94, 1.08);

  tuning.frontGrip *= clamp(1 + (trackWidthScale - 1) * 0.24, 0.98, 1.04);
  tuning.rearGrip *= clamp(1 + (trackWidthScale - 1) * 0.2, 0.98, 1.04);
  tuning.frontCorneringStiffness *= clamp(1 + (trackWidthScale - 1) * 0.16 - longWheelbase * 0.08, 0.96, 1.05);
  tuning.rearCorneringStiffness *= clamp(1 + longWheelbase * 0.12 + (massScale - 1) * 0.08, 0.96, 1.05);
  tuning.differentialLock = clamp(
    tuning.differentialLock ?? 0.68 + (tuning.engineTorque - 1) * 0.12 - longWheelbase * 0.08,
    0.58,
    0.82,
  );
  tuning.weightTransferScale = clamp(
    tuning.weightTransferScale ?? 1 + (massScale - 1) * 0.3 - (trackWidthScale - 1) * 0.18,
    0.92,
    1.1,
  );

  if (!tuning.collisionLength) {
    tuning.collisionLength = (tuning.frontAxle + tuning.rearAxle) * 1.55 + 1.05;
  }
  if (!tuning.collisionWidth) {
    tuning.collisionWidth = 2.72 * trackWidthScale;
  }

  return tuning;
}
