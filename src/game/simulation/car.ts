import type { CarState, CarTuning, InputState, TrackConfig, Vec2 } from "../types";
import { getRoadHalfWidth } from "./trackLayout";

const degToRad = Math.PI / 180;
const radToDeg = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const length = (value: Vec2) => Math.hypot(value.x, value.z);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const signed = (value: number) => (Math.abs(value) < 0.001 ? 0 : Math.sign(value));

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
    steerAxis: 0,
    throttleAxis: 0,
    brakeAxis: 0,
    reverseEngageTimer: 0,
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
  car.steerAxis = 0;
  car.throttleAxis = 0;
  car.brakeAxis = 0;
  car.reverseEngageTimer = 0;
}

export function updateCar(car: CarState, input: InputState, tuning: CarTuning, dt: number, onTrack = true) {
  const steerTarget = Math.abs(input.steer) < 0.05 ? 0 : input.steer;
  car.steerAxis = lerp(car.steerAxis, steerTarget, smooth(tuning.steerResponse, dt));
  car.throttleAxis = lerp(car.throttleAxis, input.throttle, smooth(tuning.throttleResponse, dt));
  car.brakeAxis = lerp(car.brakeAxis, input.brake, smooth(tuning.throttleResponse * 0.82, dt));
  car.handbrakeAmount = lerp(car.handbrakeAmount, input.handbrake ? 1 : 0, smooth(input.handbrake ? 9 : 5.2, dt));

  const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  const right = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
  let forwardSpeed = car.velocity.x * forward.x + car.velocity.z * forward.z;
  let sideSpeed = car.velocity.x * right.x + car.velocity.z * right.z;
  const speed = length(car.velocity);
  const speed01 = clamp(speed / tuning.maxForwardSpeed, 0, 1);
  const steerLimit = lerp(1, tuning.steeringAtSpeed, speed01);
  const maxSteer = tuning.maxSteerAngle * degToRad;
  const slideSteerBoost = 1 + clamp(car.driftAmount * 0.14 + car.rearSlipVisual * 0.08, 0, 0.2);
  const effectiveMaxSteer = maxSteer * slideSteerBoost;

  car.frontWheelAngle = car.steerAxis * effectiveMaxSteer * steerLimit;

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
  const coupledRpm = wheelRpm * currentRatio * tuning.finalDrive;

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
  const inertiaRate = clutchEngaged ? lerp(4.5, 9, 1 - clutchSlip) : 22;
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
      (car.driftAmount > 0.2 || car.rearSlipVisual > 0.22 || car.slipAngle > 10);
    const slideDownshiftWindow = car.gear <= 3 ? 900 : 1300;
    const slideDownshift =
      slidePowerDemand &&
      car.gear > 1 &&
      previousGearRpm < tuning.redlineRpm * 0.93 &&
      car.rpm < tuning.shiftDownRpm + slideDownshiftWindow;
    const holdGearInSlide = slidePowerDemand && car.rpm < tuning.shiftUpRpm - 150;
    const highLoadUpshift =
      car.gear >= 3 &&
      car.throttleAxis > 0.62 &&
      car.rpm > tuning.shiftUpRpm * 0.91 &&
      nextGearRpm > tuning.shiftDownRpm * 0.92;

    // Upshift when RPM hits shift point and next gear stays above stall
    const shouldUpshift =
      !holdGearInSlide &&
      !brakingToStop &&
      (car.rpm > tuning.shiftUpRpm || highLoadUpshift) &&
      car.gear < maxGear &&
      nextGearRpm > tuning.shiftDownRpm * 0.52;

    // Kickdown: full throttle demands lower gear for acceleration
    const shouldKickdown =
      car.throttleAxis > 0.78 &&
      car.gear > 1 &&
      previousGearRpm < tuning.redlineRpm * 0.96 &&
      car.rpm < tuning.shiftDownRpm + 1050;

    // Downshift when lugging or kickdown requested
    const shouldDownshift =
      car.gear > 1 &&
      (absForwardSpeed > 2.0 || brakingToStop || crawling) &&
      previousGearRpm < tuning.redlineRpm * 0.96 &&
      (car.rpm < tuning.shiftDownRpm * (brakingToStop ? 1.12 : 1) || shouldKickdown || slideDownshift);

    if (shouldUpshift) {
      applyShift(car.gear + 1, slidePowerDemand ? 0.13 : 0.2, tuning.redlineRpm * 0.88);
    } else if (shouldDownshift) {
      const doubleKickdown =
        shouldKickdown &&
        !slideDownshift &&
        car.gear > 2 &&
        rpmForGear(car.gear - 2) < tuning.redlineRpm * 0.94 &&
        rpmForGear(car.gear - 2) > tuning.shiftDownRpm * 0.8;
      applyShift(car.gear - (doubleKickdown ? 2 : 1), shouldKickdown || slideDownshift ? 0.11 : 0.15, tuning.redlineRpm);
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
  const liftOff = clamp((0.38 - car.throttleAxis) / 0.38, 0, 1);
  let drive =
    tuning.acceleration *
    car.throttleAxis *
    gearTorque *
    enginePull *
    tuning.engineTorque *
    shiftTorque *
    (1 - rearLockIntent * 0.72);
  if (car.brakeAxis > 0 && forwardSpeed > 0.15) drive -= tuning.brakeForce * brakePressure;
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
  const counterSteering = signed(car.frontWheelAngle) !== 0 && signed(car.frontWheelAngle) === signed(sideSpeed);
  const counterSteerQuality = counterSteering ? clamp(Math.abs(car.frontWheelAngle) / (effectiveMaxSteer * 0.68), 0, 1) : 0;
  const slideControl = clamp((Math.abs(rearSlip) - 7 * degToRad) / (30 * degToRad), 0, 1);
  const slideSign = signed(sideSpeed) || car.driftDirection || 1;
  const steerSign = signed(car.steerAxis);
  const transitionIntent =
    steerSign !== 0 && steerSign !== slideSign && car.driftAmount > 0.42 && speed > tuning.driftMinSpeed + 4
      ? clamp((Math.abs(car.steerAxis) - 0.32) / 0.58, 0, 1) *
        clamp(Math.abs(sideSpeed) / 14, 0, 1) *
        clamp((car.rearSlipVisual - 0.15) * 1.25, 0, 1)
      : 0;
  const transitionWeight =
    transitionIntent * clamp(Math.abs(car.bodyRoll) * 0.8 + Math.abs(sideSpeed) / 24, 0, 1) * 0.48;
  const throttleGripLoss =
    car.throttleAxis *
    tuning.throttleGripLoss *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 24, 0, 1) *
    clamp(gearTorque * enginePull * tuning.engineTorque, 0.45, 1.85);
  const throttleSteerRelease =
    car.throttleAxis *
    Math.abs(car.steerAxis) *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 20, 0, 1) *
    clamp(gearTorque * enginePull * tuning.engineTorque, 0.5, 1.8) *
    0.17;
  const sustainedTurnRelease =
    car.throttleAxis *
    Math.pow(Math.abs(car.steerAxis), 1.15) *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 22, 0, 1) *
    clamp(1 - counterSteerQuality * 0.62, 0.32, 1) *
    0.13;
  const rearSlipRelease = clamp((Math.abs(rearSlip) - 8 * degToRad) / (34 * degToRad), 0, 1) * 0.1;
  const rearSlideRelease = slideControl * (0.05 + car.throttleAxis * 0.04 + (1 - counterSteerQuality) * 0.03);
  const transitionRearRelease = transitionWeight * (0.035 + car.throttleAxis * 0.018);
  const rearGripRelease = clamp(
    throttleGripLoss +
      throttleSteerRelease +
      sustainedTurnRelease +
      rearSlipRelease +
      rearSlideRelease +
      transitionRearRelease,
    0,
    0.76,
  );
  const lowSpeedRegrip =
    liftOff *
    clamp((24 - speed) / 16, 0, 1) *
    clamp((speed - 4) / 10, 0, 1) *
    clamp((Math.abs(rearSlip) - 5 * degToRad) / (26 * degToRad), 0, 1) *
    (1 - rearLockIntent * 0.65);
  const effectiveRearGripRelease = clamp(rearGripRelease - lowSpeedRegrip * 0.34, 0, 0.76);
  const surfaceGrip = onTrack ? 1 : tuning.offTrackGrip;
  const brakeTransfer = clamp(brakePressure * 0.95 + rearLockIntent * 0.55, 0, 1);
  const throttleTransfer = car.throttleAxis * clamp(Math.abs(forwardSpeed) / 12, 0, 1);
  const frontLoad = 1 + brakeTransfer * 0.22 - throttleTransfer * 0.08;
  const rearLoad = 1 + throttleTransfer * 0.14 - brakeTransfer * 0.28;
  const lateralRelease = rearLockIntent * clamp(0.25 + Math.abs(car.steerAxis) * 0.5 + Math.abs(rearSlip) / (44 * degToRad), 0, 1);
  const handbrakeCurve = Math.pow(lateralRelease, 0.82);
  const frontSlideBite = 1 + slideControl * (0.1 + counterSteerQuality * 0.22) + transitionWeight * 0.08;
  const frontGrip =
    tuning.frontGrip *
    surfaceGrip *
    frontLoad *
    frontSlideBite *
    (1 - Math.abs(car.frontWheelAngle / effectiveMaxSteer) * speed01 * 0.1);
  const baseRearGrip = lerp(tuning.rearGrip * rearLoad, tuning.handbrakeRearGrip, handbrakeCurve);
  const rearGrip = Math.max(
    tuning.handbrakeRearGrip * surfaceGrip,
    baseRearGrip * surfaceGrip * (1 - effectiveRearGripRelease) * (1 + lowSpeedRegrip * 0.42) +
      tuning.counterSteerAssist * counterSteerQuality,
  );
  const frontLateralAcceleration = tireAcceleration(frontSlip, tuning.frontCorneringStiffness, frontGrip, 14, 42, 0.08);
  const rearLateralAcceleration = tireAcceleration(rearSlip, tuning.rearCorneringStiffness, rearGrip, 9.5, 40, 0.32);
  const lateralAcceleration = (frontLateralAcceleration + rearLateralAcceleration) * (onTrack ? 1 : 0.82);
  let yawAcceleration =
    (tuning.frontAxle * frontLateralAcceleration - tuning.rearAxle * rearLateralAcceleration) / tuning.yawInertia;
  const powerOversteerYaw =
    car.steerAxis *
    car.throttleAxis *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 18, 0, 1) *
    clamp(rearGripRelease / 0.7, 0, 1) *
    (1 - counterSteerQuality * 0.7) *
    (5.2 / tuning.yawInertia) *
    0.62;
  yawAcceleration += powerOversteerYaw;
  const transitionYaw =
    steerSign *
    transitionWeight *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 18, 0, 1) *
    (1.35 / tuning.yawInertia);
  yawAcceleration += transitionYaw;

  forwardSpeed += (longitudinalAcceleration + sideSpeed * car.yawVelocity) * dt;
  sideSpeed += (lateralAcceleration - forwardSpeed * car.yawVelocity) * dt;
  car.yawVelocity += yawAcceleration * dt;
  const lowSpeedYawDamping = lerp(3.2, 1, clamp(speed / 12, 0, 1));
  const driftHold = clamp((Math.abs(rearSlip) - 8 * degToRad) / (28 * degToRad), 0, 1);
  const counterSteerYawDamping = counterSteerQuality * driftHold * 1.55;
  const transitionCatchDamping = transitionWeight * 0.9;
  const lowSpeedCatchDamping = lowSpeedRegrip * (1.7 + clamp((Math.abs(sideSpeed) - 1.5) / 8, 0, 1) * 2.1);
  car.yawVelocity *= Math.max(0, 1 - tuning.yawDamping * lowSpeedYawDamping * dt);
  car.yawVelocity *= Math.max(0, 1 - counterSteerYawDamping * dt);
  car.yawVelocity *= Math.max(0, 1 - transitionCatchDamping * dt);
  car.yawVelocity *= Math.max(0, 1 - lowSpeedRegrip * 1.8 * dt);

  forwardSpeed = clamp(forwardSpeed, -tuning.maxReverseSpeed, tuning.maxForwardSpeed);

  const slipSeverity = clamp(Math.abs(sideSpeed) / 18 + Math.abs(rearSlip) / (42 * degToRad), 0, 1.6);
  const slideScrub = tuning.slideDrag * slipSeverity * Math.abs(sideSpeed);
  const realSlideHold = clamp(Math.max(Math.abs(rearSlip) / (34 * degToRad), Math.abs(sideSpeed) / 13), 0, 1);
  const lockedRearScrub = rearLockIntent * clamp(speed / 22, 0.15, 1.2);
  const liftOffSlideDrag =
    liftOff *
    realSlideHold *
    clamp((Math.abs(rearSlip) - 8 * degToRad) / (30 * degToRad), 0, 1) *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 18, 0, 1);
  const lateralScrubFactor = lerp(0.72, 0.55, realSlideHold) + transitionWeight * 0.08;
  const speedDragLoad = lerp(0.06, 1, Math.max(realSlideHold, car.driftAmount * 0.85));
  const poweredSlideRelief =
    car.throttleAxis * realSlideHold * clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 18, 0, 1);
  const poweredForwardDrag = lerp(1, 0.62, poweredSlideRelief);
  const poweredSlideScrub = lerp(1, 0.44, poweredSlideRelief);
  const poweredLateralScrub = lerp(1, 0.82, poweredSlideRelief);
  const driftShiftScrubRelief = lerp(1, 0.72, driftShiftSustain);
  forwardSpeed *= Math.max(
    0,
    1 -
      (tuning.driftDrag * speed * speedDragLoad * poweredForwardDrag * driftShiftScrubRelief +
        slideScrub * poweredSlideScrub * driftShiftScrubRelief +
        liftOffSlideDrag * 0.72 +
        lockedRearScrub * 0.72) *
        dt,
  );
  sideSpeed *= Math.max(
    0,
    1 -
      (tuning.driftDrag * speed * (0.18 + speedDragLoad * 0.57) +
        tuning.slideDrag * lateralScrubFactor * speed * poweredLateralScrub +
        liftOffSlideDrag * 0.34 +
        lockedRearScrub * 0.46) *
        dt,
  );
  sideSpeed *= Math.max(0, 1 - lowSpeedCatchDamping * dt);
  if (!onTrack) {
    forwardSpeed *= Math.max(0, 1 - tuning.offTrackDrag * dt);
    sideSpeed *= Math.max(0, 1 - tuning.offTrackDrag * 1.35 * dt);
  }

  car.heading += car.yawVelocity * dt;

  const nextForward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  const nextRight = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
  car.velocity.x = nextForward.x * forwardSpeed + nextRight.x * sideSpeed;
  car.velocity.z = nextForward.z * forwardSpeed + nextRight.z * sideSpeed;
  car.position.x += car.velocity.x * dt;
  car.position.z += car.velocity.z * dt;

  const bodySlip = Math.atan2(sideSpeed, Math.max(Math.abs(forwardSpeed), 0.1));
  const bodySlipSignal = Math.abs(bodySlip) / (38 * degToRad);
  const rearSlipSignal = clamp((Math.abs(rearSlip) - 5 * degToRad) / (30 * degToRad), 0, 1.35);
  const driftSignal = Math.min(Math.max(bodySlipSignal, rearSlipSignal), bodySlipSignal * 0.55 + rearSlipSignal * 0.78);
  const driftTarget =
    speed > tuning.driftMinSpeed && driftSignal > 0.28 ? clamp(driftSignal * (1 - lowSpeedRegrip * 0.55), 0, 1) : 0;

  car.speed = length(car.velocity);
  car.slipAngle = Math.abs(bodySlip) * radToDeg;
  car.frontSlipAngle = frontSlip * radToDeg;
  car.rearSlipAngle = rearSlip * radToDeg;
  car.driftAmount = lerp(car.driftAmount, driftTarget, smooth(driftTarget > car.driftAmount ? 7.5 : 4.4, dt));
  car.slipAmount = clamp(Math.max(car.slipAngle / 55, Math.abs(car.rearSlipAngle) / 44), 0, 1);
  car.gripAmount = clamp(rearGrip / tuning.rearGrip - car.driftAmount * 0.15, 0.08, 1);
  car.driftDirection = signed(sideSpeed) || car.driftDirection || 1;
  car.wheelSpin += (forwardSpeed / tuning.wheelRadius) * dt;
  const freeRearSpin = car.rearWheelSpin + (forwardSpeed / tuning.wheelRadius) * dt;
  car.rearWheelSpin = lerp(freeRearSpin, car.rearWheelSpin, rearLockIntent);
  car.rearSlipVisual = lerp(car.rearSlipVisual, clamp(Math.abs(rearSlip) / (26 * degToRad), 0, 1), smooth(10, dt));
  const heatTarget = clamp(car.rearSlipVisual * 0.78 + car.handbrakeAmount * 0.35 + car.throttleAxis * car.driftAmount * 0.25, 0, 1);
  car.tireHeat = lerp(car.tireHeat, heatTarget, smooth(heatTarget > car.tireHeat ? 1.8 : 0.34, dt));

  const longitudinalLoad = clamp(brakeTransfer * 0.82 - throttleTransfer * 0.46 - longitudinalAcceleration * 0.006, -1, 1);
  const lateralLoad = clamp(lateralAcceleration * 0.044 + car.yawVelocity * 0.16 + sideSpeed * 0.012, -1, 1);
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

