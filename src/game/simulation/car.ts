import type { CarState, CarTuning, InputState, TrackConfig, Vec2 } from "../types";
import { getRoadHalfWidth } from "./trackLayout";
import type { CarPose2D, CollisionResult } from "./collisionTypes";
import { collisionResponses, emptyCollisionResult } from "./collisionTypes";
import {
  computeStabilityEnvelope,
  stabilityTuning,
  updateRearReleaseMemory,
  type HandlingProfileId,
} from "./handlingStability";

const degToRad = Math.PI / 180;
const radToDeg = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const length = (value: Vec2) => Math.hypot(value.x, value.z);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const signed = (value: number) => (Math.abs(value) < 0.001 ? 0 : Math.sign(value));
const moveTowards = (from: number, to: number, maxDelta: number) =>
  Math.abs(to - from) <= maxDelta ? to : from + Math.sign(to - from) * maxDelta;

function closestTrackPoint(point: Vec2, track: TrackConfig) {
  if (!track.roadPath || track.roadPath.length < 2) return null;

  let best = { x: track.roadPath[0].x, z: track.roadPath[0].z, distance: Infinity };
  for (let i = 0; i < track.roadPath.length; i++) {
    const a = track.roadPath[i];
    const b = track.roadPath[(i + 1) % track.roadPath.length];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq === 0 ? 0 : clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq, 0, 1);
    const x = a.x + abx * t;
    const z = a.z + abz * t;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best.distance) best = { x, z, distance };
  }
  return best;
}

function tireAcceleration(
  slipAngle: number,
  stiffness: number,
  gripLimit: number,
  peakSlipDeg: number,
  falloffSlipDeg: number,
  falloff: number,
) {
  const slip = Math.abs(slipAngle);
  const sign = signed(slipAngle);
  const saturatedGrip = gripLimit * Math.tanh((stiffness * slip) / Math.max(gripLimit, 0.001));
  const falloffWindow = Math.max((falloffSlipDeg - peakSlipDeg) * degToRad, 0.001);
  const beyondPeak = clamp((slip - peakSlipDeg * degToRad) / falloffWindow, 0, 1);
  const smoothFalloff = beyondPeak * beyondPeak * (3 - 2 * beyondPeak);
  return -sign * saturatedGrip * (1 - falloff * smoothFalloff);
}

function torqueCurve(rpm: number, tuning: CarTuning) {
  const normalized = clamp((rpm - tuning.idleRpm) / (tuning.redlineRpm - tuning.idleRpm), 0, 1);
  // Torque builds from idle, peaks ~65% of rev range, falls off toward redline
  const buildUp = 1 - Math.exp(-normalized * 4.2);
  const topEndFalloff = 1 - Math.max(0, normalized - 0.65) * 1.45;
  return clamp(Math.min(buildUp, topEndFalloff), 0.28, 1.05);
}

export const drivetrainTuning = {
  straightRearCapacity: 1.85,
  cornerRearCapacity: 1,
  overloadWindow: 0.8,
  slipRiseRate: 9.5,
  slipHoldRate: 3.6,
  slipReleaseRate: 8.5,
  wheelOverspeed: 0.28,
  driveLossAtFullSlip: 0.16,
  lateralGripLossAtFullSlip: 0.38,
  powerGripFloorAtFullSlip: 0.72,
  lateralSlipCoupling: 0.4,
} as const;

export function createCarState(track: TrackConfig): CarState {
  return {
    position: { x: track.start.x, z: track.start.z },
    heading: track.start.heading,
    velocity: { x: 0, z: 0 },
    speed: 0,
    yawVelocity: 0,
    slipAmount: 0,
    slipAngle: 0,
    frontSlipAngle: 0,
    rearSlipAngle: 0,
    gripAmount: 1,
    handbrakeAmount: 0,
    driftAmount: 0,
    driftDirection: 1,
    frontWheelAngle: 0,
    wheelSpin: 0,
    rearWheelSpin: 0,
    powerSlip: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    weightForward: 0.5,
    weightRight: 0.5,
    suspensionFL: 0.5,
    suspensionFR: 0.5,
    suspensionRL: 0.5,
    suspensionRR: 0.5,
    gear: 1,
    rpm: 900,
    shiftCooldown: 0,
    tireHeat: 0,
    rearSlipVisual: 0,
    rearReleaseMemory: 0,
    lowSpeedTurnCommitment: 0,
    steerAxis: 0,
    correctionTimer: 0,
    correctionRightX: 1,
    correctionRightZ: 0,
    correctionSideSpeed: 0,
    correctionDirection: 0,
    throttleAxis: 0,
    brakeAxis: 0,
    reverseEngageTimer: 0,
    filteredLongitudinalAcceleration: 0,
    filteredLateralAcceleration: 0,
    offTrackAmount: 0,
  };
}

