import type { CarTuning } from "../types";

export type HandlingProfileId = "classic" | "polished";

type StabilityInput = {
  profile: HandlingProfileId;
  tuning: CarTuning;
  speed: number;
  forwardSpeed: number;
  sideSpeed: number;
  rearSlip: number;
  frontWheelAngle: number;
  effectiveMaxSteer: number;
  steerAxis: number;
  steerRate: number;
  correctionIntent: number;
  correctionDirection: number;
  lowSpeedTurnCommitment: number;
  throttle: number;
  brake: number;
  liftOff: number;
  driftAmount: number;
  rearSlipVisual: number;
  driftDirection: number;
  bodyRoll: number;
  engineLoad: number;
  powerSlip: number;
  rearLockIntent: number;
  driftShiftSustain: number;
};

export type StabilityEnvelope = {
  counterSteerQuality: number;
  slideControl: number;
  transitionWeight: number;
  rearGripRelease: number;
  recovery: number;
  frontGripScale: number;
  rearGripAssist: number;
  yawAcceleration: number;
  yawDampingRate: number;
  lateralRecoveryRate: number;
  forwardScrubRate: number;
  lateralScrubRate: number;
  frontTranslationScale: number;
};

export const stabilityTuning = {
  powerHoldMinThrottle: 0.32,
  releaseRiseRate: 7.8,
  releaseHoldRate: 0.24,
  releaseRecoveryRate: 2.7,
  settledRearSlipDeg: 7,
  settledSideSpeed: 2.2,
  highSpeedCorrectionStart: 22,
  highSpeedCorrectionRange: 22,
  fullCorrectionSteerRate: 7,
  correctionRearRelease: 0.1,
  correctionFrontTranslation: 0.6,
  correctionYawAuthority: 0,
  correctionMomentumHoldSeconds: 0.38,
  correctionPathAcceleration: 0,
  correctionPathResponse: 0,
  tightTurnRearRelease: 0.085,
  tightTurnFrontGrip: 0.14,
  tightTurnYawDampingScale: 0.7,
} as const;

const degToRad = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const signed = (value: number) => (Math.abs(value) < 0.001 ? 0 : Math.sign(value));