export function keepCarNearTrack(car: CarState, track: TrackConfig) {
  const closest = closestTrackPoint(car.position, track);
  if (closest) {
    const limit = getRoadHalfWidth(track) + track.boundaryMargin;
    if (closest.distance < limit) return 0;

    const dx = car.position.x - closest.x;
    const dz = car.position.z - closest.z;
    const distance = Math.max(closest.distance, 0.001);
    const normal = { x: dx / distance, z: dz / distance };
    car.position.x = closest.x + normal.x * limit;
    car.position.z = closest.z + normal.z * limit;

    const outwardSpeed = car.velocity.x * normal.x + car.velocity.z * normal.z;
    if (outwardSpeed > 0) {
      car.velocity.x -= normal.x * outwardSpeed * 1.35;
      car.velocity.z -= normal.z * outwardSpeed * 1.35;
    }

    return Math.min(1, Math.abs(outwardSpeed) / 20);
  }

  const limit = (track.roadPath ? track.roadWidth + 34 : track.roadWidth) + track.boundaryMargin;
  const distance = Math.hypot(car.position.x, car.position.z);

  if (distance < limit) return 0;

  const normal = { x: car.position.x / distance, z: car.position.z / distance };
  car.position.x = normal.x * limit;
  car.position.z = normal.z * limit;

  const outwardSpeed = car.velocity.x * normal.x + car.velocity.z * normal.z;
  if (outwardSpeed > 0) {
    car.velocity.x -= normal.x * outwardSpeed * 1.35;
    car.velocity.z -= normal.z * outwardSpeed * 1.35;
  }

  return Math.min(1, Math.abs(outwardSpeed) / 20);
}
