import type { CarState, CarTuning, InputState, TrackConfig, Vec2 } from "../types";

const degToRad = Math.PI / 180;
const radToDeg = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const length = (value: Vec2) => Math.hypot(value.x, value.z);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const signed = (value: number) => (Math.abs(value) < 0.001 ? 0 : Math.sign(value));

function tireAcceleration(slipAngle: number, stiffness: number, gripLimit: number) {
  return -gripLimit * Math.tanh((stiffness * slipAngle) / Math.max(gripLimit, 0.001));
}

function torqueCurve(rpm: number, tuning: CarTuning) {
  const normalized = clamp((rpm - tuning.idleRpm) / (tuning.redlineRpm - tuning.idleRpm), 0, 1);
  const lowEnd = 0.42 + normalized * 0.78;
  const topEndFalloff = 1 - Math.max(0, normalized - 0.72) * 1.15;
  return clamp(Math.min(lowEnd, topEndFalloff), 0.38, 1.05);
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

export function resetCar(car: CarState, track: TrackConfig) {
  car.position.x = track.start.x;
  car.position.z = track.start.z;
  car.heading = track.start.heading;
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
  car.brakeAxis = lerp(car.brakeAxis, input.brake, smooth(tuning.throttleResponse * 1.35, dt));
  car.handbrakeAmount = lerp(car.handbrakeAmount, input.handbrake ? 1 : 0, smooth(input.handbrake ? 9 : 5.2, dt));

  const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  const right = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
  let forwardSpeed = car.velocity.x * forward.x + car.velocity.z * forward.z;
  let sideSpeed = car.velocity.x * right.x + car.velocity.z * right.z;
  const speed = length(car.velocity);
  const speed01 = clamp(speed / tuning.maxForwardSpeed, 0, 1);
  const steerLimit = lerp(1, tuning.steeringAtSpeed, speed01);
  const maxSteer = tuning.maxSteerAngle * degToRad;

  car.frontWheelAngle = car.steerAxis * maxSteer * steerLimit;

  const maxGear = tuning.gearRatios.length;
  const currentRatio = tuning.gearRatios[car.gear - 1] ?? tuning.gearRatios[0];
  const wheelRpm = (Math.abs(forwardSpeed) / (2 * Math.PI * tuning.wheelRadius)) * 60;
  const coupledRpm = wheelRpm * currentRatio * tuning.finalDrive;
  const launchSlip = clamp(1 - Math.abs(forwardSpeed) / 5, 0, 1) * car.throttleAxis;
  const freeRevRpm = tuning.idleRpm + car.throttleAxis * (tuning.redlineRpm - tuning.idleRpm) * 0.5;
  const rpmTarget = clamp(lerp(Math.max(tuning.idleRpm, coupledRpm), freeRevRpm, launchSlip), tuning.idleRpm, tuning.redlineRpm);

  car.shiftCooldown = Math.max(0, car.shiftCooldown - dt);
  // Drivetrain inertia: RPM responds more slowly than wheel speed (flywheel effect)
  const clutchSlip = Math.abs(car.rpm - coupledRpm) / tuning.redlineRpm;
  const inertiaRate = car.shiftCooldown > 0 ? 16 : lerp(3.5, 8, clutchSlip);
  car.rpm = lerp(car.rpm, rpmTarget, smooth(inertiaRate, dt));

  if (car.shiftCooldown <= 0) {
    const nextRatio = tuning.gearRatios[car.gear] ?? 0;
    const previousRatio = tuning.gearRatios[car.gear - 2] ?? 0;
    const nextGearRpm = wheelRpm * nextRatio * tuning.finalDrive;
    const previousGearRpm = wheelRpm * previousRatio * tuning.finalDrive;
    const shouldUpshift = car.rpm > tuning.shiftUpRpm && car.gear < maxGear && nextGearRpm > tuning.shiftDownRpm * 0.75;
    const shouldKickdown =
      car.throttleAxis > 0.82 &&
      car.gear > 1 &&
      previousGearRpm < tuning.redlineRpm * 0.94 &&
      car.rpm < tuning.shiftDownRpm + 900;
    const shouldDownshift =
      car.gear > 1 && Math.abs(forwardSpeed) > 2.5 && (car.rpm < tuning.shiftDownRpm || shouldKickdown);

    if (shouldUpshift) {
      car.gear += 1;
      car.shiftCooldown = 0.2;
      car.rpm = Math.max(tuning.idleRpm, nextGearRpm);
    } else if (shouldDownshift) {
      car.gear -= 1;
      car.shiftCooldown = shouldKickdown ? 0.14 : 0.18;
      car.rpm = clamp(previousGearRpm, tuning.idleRpm, tuning.redlineRpm);
    }
  }

  const gearRatio = tuning.gearRatios[car.gear - 1] ?? currentRatio;
  const gearTorque = (gearRatio * tuning.finalDrive) / 12;
  const enginePull = torqueCurve(car.rpm, tuning);

  const shiftTorque = car.shiftCooldown > 0 ? 0.58 : 1;
  const rearLockIntent = car.handbrakeAmount * clamp((speed - 3) / 14, 0, 1);
  let drive =
    tuning.acceleration *
    car.throttleAxis *
    gearTorque *
    enginePull *
    tuning.engineTorque *
    shiftTorque *
    (1 - rearLockIntent * 0.72);
  // Reverse lockout: must brake to near-stop and hold for engagement delay
  const reverseReady = Math.abs(forwardSpeed) < 2.0;
  const reverseActive = reverseReady && car.brakeAxis > 0.9 && car.reverseEngageTimer >= 0.12;
  if (car.brakeAxis > 0 && forwardSpeed > 0.5) drive -= tuning.brakeForce * car.brakeAxis;
  if (reverseActive && forwardSpeed <= 0.5) drive -= tuning.reverseAcceleration * car.brakeAxis;
  car.reverseEngageTimer = reverseReady && car.brakeAxis > 0.9 ? car.reverseEngageTimer + dt : 0;

  const handbrakeDrag = rearLockIntent * tuning.handbrakeDrag * Math.sign(forwardSpeed) * Math.min(Math.abs(forwardSpeed), 28);
  const rolling = tuning.rollingResistance * Math.sign(forwardSpeed) * clamp(Math.abs(forwardSpeed), 0, 1);
  const aero = tuning.drag * forwardSpeed * Math.abs(forwardSpeed);
  const longitudinalAcceleration = drive - handbrakeDrag - rolling - aero;

  const safeForwardSpeed = Math.max(Math.abs(forwardSpeed), 1.8);
  const frontPatchSideSpeed = sideSpeed + car.yawVelocity * tuning.frontAxle;
  const rearPatchSideSpeed = sideSpeed - car.yawVelocity * tuning.rearAxle;
  const physicsWheelAngle = forwardSpeed < -0.5 ? -car.frontWheelAngle : car.frontWheelAngle;
  const frontSlip = Math.atan2(frontPatchSideSpeed, safeForwardSpeed) - physicsWheelAngle;
  const rearSlip = Math.atan2(rearPatchSideSpeed, safeForwardSpeed);
  const counterSteering = signed(car.frontWheelAngle) !== 0 && signed(car.frontWheelAngle) === signed(sideSpeed);
  const counterSteerQuality = counterSteering ? clamp(Math.abs(car.frontWheelAngle) / (maxSteer * 0.72), 0, 1) : 0;
  const throttleGripLoss =
    car.throttleAxis *
    tuning.throttleGripLoss *
    clamp((Math.abs(forwardSpeed) - tuning.driftMinSpeed) / 24, 0, 1) *
    clamp(gearTorque * enginePull * tuning.engineTorque, 0.45, 1.85);
  const surfaceGrip = onTrack ? 1 : tuning.offTrackGrip;
  const brakeTransfer = clamp(car.brakeAxis * 1.1 + rearLockIntent * 0.55, 0, 1);
  const throttleTransfer = car.throttleAxis * clamp(Math.abs(forwardSpeed) / 12, 0, 1);
  const frontLoad = 1 + brakeTransfer * 0.22 - throttleTransfer * 0.08;
  const rearLoad = 1 + throttleTransfer * 0.14 - brakeTransfer * 0.28;
  const lateralRelease = rearLockIntent * clamp(0.25 + Math.abs(car.steerAxis) * 0.5 + Math.abs(rearSlip) / (44 * degToRad), 0, 1);
  const handbrakeCurve = Math.pow(lateralRelease, 0.82);
  const frontGrip =
    tuning.frontGrip * surfaceGrip * frontLoad * (1 - Math.abs(car.frontWheelAngle / maxSteer) * speed01 * 0.08);
  const baseRearGrip = lerp(tuning.rearGrip * rearLoad, tuning.handbrakeRearGrip, handbrakeCurve);
  const rearGrip = Math.max(
    tuning.handbrakeRearGrip * surfaceGrip,
    baseRearGrip * surfaceGrip * (1 - throttleGripLoss) + tuning.counterSteerAssist * counterSteerQuality,
  );
  const frontLateralAcceleration = tireAcceleration(frontSlip, tuning.frontCorneringStiffness, frontGrip);
  const rearLateralAcceleration = tireAcceleration(rearSlip, tuning.rearCorneringStiffness, rearGrip);
  const lateralAcceleration = (frontLateralAcceleration + rearLateralAcceleration) * (onTrack ? 1 : 0.82);
  const yawAcceleration =
    (tuning.frontAxle * frontLateralAcceleration - tuning.rearAxle * rearLateralAcceleration) / tuning.yawInertia;

  forwardSpeed += (longitudinalAcceleration + sideSpeed * car.yawVelocity) * dt;
  sideSpeed += (lateralAcceleration - forwardSpeed * car.yawVelocity) * dt;
  car.yawVelocity += yawAcceleration * dt;
  const lowSpeedYawDamping = lerp(3.2, 1, clamp(speed / 12, 0, 1));
  car.yawVelocity *= Math.max(0, 1 - tuning.yawDamping * lowSpeedYawDamping * dt);

  forwardSpeed = clamp(forwardSpeed, -tuning.maxReverseSpeed, tuning.maxForwardSpeed);

  const slipSeverity = clamp(Math.abs(sideSpeed) / 18 + Math.abs(rearSlip) / (42 * degToRad), 0, 1.6);
  const slideScrub = tuning.slideDrag * slipSeverity * Math.abs(sideSpeed);
  forwardSpeed *= Math.max(0, 1 - (tuning.driftDrag * speed + slideScrub) * dt);
  sideSpeed *= Math.max(0, 1 - (tuning.driftDrag * speed * 0.75 + tuning.slideDrag * 0.5 * speed) * dt);
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
  const driftSignal = Math.max(Math.abs(bodySlip) / (42 * degToRad), Math.abs(rearSlip) / (32 * degToRad));
  const driftTarget = speed > tuning.driftMinSpeed && driftSignal > 0.22 ? clamp(driftSignal, 0, 1) : 0;

  car.speed = length(car.velocity);
  car.slipAngle = Math.abs(bodySlip) * radToDeg;
  car.frontSlipAngle = frontSlip * radToDeg;
  car.rearSlipAngle = rearSlip * radToDeg;
  car.driftAmount = lerp(car.driftAmount, driftTarget, smooth(driftTarget > car.driftAmount ? 7.5 : 4.4, dt));
  car.slipAmount = clamp(Math.max(car.slipAngle / 55, Math.abs(car.rearSlipAngle) / 44), 0, 1);
  car.gripAmount = clamp(rearGrip / tuning.rearGrip - car.driftAmount * 0.15, 0.08, 1);
  car.driftDirection = signed(sideSpeed) || car.driftDirection || 1;
  car.wheelSpin += (forwardSpeed / tuning.wheelRadius) * dt;
  const rearSpinTarget = car.wheelSpin * (1 - rearLockIntent);
  car.rearWheelSpin = lerp(car.rearWheelSpin + (forwardSpeed / tuning.wheelRadius) * dt * (1 - rearLockIntent), rearSpinTarget, smooth(20 * rearLockIntent, dt));
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