export function resetCar(car: CarState, track: TrackConfig, spawn: TrackConfig["start"] = track.start) {
  car.position.x = spawn.x;
  car.position.z = spawn.z;
  car.heading = spawn.heading;
  car.velocity.x = 0;
  car.velocity.z = 0;
  car.speed = 0;
  car.yawVelocity = 0;
  car.slipAmount = 0;
  car.slipAngle = 0;
  car.frontSlipAngle = 0;
  car.rearSlipAngle = 0;
  car.gripAmount = 1;
  car.handbrakeAmount = 0;
  car.driftAmount = 0;
  car.driftDirection = 1;
  car.frontWheelAngle = 0;
  car.wheelSpin = 0;
  car.rearWheelSpin = 0;
  car.powerSlip = 0;
  car.bodyPitch = 0;
  car.bodyRoll = 0;
  car.weightForward = 0.5;
  car.weightRight = 0.5;
  car.suspensionFL = 0.5;
  car.suspensionFR = 0.5;
  car.suspensionRL = 0.5;
  car.suspensionRR = 0.5;
  car.gear = 1;
  car.rpm = 900;
  car.shiftCooldown = 0;
  car.tireHeat = 0;
  car.rearSlipVisual = 0;
  car.rearReleaseMemory = 0;
  car.lowSpeedTurnCommitment = 0;
  car.steerAxis = 0;
  car.correctionTimer = 0;
  car.correctionRightX = 1;
  car.correctionRightZ = 0;
  car.correctionSideSpeed = 0;
  car.correctionDirection = 0;
  car.throttleAxis = 0;
  car.brakeAxis = 0;
  car.reverseEngageTimer = 0;
  car.filteredLongitudinalAcceleration = 0;
  car.filteredLateralAcceleration = 0;
  car.offTrackAmount = 0;
  return car;
}