export function updateRearReleaseMemory(
  current: number,
  input: {
    instantRelease: number;
    throttle: number;
    speed: number;
    driftMinSpeed: number;
    rearSlip: number;
    sideSpeed: number;
    driftAmount: number;
    rearSlipVisual: number;
    rearLockIntent: number;
    powerSlip: number;
  },
  dt: number,
) {
  const speedGate = clamp((input.speed - input.driftMinSpeed) / 16, 0, 1);
  const throttleGate = clamp(
    (input.throttle - stabilityTuning.powerHoldMinThrottle) / (1 - stabilityTuning.powerHoldMinThrottle),
    0,
    1,
  );
  const slipGate = clamp(
    Math.max(
      (Math.abs(input.rearSlip) - 7 * degToRad) / (24 * degToRad),
      (input.driftAmount - 0.18) / 0.62,
      (input.rearSlipVisual - 0.14) / 0.72,
    ),
    0,
    1,
  );
  const settled =
    Math.abs(input.rearSlip) < stabilityTuning.settledRearSlipDeg * degToRad &&
    Math.abs(input.sideSpeed) < stabilityTuning.settledSideSpeed &&
    input.driftAmount < 0.2;
  const physicalBreakaway = clamp(
    Math.max(
      (Math.abs(input.rearSlip) - 9 * degToRad) / (18 * degToRad),
      (input.driftAmount - 0.28) / 0.5,
      (input.rearSlipVisual - 0.3) / 0.5,
      (input.powerSlip - 0.14) / 0.68,
    ),
    0,
    1,
  );
  const poweredBreakaway = throttleGate * speedGate * physicalBreakaway;
  const activeHold = current > 0.22 && throttleGate > 0.18 && !settled && physicalBreakaway > 0.04
    ? 0.22 + physicalBreakaway * 0.16
    : 0;
  const holdTarget = Math.max(activeHold, poweredBreakaway * (0.24 + physicalBreakaway * 0.3));
  const lockRelease = input.rearLockIntent * (0.4 + slipGate * 0.12);
  const target = Math.max(input.instantRelease, holdTarget, lockRelease);
  const canReattach = input.throttle < stabilityTuning.powerHoldMinThrottle || settled;
  const settledProgress = clamp(
    1 - Math.max(
      Math.abs(input.rearSlip) / (15 * degToRad),
      Math.abs(input.sideSpeed) / 4.2,
      input.driftAmount / 0.38,
    ),
    0,
    1,
  );
  const rate = target > current
    ? stabilityTuning.releaseRiseRate
    : canReattach
      ? stabilityTuning.releaseRecoveryRate * lerp(0.55, 1.15, settledProgress)
      : stabilityTuning.releaseHoldRate;
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

function commonSignals(input: StabilityInput) {
  const counterSteering =
    signed(input.frontWheelAngle) !== 0 && signed(input.frontWheelAngle) === signed(input.sideSpeed);
  const counterSteerQuality = counterSteering
    ? clamp(Math.abs(input.frontWheelAngle) / Math.max(input.effectiveMaxSteer * 0.68, 0.001), 0, 1)
    : 0;
  const slideControl = clamp((Math.abs(input.rearSlip) - 7 * degToRad) / (30 * degToRad), 0, 1);
  const yawError = Math.abs(Math.atan2(input.sideSpeed, Math.max(Math.abs(input.forwardSpeed), 1.8)));
  const slideEnvelope = clamp(
    Math.max(
      (Math.abs(input.rearSlip) - 6 * degToRad) / (31 * degToRad),
      (yawError - 5 * degToRad) / (34 * degToRad),
    ),
    0,
    1,
  );
  const slideSign = signed(input.sideSpeed) || input.driftDirection || 1;
  const steerSign = signed(input.steerAxis);
  const transitionIntent =
    steerSign !== 0 && steerSign !== slideSign && input.driftAmount > 0.38 && input.speed > input.tuning.driftMinSpeed + 3
      ? clamp((Math.abs(input.steerAxis) - 0.28) / 0.62, 0, 1) *
        clamp(Math.abs(input.sideSpeed) / 13, 0, 1) *
        clamp((input.rearSlipVisual - 0.12) * 1.35, 0, 1)
      : 0;
  return { counterSteerQuality, slideControl, slideEnvelope, transitionIntent };
}

function classicEnvelope(input: StabilityInput): StabilityEnvelope {
  const { counterSteerQuality, slideControl, transitionIntent } = commonSignals(input);
  const transitionWeight =
    transitionIntent * clamp(Math.abs(input.bodyRoll) * 0.8 + Math.abs(input.sideSpeed) / 24, 0, 1) * 0.48;
  const speedGate = clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 24, 0, 1);
  const throttleGripLoss = input.throttle * input.tuning.throttleGripLoss * speedGate * input.engineLoad;
  const throttleSteerRelease =
    input.throttle * Math.abs(input.steerAxis) *
    clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 20, 0, 1) * input.engineLoad * 0.17;
  const sustainedTurnRelease =
    input.throttle * Math.pow(Math.abs(input.steerAxis), 1.15) *
    clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 22, 0, 1) *
    clamp(1 - counterSteerQuality * 0.62, 0.32, 1) * 0.13;
  const rearSlipRelease = clamp((Math.abs(input.rearSlip) - 8 * degToRad) / (34 * degToRad), 0, 1) * 0.1;
  const rearSlideRelease = slideControl * (0.05 + input.throttle * 0.04 + (1 - counterSteerQuality) * 0.03);
  const transitionRearRelease = transitionWeight * (0.035 + input.throttle * 0.018);
  const rawRelease = clamp(
    throttleGripLoss + throttleSteerRelease + sustainedTurnRelease + rearSlipRelease + rearSlideRelease + transitionRearRelease,
    0,
    0.76,
  );
  const recovery =
    input.liftOff * clamp((24 - input.speed) / 16, 0, 1) * clamp((input.speed - 4) / 10, 0, 1) *
    clamp((Math.abs(input.rearSlip) - 5 * degToRad) / (26 * degToRad), 0, 1) * (1 - input.rearLockIntent * 0.65);
  const rearGripRelease = clamp(rawRelease - recovery * 0.34, 0, 0.76);
  const driftHold = clamp((Math.abs(input.rearSlip) - 8 * degToRad) / (28 * degToRad), 0, 1);
  const lowSpeedYawDamping = lerp(3.2, 1, clamp(input.speed / 12, 0, 1));
  const lateralRecoveryRate = recovery * (1.7 + clamp((Math.abs(input.sideSpeed) - 1.5) / 8, 0, 1) * 2.1);

  const slipSeverity = clamp(Math.abs(input.sideSpeed) / 18 + Math.abs(input.rearSlip) / (42 * degToRad), 0, 1.6);
  const slideScrub = input.tuning.slideDrag * slipSeverity * Math.abs(input.sideSpeed);
  const realSlideHold = clamp(Math.max(Math.abs(input.rearSlip) / (34 * degToRad), Math.abs(input.sideSpeed) / 13), 0, 1);
  const lockedRearScrub = input.rearLockIntent * clamp(input.speed / 22, 0.15, 1.2);
  const liftOffSlideDrag = input.liftOff * realSlideHold *
    clamp((Math.abs(input.rearSlip) - 8 * degToRad) / (30 * degToRad), 0, 1) *
    clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 18, 0, 1);
  const speedDragLoad = lerp(0.06, 1, Math.max(realSlideHold, input.driftAmount * 0.85));
  const poweredSlideRelief = input.throttle * realSlideHold *
    clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 18, 0, 1);
  const driftShiftRelief = lerp(1, 0.72, input.driftShiftSustain);

  return {
    counterSteerQuality,
    slideControl,
    transitionWeight,
    rearGripRelease,
    recovery,
    frontGripScale: 1 + slideControl * (0.1 + counterSteerQuality * 0.22) + transitionWeight * 0.08,
    rearGripAssist: input.tuning.counterSteerAssist * counterSteerQuality,
    yawAcceleration:
      input.steerAxis * input.throttle *
      clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 18, 0, 1) *
      clamp(rawRelease / 0.7, 0, 1) * (1 - counterSteerQuality * 0.7) * (5.2 / input.tuning.yawInertia) * 0.62 +
      signed(input.steerAxis) * transitionWeight *
      clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 18, 0, 1) * (1.35 / input.tuning.yawInertia),
    yawDampingRate:
      input.tuning.yawDamping * lowSpeedYawDamping +
      counterSteerQuality * driftHold * 1.55 + transitionWeight * 0.9 + recovery * 1.8,
    lateralRecoveryRate,
    forwardScrubRate:
      (input.tuning.driftDrag * input.speed * speedDragLoad * lerp(1, 0.62, poweredSlideRelief) +
        slideScrub * lerp(1, 0.44, poweredSlideRelief) + liftOffSlideDrag * 0.72 + lockedRearScrub * 0.72) *
      driftShiftRelief,
    lateralScrubRate:
      input.tuning.driftDrag * input.speed * (0.18 + speedDragLoad * 0.57) +
      input.tuning.slideDrag * lerp(0.72, 0.55, realSlideHold) * input.speed * lerp(1, 0.82, poweredSlideRelief) +
      liftOffSlideDrag * 0.34 + lockedRearScrub * 0.46,
    frontTranslationScale: 1,
  };
}