export function updateCar(
  car: CarState,
  input: InputState,
  tuning: CarTuning,
  dt: number,
  onTrack = true,
  handlingProfile: HandlingProfileId = "polished",
) {
  const rawSteerTarget = Math.abs(input.steer) < 0.05 ? 0 : clamp(input.steer, -1, 1);
  const steerMagnitude = Math.abs(rawSteerTarget);
  const shapedSteerMagnitude = lerp(
    Math.pow(steerMagnitude, 0.78),
    Math.pow(steerMagnitude, 1.48),
    steerMagnitude * 0.34,
  );
  const steerTarget = Math.sign(rawSteerTarget) * shapedSteerMagnitude;
  const previousSteerAxis = car.steerAxis;
  const correctionStarted =
    Math.abs(previousSteerAxis) > 0.2 && Math.abs(steerTarget) > 0.5 &&
    Math.sign(previousSteerAxis) !== Math.sign(steerTarget) && car.speed > stabilityTuning.highSpeedCorrectionStart;
  if (correctionStarted) {
    car.correctionDirection = Math.sign(steerTarget);
    car.correctionTimer = stabilityTuning.correctionMomentumHoldSeconds;
    car.correctionRightX = Math.cos(car.heading);
    car.correctionRightZ = -Math.sin(car.heading);
    car.correctionSideSpeed = car.velocity.x * car.correctionRightX + car.velocity.z * car.correctionRightZ;
  } else {
    car.correctionTimer = Math.max(0, car.correctionTimer - dt);
  }
  const inputSpeed01 = clamp(length(car.velocity) / Math.max(tuning.maxForwardSpeed * 0.62, 1), 0, 1);
  const changingDirection = previousSteerAxis * steerTarget < -0.025;
  const steeringResponse =
    tuning.steerResponse *
    lerp(1.08, 0.74, inputSpeed01) *
    (changingDirection ? 1.2 : 1);
  car.steerAxis = lerp(car.steerAxis, steerTarget, smooth(steeringResponse, dt));
  const steerRate = (car.steerAxis - previousSteerAxis) / Math.max(dt, 1 / 240);
  car.throttleAxis = lerp(car.throttleAxis, input.throttle, smooth(tuning.throttleResponse, dt));
  car.brakeAxis = lerp(car.brakeAxis, input.brake, smooth(tuning.throttleResponse * 0.82, dt));
  car.handbrakeAmount = moveTowards(car.handbrakeAmount, input.handbrake ? 1 : 0, (input.handbrake ? 7.8 : 9.5) * dt);
  car.offTrackAmount = moveTowards(car.offTrackAmount, onTrack ? 0 : 1, (onTrack ? 6.5 : 1.2) * dt);

  const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  const right = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
  let forwardSpeed = car.velocity.x * forward.x + car.velocity.z * forward.z;
  let sideSpeed = car.velocity.x * right.x + car.velocity.z * right.z;
  const priorForwardSpeed = forwardSpeed;
  const speed = length(car.velocity);
  const tightTurnSpeedWindow =
    clamp((19 - speed) / 10, 0, 1) *
    clamp((speed - 2.2) / 4.8, 0, 1);
  const tightTurnInput = clamp((Math.abs(car.steerAxis) - 0.3) / 0.56, 0, 1);
  const tightTurnTarget = tightTurnSpeedWindow * tightTurnInput;
  const tightTurnRate = tightTurnTarget > car.lowSpeedTurnCommitment ? 9.5 : 6.2;
  car.lowSpeedTurnCommitment = lerp(
    car.lowSpeedTurnCommitment,
    tightTurnTarget,
    smooth(tightTurnRate, dt),
  );
  const speed01 = clamp(speed / tuning.maxForwardSpeed, 0, 1);
  const steerLimit = lerp(1, tuning.steeringAtSpeed, speed01);
  const maxSteer = tuning.maxSteerAngle * degToRad;
  const slideSteerBoost = 1 + clamp(car.driftAmount * 0.14 + car.rearSlipVisual * 0.08, 0, 0.2);
  const effectiveMaxSteer = maxSteer * slideSteerBoost;

  const rackMagnitude = Math.abs(car.steerAxis);
  const rackAxis = Math.sign(car.steerAxis) * lerp(
    Math.pow(rackMagnitude, 0.84),
    Math.pow(rackMagnitude, 1.42),
    rackMagnitude * 0.32,
  );
  car.frontWheelAngle = rackAxis * effectiveMaxSteer * steerLimit;

  const maxGear = tuning.gearRatios.length;
  car.gear = Math.max(1, Math.min(maxGear, Math.round(car.gear)));
  const absForwardSpeed = Math.abs(forwardSpeed);
  const brakingToStop = car.brakeAxis > 0.38 && forwardSpeed > -0.2;
  const crawling = absForwardSpeed < 2.8;
  const parking = absForwardSpeed < 1.45;
  if (parking && car.gear !== 1) {
    car.gear = 1;
    car.shiftCooldown = Math.min(car.shiftCooldown, 0.04);
  }
  const currentRatio = tuning.gearRatios[car.gear - 1] ?? tuning.gearRatios[0];
  const wheelRpm = (Math.abs(forwardSpeed) / (2 * Math.PI * tuning.wheelRadius)) * 60;
  const wheelOverspeed =
    handlingProfile === "polished"
      ? 1 + car.powerSlip * car.throttleAxis * drivetrainTuning.wheelOverspeed
      : 1;
  const roadCoupledRpm = wheelRpm * currentRatio * tuning.finalDrive;
  const coupledRpm = roadCoupledRpm * wheelOverspeed;

  // Free-rev: throttle lifts RPM up to redline when wheels are slipping at launch
  const launchSlip = clamp(1 - Math.abs(forwardSpeed) / 5, 0, 1) * car.throttleAxis;
  const freeRevRpm = tuning.idleRpm + car.throttleAxis * (tuning.redlineRpm - tuning.idleRpm) * 0.82;

  // Rev limiter: bounce RPM back from redline with a small kick
  const nearRedline = car.rpm > tuning.redlineRpm * 0.985 && car.throttleAxis > 0.5;
  const limiterTarget = nearRedline ? tuning.redlineRpm * 0.93 : tuning.redlineRpm;

  const rpmTarget = clamp(
    lerp(Math.max(tuning.idleRpm, coupledRpm), Math.min(freeRevRpm, limiterTarget), launchSlip),
    tuning.idleRpm,
    limiterTarget,
  );

  car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
  // Drivetrain inertia: RPM follows wheel speed with flywheel lag
  // During a shift the clutch is open — RPM floats freely and drops quickly
  const clutchEngaged = car.shiftCooldown <= 0;
  const clutchSlip = Math.abs(car.rpm - coupledRpm) / Math.max(tuning.redlineRpm, 1);
  const inertiaRate = clutchEngaged ? lerp(4.5, 9, 1 - clutchSlip) + car.powerSlip * 3.5 : 22;
  car.rpm = lerp(car.rpm, rpmTarget, smooth(inertiaRate, dt));

  const rpmForGear = (gear: number) => wheelRpm * (tuning.gearRatios[gear - 1] ?? tuning.gearRatios[0]) * tuning.finalDrive;
  const applyShift = (nextGear: number, cooldown: number, rpmCeiling = tuning.redlineRpm * 0.96) => {
    const clampedGear = Math.max(1, Math.min(maxGear, Math.round(nextGear)));
    if (clampedGear === car.gear) return;
    car.gear = clampedGear;
    car.shiftCooldown = cooldown;
    car.rpm = clamp(rpmForGear(car.gear), tuning.idleRpm, rpmCeiling);
  };
  if (parking && car.gear !== 1) {
    applyShift(1, 0.04);
  } else if (crawling && car.gear > 1 && (brakingToStop || car.throttleAxis < 0.35)) {
    applyShift(1, 0.07);
  } else if (absForwardSpeed < 5.5 && car.gear > 2 && (brakingToStop || car.throttleAxis < 0.2)) {
    applyShift(2, 0.08);
  }

  if (car.shiftCooldown <= 0) {
    const nextRatio = tuning.gearRatios[car.gear] ?? 0;
    const previousRatio = tuning.gearRatios[car.gear - 2] ?? 0;
    const nextGearRpm = wheelRpm * nextRatio * tuning.finalDrive;
    const previousGearRpm = wheelRpm * previousRatio * tuning.finalDrive;
    const slidePowerDemand =
      car.throttleAxis > 0.42 &&
      Math.abs(forwardSpeed) > tuning.driftMinSpeed + 2 &&
      (car.driftAmount > 0.2 ||
        car.rearSlipVisual > 0.22 ||
        car.slipAngle > 10 ||
        (car.powerSlip > 0.12 && Math.abs(car.steerAxis) > 0.38));
    const slideUpshiftReady =
      (car.rpm >= tuning.shiftUpRpm && roadCoupledRpm >= tuning.shiftUpRpm * 0.88) ||
      ((car.slipAngle > 36 || Math.abs(car.rearSlipAngle) > 40) &&
        car.powerSlip > 0.32 &&
        nextGearRpm >= tuning.shiftDownRpm * 0.9);
    const normalUpshiftReady = car.rpm >= tuning.shiftUpRpm;
    const shouldUpshift =
      !brakingToStop &&
      car.gear < maxGear &&
      nextGearRpm >= tuning.shiftDownRpm * 0.9 &&
      (slidePowerDemand ? slideUpshiftReady : normalUpshiftReady);

    const powerKickdown = car.throttleAxis > 0.72 && roadCoupledRpm < tuning.shiftDownRpm * 1.08;
    const coastDownshift = car.throttleAxis <= 0.72 && roadCoupledRpm < tuning.shiftDownRpm;
    const slideDownshift = slidePowerDemand && roadCoupledRpm < tuning.shiftDownRpm * 1.12;
    const shouldDownshift =
      car.gear > 1 &&
      (absForwardSpeed > 2.0 || brakingToStop || crawling) &&
      previousGearRpm < tuning.redlineRpm * 0.95 &&
      (powerKickdown || coastDownshift || slideDownshift ||
        (brakingToStop && roadCoupledRpm < tuning.shiftDownRpm * 1.12));

    if (shouldUpshift) {
      applyShift(car.gear + 1, slidePowerDemand ? 0.13 : 0.2, tuning.redlineRpm * 0.88);
    } else if (shouldDownshift) {
      applyShift(car.gear - 1, powerKickdown || slideDownshift ? 0.11 : 0.15, tuning.redlineRpm);
    }
  }

  const gearRatio = tuning.gearRatios[car.gear - 1] ?? currentRatio;
  // Keep lower gears punchy while letting taller gears still pull toward each car's stated speed cap.
  const topRatio = tuning.gearRatios[0] ?? 1;
  const gearTorque = Math.pow(gearRatio / Math.max(topRatio, 0.001), 0.6);
  const enginePull = torqueCurve(car.rpm, tuning);

  // Engine braking: lift off throttle at speed drags RPM and adds resistance
  const engineBraking = (1 - car.throttleAxis) * clamp(Math.abs(forwardSpeed) / 28, 0, 1) * 0.12;

  // Shift torque: ramp from cut to full over the shift duration for a smooth re-engagement
  const driftShiftSustain =
    car.shiftCooldown > 0 &&
    car.throttleAxis > 0.42 &&
    Math.abs(forwardSpeed) > tuning.driftMinSpeed + 2 &&
    (car.driftAmount > 0.16 || car.rearSlipVisual > 0.18 || car.slipAngle > 8)
      ? clamp(car.shiftCooldown / 0.15, 0, 1)
      : 0;
  const shiftProgress = car.shiftCooldown > 0 ? clamp(1 - car.shiftCooldown / 0.22, 0, 1) : 1;
  const shiftTorque = lerp(lerp(0.42, 0.72, driftShiftSustain), 1, shiftProgress);
  const rearLockIntent = car.handbrakeAmount * clamp((speed - 3) / 14, 0, 1);
  const wantsReverse = car.brakeAxis > 0.92 && car.throttleAxis < 0.12;
  const reverseReady = forwardSpeed < 0.65;
  car.reverseEngageTimer = wantsReverse && reverseReady ? car.reverseEngageTimer + dt : 0;
  const reverseEngageDelay = 0.26;
  const reverseRamp = clamp((car.reverseEngageTimer - reverseEngageDelay) / 0.34, 0, 1);
  const reverseActive = wantsReverse && reverseRamp > 0;
  const brakePressure = Math.pow(car.brakeAxis, 1.28) * lerp(0.68, 0.94, clamp(Math.abs(forwardSpeed) / 24, 0, 1));
  const brakeSlideLoad = clamp(
    Math.max(
      car.driftAmount,
      car.rearSlipVisual,
      (car.slipAngle - 4) / 20,
    ),
    0,
    1,
  );
  const slideBrakeForceScale = lerp(1, 0.08, brakeSlideLoad * brakeSlideLoad * (3 - 2 * brakeSlideLoad));
  const liftOff = clamp((0.38 - car.throttleAxis) / 0.38, 0, 1);
  const requestedDrive =
    tuning.acceleration *
    car.throttleAxis *
    gearTorque *
    enginePull *
    tuning.engineTorque *
    shiftTorque *
    (1 - rearLockIntent * 0.72);
  const rearCorneringLoad = clamp(
    Math.abs(car.rearSlipAngle) * degToRad / (16 * degToRad) + Math.abs(sideSpeed) / 11,
    0,
    1,
  );
  const rearLongitudinalCapacity =
    tuning.rearGrip *
    lerp(drivetrainTuning.straightRearCapacity, drivetrainTuning.cornerRearCapacity, rearCorneringLoad);
  const tractionOverload = clamp(
    (requestedDrive - rearLongitudinalCapacity) /
      Math.max(rearLongitudinalCapacity * drivetrainTuning.overloadWindow, 4),
    0,
    1,
  );
  const throttleSlipGate = clamp((car.throttleAxis - 0.42) / 0.58, 0, 1);
  const lateralPowerSlip =
    rearCorneringLoad *
    throttleSlipGate *
    clamp((speed - tuning.driftMinSpeed) / 22, 0, 1) *
    clamp((gearTorque * enginePull * tuning.engineTorque) / 0.85, 0.35, 1.2) *
    drivetrainTuning.lateralSlipCoupling;
  const differentialLock = clamp(((tuning.differentialLock ?? 0.68) - 0.55) / 0.3, 0, 1);
  const coupledLateralPowerSlip = lateralPowerSlip * lerp(0.9, 1.14, differentialLock);
  const launchTurnSlip =
    throttleSlipGate *
    Math.pow(Math.abs(car.steerAxis), 1.08) *
    clamp((16 - speed) / 12, 0, 1) *
    clamp((gearTorque * enginePull * tuning.engineTorque - 0.28) / 0.72, 0, 1) *
    0.82;
  const powerSlipTarget =
    handlingProfile === "polished"
      ? Math.max(
          tractionOverload * throttleSlipGate * lerp(0.94, 1.08, differentialLock),
          coupledLateralPowerSlip,
          launchTurnSlip * lerp(0.92, 1.1, differentialLock),
        ) * shiftTorque
      : 0;
  const powerSlipRate =
    powerSlipTarget > car.powerSlip
      ? drivetrainTuning.slipRiseRate
      : car.throttleAxis < 0.25
        ? drivetrainTuning.slipReleaseRate
        : drivetrainTuning.slipHoldRate;
  car.powerSlip = lerp(car.powerSlip, powerSlipTarget, smooth(powerSlipRate, dt));
  const slipDriveLoss = drivetrainTuning.driveLossAtFullSlip * lerp(1.08, 0.82, differentialLock);
  let drive = requestedDrive * lerp(1, 1 - slipDriveLoss, car.powerSlip);
  if (car.brakeAxis > 0 && forwardSpeed > 0.15) {
    drive -= tuning.brakeForce * brakePressure * slideBrakeForceScale;
  }
  if (wantsReverse && !reverseActive && Math.abs(forwardSpeed) < 0.35) drive -= forwardSpeed * 8;
  if (reverseActive) drive -= tuning.reverseAcceleration * car.brakeAxis * reverseRamp;

  const handbrakeDrag = rearLockIntent * tuning.handbrakeDrag * Math.sign(forwardSpeed) * Math.min(Math.abs(forwardSpeed), 28);
  const rolling = tuning.rollingResistance * Math.sign(forwardSpeed) * clamp(Math.abs(forwardSpeed), 0, 1);
  const aero = tuning.drag * forwardSpeed * Math.abs(forwardSpeed);
  const engineBrakingForce = engineBraking * Math.sign(forwardSpeed) * Math.min(Math.abs(forwardSpeed), 30);
  const longitudinalAcceleration = drive - handbrakeDrag - rolling - aero - engineBrakingForce;

  const safeForwardSpeed = Math.max(Math.abs(forwardSpeed), 1.8);
  const frontPatchSideSpeed = sideSpeed + car.yawVelocity * tuning.frontAxle;
  const rearPatchSideSpeed = sideSpeed - car.yawVelocity * tuning.rearAxle;
  const physicsWheelAngle = forwardSpeed < -0.5 ? -car.frontWheelAngle : car.frontWheelAngle;
  const frontSlip = Math.atan2(frontPatchSideSpeed, safeForwardSpeed) - physicsWheelAngle;
  const rearSlip = Math.atan2(rearPatchSideSpeed, safeForwardSpeed);
  const stability = computeStabilityEnvelope({
    profile: handlingProfile,
    tuning,
    speed,
    forwardSpeed,
    sideSpeed,
    rearSlip,
    frontWheelAngle: car.frontWheelAngle,
    effectiveMaxSteer,
    steerAxis: car.steerAxis,
    steerRate,
    correctionIntent: clamp(car.correctionTimer / stabilityTuning.correctionMomentumHoldSeconds, 0, 1),
    correctionDirection: car.correctionDirection,
    lowSpeedTurnCommitment: car.lowSpeedTurnCommitment,
    throttle: car.throttleAxis,
    brake: car.brakeAxis,
    liftOff,
    driftAmount: car.driftAmount,
    rearSlipVisual: car.rearSlipVisual,
    driftDirection: car.driftDirection,
    bodyRoll: car.bodyRoll,
    engineLoad: clamp(gearTorque * enginePull * tuning.engineTorque, 0.45, 1.85),
    powerSlip: handlingProfile === "polished" ? car.powerSlip : 0,
    rearLockIntent,
    driftShiftSustain,
  });
  car.rearReleaseMemory = updateRearReleaseMemory(
    car.rearReleaseMemory,
    {
      instantRelease: stability.rearGripRelease,
      throttle: car.throttleAxis,
      speed,
      driftMinSpeed: tuning.driftMinSpeed,
      rearSlip,
      sideSpeed,
      driftAmount: car.driftAmount,
      rearSlipVisual: car.rearSlipVisual,
      rearLockIntent,
      powerSlip: handlingProfile === "polished" ? car.powerSlip * Math.pow(Math.abs(car.steerAxis), 0.8) : 0,
    },
    dt,
  );
  const poweredReleaseMemory = car.rearReleaseMemory * car.throttleAxis;
  const surfaceGrip = lerp(1, tuning.offTrackGrip, car.offTrackAmount);
  const weightTransferScale = tuning.weightTransferScale ?? 1;
  const accelerationTransfer = -car.filteredLongitudinalAcceleration * 0.017 * weightTransferScale;
  const slideTransferScale = lerp(1, 0.52, car.brakeAxis * brakeSlideLoad);
  const trailBrakeTransfer = car.brakeAxis * brakeSlideLoad * clamp(speed / 18, 0, 1) * 0.008;
  const longitudinalTransfer = clamp(
    accelerationTransfer * slideTransferScale + rearLockIntent * 0.14 + trailBrakeTransfer,
    -0.12,
    0.24,
  );
  const lateralLoadSensitivity = 1 - clamp(Math.abs(car.filteredLateralAcceleration) * 0.004, 0, 0.045);
  const frontLoad = (1 + longitudinalTransfer) * lateralLoadSensitivity;
  const rearLoad = (1 - longitudinalTransfer * 1.08) * lateralLoadSensitivity;
  const lateralRelease = rearLockIntent * clamp(
    0.72 + Math.abs(car.steerAxis) * 0.42 + Math.abs(rearSlip) / (50 * degToRad),
    0,
    1,
  );
  const handbrakeCurve = Math.pow(lateralRelease, 0.72);
  const frontBrakeLateralScale = 1 - car.brakeAxis * brakeSlideLoad * 0.38;
  const frontGrip =
    tuning.frontGrip *
    surfaceGrip *
    frontLoad *
    stability.frontGripScale *
    (1 - Math.abs(car.frontWheelAngle / effectiveMaxSteer) * speed01 * 0.1) *
    frontBrakeLateralScale;
  const baseRearGrip = lerp(tuning.rearGrip * rearLoad, tuning.handbrakeRearGrip, handbrakeCurve);
  const drivenGripScale =
    handlingProfile === "polished"
      ? 1 - car.powerSlip *
        lerp(0.1, drivetrainTuning.lateralGripLossAtFullSlip, Math.pow(Math.abs(car.steerAxis), 0.8)) *
        lerp(0.9, 1.12, differentialLock)
      : 1;
  const drivenGripFloor =
    tuning.handbrakeRearGrip *
    surfaceGrip *
    lerp(
      1,
      drivetrainTuning.powerGripFloorAtFullSlip,
      car.powerSlip * Math.pow(Math.abs(car.steerAxis), 0.8),
    );
  const rearGrip = Math.max(
    drivenGripFloor,
    baseRearGrip * surfaceGrip * (1 - Math.max(stability.rearGripRelease, car.rearReleaseMemory)) *
      drivenGripScale *
      (1 + stability.recovery * 0.36 * (1 - poweredReleaseMemory * 0.85)) +
      stability.rearGripAssist * (1 - poweredReleaseMemory * 0.62),
  );
  const tireForceSpeedGate = clamp(speed / 1.35, 0, 1);
  const frontLateralAcceleration =
    tireAcceleration(frontSlip, tuning.frontCorneringStiffness, frontGrip, 14, 42, 0.08) * tireForceSpeedGate;
  const rearLateralAcceleration = tireAcceleration(
    rearSlip,
    tuning.rearCorneringStiffness * lerp(1, 0.08, rearLockIntent),
    rearGrip,
    9.5,
    40,
    0.32,
  ) * tireForceSpeedGate;
  // During a rapid correction, preserve front-axle bite so the car can bend its
  // trajectory into the corner. Only the rear's translational shove is softened.
  const lateralAcceleration =
    (frontLateralAcceleration + rearLateralAcceleration * stability.frontTranslationScale) * (onTrack ? 1 : 0.82);
  let yawAcceleration =
    (tuning.frontAxle * frontLateralAcceleration - tuning.rearAxle * rearLateralAcceleration) / tuning.yawInertia;
  yawAcceleration += stability.yawAcceleration;

  forwardSpeed += (longitudinalAcceleration + sideSpeed * car.yawVelocity) * dt;
  sideSpeed += (lateralAcceleration - forwardSpeed * car.yawVelocity) * dt;
  car.yawVelocity += yawAcceleration * dt;
  car.yawVelocity *= Math.max(0, 1 - stability.yawDampingRate * (1 - rearLockIntent * 0.52) * dt);

  forwardSpeed = clamp(forwardSpeed, -tuning.maxReverseSpeed, tuning.maxForwardSpeed);
  forwardSpeed *= Math.max(0, 1 - stability.forwardScrubRate * dt);
  sideSpeed *= Math.max(0, 1 - stability.lateralScrubRate * dt);
  sideSpeed *= Math.max(0, 1 - stability.lateralRecoveryRate * (1 - poweredReleaseMemory * 0.82) * dt);
  if (!onTrack) {
    const progressiveOffTrackDrag = tuning.offTrackDrag * (0.1 + car.offTrackAmount * 0.28);
    forwardSpeed *= Math.max(0, 1 - progressiveOffTrackDrag * dt);
    sideSpeed *= Math.max(0, 1 - progressiveOffTrackDrag * 1.28 * dt);
  }

  car.heading += car.yawVelocity * dt;

  const nextForward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  const nextRight = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
  car.velocity.x = nextForward.x * forwardSpeed + nextRight.x * sideSpeed;
  car.velocity.z = nextForward.z * forwardSpeed + nextRight.z * sideSpeed;
  if (speed < 0.08 && car.throttleAxis < 0.025 && car.brakeAxis < 0.025) {
    car.velocity.x = 0;
    car.velocity.z = 0;
    car.yawVelocity = 0;
  }
  car.position.x += car.velocity.x * dt;
  car.position.z += car.velocity.z * dt;

  const bodySlip = Math.atan2(sideSpeed, Math.max(Math.abs(forwardSpeed), 0.1));
  const bodySlipSignal = Math.abs(bodySlip) / (38 * degToRad);
  const rearSlipSignal = clamp((Math.abs(rearSlip) - 5 * degToRad) / (30 * degToRad), 0, 1.35);
  const driftSignal = Math.min(Math.max(bodySlipSignal, rearSlipSignal), bodySlipSignal * 0.55 + rearSlipSignal * 0.78);
  const driftTarget =
    speed > tuning.driftMinSpeed && driftSignal > 0.23
      ? clamp(driftSignal * (1 - stability.recovery * 0.42 * (1 - poweredReleaseMemory * 0.9)), 0, 1)
      : 0;

  car.speed = length(car.velocity);
  car.slipAngle = Math.abs(bodySlip) * radToDeg;
  car.frontSlipAngle = frontSlip * radToDeg;
  car.rearSlipAngle = rearSlip * radToDeg;
  car.driftAmount = lerp(car.driftAmount, driftTarget, smooth(driftTarget > car.driftAmount ? 7.5 : 4.4, dt));
  car.slipAmount = clamp(Math.max(car.slipAngle / 55, Math.abs(car.rearSlipAngle) / 44), 0, 1);
  car.gripAmount = clamp(rearGrip / tuning.rearGrip - car.driftAmount * 0.15, 0.08, 1);
  car.driftDirection = signed(sideSpeed) || car.driftDirection || 1;
  car.wheelSpin += (forwardSpeed / tuning.wheelRadius) * dt;
  const drivenWheelSpeed =
    forwardSpeed + signed(forwardSpeed || 1) * car.powerSlip * car.throttleAxis * (4 + gearTorque * 10);
  const freeRearSpin = car.rearWheelSpin + (drivenWheelSpeed / tuning.wheelRadius) * dt;
  car.rearWheelSpin = lerp(freeRearSpin, car.rearWheelSpin, rearLockIntent);
  car.rearSlipVisual = lerp(car.rearSlipVisual, clamp(Math.abs(rearSlip) / (26 * degToRad), 0, 1), smooth(10, dt));
  const heatTarget = clamp(car.rearSlipVisual * 0.78 + car.handbrakeAmount * 0.35 + car.throttleAxis * car.driftAmount * 0.25, 0, 1);
  car.tireHeat = lerp(car.tireHeat, heatTarget, smooth(heatTarget > car.tireHeat ? 1.8 : 0.34, dt));

  const measuredLongitudinalAcceleration = clamp(
    (forwardSpeed - priorForwardSpeed) / Math.max(dt, 1 / 240),
    -32,
    32,
  );
  const longitudinalAccelerationTarget = Number.isFinite(measuredLongitudinalAcceleration)
    ? measuredLongitudinalAcceleration
    : longitudinalAcceleration;
  const longitudinalFilterRate =
    Math.abs(longitudinalAccelerationTarget) > Math.abs(car.filteredLongitudinalAcceleration) ? 8.4 : 4.6;
  car.filteredLongitudinalAcceleration = lerp(
    car.filteredLongitudinalAcceleration,
    longitudinalAccelerationTarget,
    smooth(longitudinalFilterRate, dt),
  );
  const lateralFilterRate =
    Math.abs(lateralAcceleration) > Math.abs(car.filteredLateralAcceleration) ? 9.2 : 5.2;
  car.filteredLateralAcceleration = lerp(
    car.filteredLateralAcceleration,
    lateralAcceleration,
    smooth(lateralFilterRate, dt),
  );
  const longitudinalLoad = clamp(
    (-car.filteredLongitudinalAcceleration * 0.036 + rearLockIntent * 0.16) * weightTransferScale,
    -1,
    1,
  );
  const lateralLoad = clamp(
    (car.filteredLateralAcceleration * 0.052 + car.yawVelocity * 0.12) * weightTransferScale,
    -1,
    1,
  );
  car.bodyPitch = lerp(car.bodyPitch, longitudinalLoad, smooth(5.8, dt));
  car.bodyRoll = lerp(car.bodyRoll, lateralLoad, smooth(7.2, dt));
  car.weightForward = clamp(0.5 + car.bodyPitch * 0.23, 0.22, 0.78);
  car.weightRight = clamp(0.5 - car.bodyRoll * 0.24, 0.22, 0.78);

  const frontBias = car.weightForward - 0.5;
  const rightBias = car.weightRight - 0.5;
  car.suspensionFL = clamp(0.5 + frontBias - rightBias, 0, 1);
  car.suspensionFR = clamp(0.5 + frontBias + rightBias, 0, 1);
  car.suspensionRL = clamp(0.5 - frontBias - rightBias, 0, 1);
  car.suspensionRR = clamp(0.5 - frontBias + rightBias, 0, 1);
}