function polishedEnvelope(input: StabilityInput): StabilityEnvelope {
  const { counterSteerQuality, slideControl, slideEnvelope, transitionIntent } = commonSignals(input);
  const speedGate = clamp((Math.abs(input.forwardSpeed) - input.tuning.driftMinSpeed) / 22, 0, 1);
  const powered = input.throttle * speedGate;
  const highSpeedGate = clamp(
    (input.speed - stabilityTuning.highSpeedCorrectionStart) / stabilityTuning.highSpeedCorrectionRange,
    0,
    1,
  );
  const activeSlideGate = clamp(
    Math.max((input.driftAmount - 0.18) / 0.55, (input.rearSlipVisual - 0.14) / 0.7),
    0,
    1,
  );
  const correctionTransient =
    Math.max(
      clamp(Math.abs(input.steerRate) / stabilityTuning.fullCorrectionSteerRate, 0, 1),
      Math.sin(Math.PI * clamp(1 - input.correctionIntent, 0, 1)),
    ) *
    highSpeedGate *
    slideEnvelope *
    activeSlideGate;
  const correctionHold =
    input.correctionIntent * highSpeedGate * clamp(Math.max(slideEnvelope, activeSlideGate) * 1.2, 0, 1);
  // Corrections must rotate through the tire forces, not rewrite world velocity or
  // inject steering-direction yaw. This catch only wakes up near a genuine spin.
  const overspinSignal = clamp((Math.abs(input.rearSlip) - 50 * degToRad) / (28 * degToRad), 0, 1);
  const overspinCatch = overspinSignal * overspinSignal * (3 - 2 * overspinSignal);
  const transitionWeight = Math.max(
    transitionIntent * (0.22 + slideEnvelope * 0.34),
    correctionTransient * 0.18,
  );
  const steeringLoad = Math.pow(Math.abs(input.steerAxis), 1.12);
  const powerRelease = powered * input.tuning.throttleGripLoss * input.engineLoad;
  const committedTurnRelease = powered * steeringLoad * (1 - counterSteerQuality * 0.58) * 0.21;
  const drivenSlipRelease = input.powerSlip * steeringLoad * (0.2 + powered * 0.14);
  const saturatedSlipRelease = slideEnvelope * (0.075 + powered * 0.045);
  const transitionRelease =
    transitionWeight * (0.03 + powered * 0.015) +
    correctionTransient * (0.07 + powered * 0.025);
  const tightTurnRelease =
    input.lowSpeedTurnCommitment *
    lerp(stabilityTuning.tightTurnRearRelease * 0.68, stabilityTuning.tightTurnRearRelease, steeringLoad);
  const rawRelease = clamp(
    powerRelease + committedTurnRelease + drivenSlipRelease + saturatedSlipRelease + transitionRelease + tightTurnRelease,
    0,
    0.72,
  );

  const lowSpeedWindow = clamp((25 - input.speed) / 17, 0, 1) * clamp((input.speed - 4) / 9, 0, 1);
  const recoveryLiftOff = input.liftOff * (1 - input.brake * slideEnvelope * 0.18);
  const scrubLiftOff = input.liftOff * (1 - clamp(input.brake * 1.35, 0, 0.9));
  const recovery = clamp(
    recoveryLiftOff * slideEnvelope * lowSpeedWindow * 0.72 +
      counterSteerQuality * slideEnvelope * (0.22 + recoveryLiftOff * 0.18),
    0,
    1,
  ) * (1 - input.rearLockIntent * 0.78) * (1 - input.lowSpeedTurnCommitment * 0.72);
  const rearGripRelease = clamp(rawRelease - recovery * 0.26, 0, 0.72);
  const lowSpeedYawDamping = lerp(3.0, 1, clamp(input.speed / 13, 0, 1));
  const lateralRecoveryRate =
    recovery * (1.15 + lowSpeedWindow * 1.4) * (1 - input.lowSpeedTurnCommitment * 0.55) +
    overspinCatch * 0.28;
  const poweredRelief = powered * slideEnvelope;
  const lockedRearScrub = input.rearLockIntent * clamp(input.speed / 24, 0.12, 1.08);
  const baseScrub = input.tuning.driftDrag * input.speed * lerp(0.12, 0.92, slideEnvelope);
  const lateralScrub = input.tuning.slideDrag * input.speed * lerp(0.38, 0.62, slideEnvelope);
  const liftScrub = scrubLiftOff * slideEnvelope * speedGate;
  const brakeScrubRelief = clamp(input.brake * slideEnvelope * 1.7, 0, 1);
  const shiftRelief = lerp(1, 0.78, input.driftShiftSustain);

  return {
    counterSteerQuality,
    slideControl,
    transitionWeight,
    rearGripRelease,
    recovery,
    frontGripScale:
      1 + slideEnvelope * (0.095 + counterSteerQuality * 0.18) +
      transitionWeight * 0.035 + correctionTransient * 0.48 +
      input.lowSpeedTurnCommitment * stabilityTuning.tightTurnFrontGrip,
    rearGripAssist:
      input.tuning.counterSteerAssist * counterSteerQuality * (0.72 + slideEnvelope * 0.28) +
      overspinCatch * input.tuning.rearGrip * 0.16,
    yawAcceleration:
      input.steerAxis * powered * clamp(rawRelease / 0.68, 0, 1) *
      (1 - counterSteerQuality * 0.76) * (5.2 / input.tuning.yawInertia) * 0.56 +
      signed(input.correctionDirection) * correctionTransient * stabilityTuning.correctionYawAuthority *
      (5.2 / input.tuning.yawInertia),
    yawDampingRate:
      input.tuning.yawDamping * lowSpeedYawDamping *
      lerp(1, stabilityTuning.tightTurnYawDampingScale, input.lowSpeedTurnCommitment) +
      slideEnvelope * (counterSteerQuality * 1.3 + recoveryLiftOff * lowSpeedWindow * 0.85) +
      transitionWeight * 0.1 + overspinCatch * 2.5,
    lateralRecoveryRate,
    forwardScrubRate:
      (baseScrub * lerp(1, 0.66, poweredRelief) * lerp(1, 0.08, brakeScrubRelief) +
        input.tuning.slideDrag * Math.abs(input.sideSpeed) * slideEnvelope *
          lerp(1, 0.58, poweredRelief) * lerp(1, 0.18, brakeScrubRelief) +
        liftScrub * 0.62 + lockedRearScrub * 0.76) * shiftRelief,
    lateralScrubRate:
      lateralScrub * lerp(1, 0.84, poweredRelief) + baseScrub * 0.34 + liftScrub * 0.42 + lockedRearScrub * 0.5,
    // A quick rack movement should create yaw at the front axle, not translate
    // the whole chassis sideways as if the rear wheels steered too.
    frontTranslationScale: lerp(1, 0.5, Math.max(correctionTransient, correctionHold)),
  };
}

export function computeStabilityEnvelope(input: StabilityInput): StabilityEnvelope {
  return input.profile === "classic" ? classicEnvelope(input) : polishedEnvelope(input);
}