export function resolveTrackSafetyBoundary(
  car: CarState,
  _previousPose: CarPose2D,
  track: TrackConfig,
  tuning?: CarTuning,
): CollisionResult {
  const response = collisionResponses.boundary;
  const carHalfWidth = Math.max(1.08, (tuning?.collisionWidth ?? 2.76) * 0.5);
  const closest = closestTrackPoint(car.position, track);

  if (closest) {
    const centerLimit = getRoadHalfWidth(track) + track.boundaryMargin - carHalfWidth;
    if (closest.distance < centerLimit) return emptyCollisionResult;

    // Outward normal (from track center toward car)
    const dx = car.position.x - closest.x;
    const dz = car.position.z - closest.z;
    const distance = Math.max(closest.distance, 0.001);
    // Inward normal (from car toward track center) — points toward legal area
    const inwardX = -dx / distance;
    const inwardZ = -dz / distance;

    // Correct only the excess penetration
    const excess = closest.distance - centerLimit;
    const correction = Math.min(
      response.maxCorrection,
      Math.max(0, excess - response.correctionSlop) * response.correctionPercent,
    );
    car.position.x += inwardX * correction;
    car.position.z += inwardZ * correction;

    // Velocity response — normal is inward (toward legal area)
    const normalSpeed = car.velocity.x * inwardX + car.velocity.z * inwardZ;
    // If moving outward (negative inward speed), apply gentle bounce
    if (normalSpeed < -response.bounceThreshold) {
      const closingSpeed = -normalSpeed;
      const bounceSpeed = Math.min(
        response.maxBounceSpeed,
        closingSpeed * response.restitution,
      );

      const tangentX = car.velocity.x - normalSpeed * inwardX;
      const tangentZ = car.velocity.z - normalSpeed * inwardZ;

      car.velocity.x = tangentX * response.tangentRetention + inwardX * bounceSpeed;
      car.velocity.z = tangentZ * response.tangentRetention + inwardZ * bounceSpeed;

      // No yaw impulse — the invisible safety boundary should not spin the car.
      // Visible authored objects already provide contact-point yaw.
      const severity = clamp(
        (closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
        0,
        1,
      );
      car.speed = Math.hypot(car.velocity.x, car.velocity.z);
      return { severity, contactCount: 1, colliderIds: ["boundary"] };
    }

    car.speed = Math.hypot(car.velocity.x, car.velocity.z);
    return emptyCollisionResult;
  }

  // No road path — radial boundary
  const limit = (track.roadPath ? track.roadWidth + 34 : track.roadWidth) + track.boundaryMargin - carHalfWidth;
  const distance = Math.hypot(car.position.x, car.position.z);
  if (distance < limit) return emptyCollisionResult;

  const inwardX = -car.position.x / Math.max(distance, 0.001);
  const inwardZ = -car.position.z / Math.max(distance, 0.001);
  const excess = distance - limit;
  const correction = Math.min(
    response.maxCorrection,
    Math.max(0, excess - response.correctionSlop) * response.correctionPercent,
  );
  car.position.x += inwardX * correction;
  car.position.z += inwardZ * correction;

  const normalSpeed = car.velocity.x * inwardX + car.velocity.z * inwardZ;
  if (normalSpeed < -response.bounceThreshold) {
    const closingSpeed = -normalSpeed;
    const bounceSpeed = Math.min(
      response.maxBounceSpeed,
      closingSpeed * response.restitution,
    );
    const tangentX = car.velocity.x - normalSpeed * inwardX;
    const tangentZ = car.velocity.z - normalSpeed * inwardZ;
    car.velocity.x = tangentX * response.tangentRetention + inwardX * bounceSpeed;
    car.velocity.z = tangentZ * response.tangentRetention + inwardZ * bounceSpeed;

    const severity = clamp(
      (closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
      0,
      1,
    );
    car.speed = Math.hypot(car.velocity.x, car.velocity.z);
    return { severity, contactCount: 1, colliderIds: ["boundary"] };
  }

  car.speed = Math.hypot(car.velocity.x, car.velocity.z);
  return emptyCollisionResult;
}
