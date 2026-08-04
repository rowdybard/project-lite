import type { CarState, CarTuning, InputState, TrackConfig } from "../types";
import { createCarState, updateCar } from "./car";
import { createDriftState, finishDriftRun, updateDriftScore } from "./drift";
import type { HandlingProfileId } from "./handlingStability";

const step = 1 / 120;
const idleInput: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  reset: false,
  confirm: false,
  zoneNext: false,
  debug: false,
  menu: false,
};

function atSpeed(track: TrackConfig, speed: number) {
  const car = createCarState(track);
  car.velocity.x = Math.sin(car.heading) * speed;
  car.velocity.z = Math.cos(car.heading) * speed;
  car.speed = speed;
  return car;
}

function runFor(
  car: CarState,
  tuning: CarTuning,
  profile: HandlingProfileId,
  seconds: number,
  inputAt: (time: number, car: CarState) => InputState,
  onTrackAt: (time: number, car: CarState) => boolean = () => true,
) {
  let maxAngle = 0;
  let maxRearSlip = 0;
  let maxHandbrake = 0;
  let maxReleaseMemory = 0;
  let maxPowerSlip = 0;
  let peakRpm = car.rpm;
  let minGear = car.gear;
  let maxGear = car.gear;
  let driftSeconds = 0;
  let transitions = 0;
  let previousDirection = car.driftDirection;
  const count = Math.round(seconds / step);
  for (let i = 0; i < count; i++) {
    const time = i * step;
    updateCar(car, inputAt(time, car), tuning, step, onTrackAt(time, car), profile);
    maxAngle = Math.max(maxAngle, car.slipAngle);
    maxRearSlip = Math.max(maxRearSlip, Math.abs(car.rearSlipAngle));
    maxHandbrake = Math.max(maxHandbrake, car.handbrakeAmount);
    maxReleaseMemory = Math.max(maxReleaseMemory, car.rearReleaseMemory);
    maxPowerSlip = Math.max(maxPowerSlip, car.powerSlip);
    peakRpm = Math.max(peakRpm, car.rpm);
    minGear = Math.min(minGear, car.gear);
    maxGear = Math.max(maxGear, car.gear);
    if (car.driftAmount > 0.24) driftSeconds += step;
    if (car.driftDirection !== previousDirection) transitions += 1;
    previousDirection = car.driftDirection;
  }
  return {
    maxAngle,
    maxRearSlip,
    maxHandbrake,
    maxReleaseMemory,
    maxPowerSlip,
    peakRpm,
    minGear,
    maxGear,
    driftSeconds,
    transitions,
  };
}

function gearPullProbe(
  tuning: CarTuning,
  track: TrackConfig,
  profile: HandlingProfileId,
  gear: number,
  speed: number,
) {
  const car = atSpeed(track, speed);
  car.gear = Math.min(gear, tuning.gearRatios.length);
  const startMph = car.speed * 2.237;
  const result = runFor(car, tuning, profile, 0.85, () => ({ ...idleInput, throttle: 1 }));
  return {
    requestedGear: gear,
    startMph,
    endMph: car.speed * 2.237,
    endGear: car.gear,
    peakRpm: result.peakRpm,
    peakPowerSlip: result.maxPowerSlip,
  };
}

function shiftContinuityProbe(tuning: CarTuning, track: TrackConfig, profile: HandlingProfileId) {
  const car = atSpeed(track, 13.5);
  car.gear = 1;
  let shifts = 0;
  let previousGear = car.gear;
  let previousSpeed = car.speed;
  let worstAcceleration = Infinity;
  let peakPowerSlip = 0;
  const events: Array<{
    from: number;
    to: number;
    mph: number;
    rpm: number;
    rpmFraction: number;
    roadRpm: number;
  }> = [];
  for (let i = 0; i < Math.round(3.2 / step); i++) {
    updateCar(car, { ...idleInput, throttle: 1 }, tuning, step, true, profile);
    if (car.gear !== previousGear) {
      shifts += 1;
      const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
      const forwardSpeed = Math.abs(car.velocity.x * forward.x + car.velocity.z * forward.z);
      const wheelRpm = (forwardSpeed / (2 * Math.PI * tuning.wheelRadius)) * 60;
      const roadRpm = wheelRpm * (tuning.gearRatios[car.gear - 1] ?? tuning.gearRatios[0]) * tuning.finalDrive;
      events.push({
        from: previousGear,
        to: car.gear,
        mph: car.speed * 2.237,
        rpm: car.rpm,
        rpmFraction: car.rpm / tuning.redlineRpm,
        roadRpm,
      });
    }
    worstAcceleration = Math.min(worstAcceleration, (car.speed - previousSpeed) / step);
    peakPowerSlip = Math.max(peakPowerSlip, car.powerSlip);
    previousGear = car.gear;
    previousSpeed = car.speed;
  }
  return {
    shifts,
    endGear: car.gear,
    endMph: car.speed * 2.237,
    worstAcceleration,
    peakPowerSlip,
    events,
  };
}

function drivetrainReport(tuning: CarTuning, track: TrackConfig, profile: HandlingProfileId) {
  const standingCar = createCarState(track);
  standingCar.gear = 1;
  const standingInitiation = runFor(standingCar, tuning, profile, 1.4, () => ({
    ...idleInput,
    throttle: 1,
    steer: 0.78,
  }));
  const initiationCar = atSpeed(track, 23);
  initiationCar.gear = Math.min(2, tuning.gearRatios.length);
  const initiation = runFor(initiationCar, tuning, profile, 1.25, () => ({
    ...idleInput,
    throttle: 1,
    steer: 0.62,
  }));
  return {
    standingInitiation: {
      peakPowerSlip: standingInitiation.maxPowerSlip,
      rearSlip: standingInitiation.maxRearSlip,
      angle: standingInitiation.maxAngle,
      endMph: standingCar.speed * 2.237,
    },
    lowGear: gearPullProbe(tuning, track, profile, 1, 11),
    midGear: gearPullProbe(tuning, track, profile, 3, 24),
    highGear: gearPullProbe(tuning, track, profile, Math.min(5, tuning.gearRatios.length), 34),
    initiation: {
      peakPowerSlip: initiation.maxPowerSlip,
      rearSlip: initiation.maxRearSlip,
      angle: initiation.maxAngle,
      endGear: initiationCar.gear,
    },
    shift: shiftContinuityProbe(tuning, track, profile),
  };
}

function speedForRoadRpm(tuning: CarTuning, gear: number, rpm: number) {
  const ratio = tuning.gearRatios[gear - 1] ?? tuning.gearRatios[0];
  return (rpm / (ratio * tuning.finalDrive)) * (2 * Math.PI * tuning.wheelRadius) / 60;
}

function automaticShiftProbe(tuning: CarTuning, track: TrackConfig) {
  const upshiftCar = atSpeed(track, speedForRoadRpm(tuning, 2, tuning.shiftUpRpm * 0.9));
  upshiftCar.gear = 2;
  upshiftCar.rpm = tuning.shiftUpRpm * 0.9;
  const upshift = runFor(upshiftCar, tuning, "polished", 1.2, () => ({ ...idleInput, throttle: 1 }));

  const downshiftCar = atSpeed(track, speedForRoadRpm(tuning, 3, tuning.shiftDownRpm * 0.84));
  downshiftCar.gear = 3;
  downshiftCar.rpm = tuning.shiftDownRpm * 0.84;
  const downshift = runFor(downshiftCar, tuning, "polished", 0.7, () => ({ ...idleInput, throttle: 0.86 }));

  return {
    upshift: { startGear: 2, endGear: upshiftCar.gear, maxGear: upshift.maxGear },
    downshift: { startGear: 3, endGear: downshiftCar.gear, minGear: downshift.minGear },
  };
}

function gearBandMph(tuning: CarTuning, gear: number) {
  return speedForRoadRpm(tuning, gear, tuning.shiftUpRpm) * 2.237;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function tightCornerProbe(tuning: CarTuning, track: TrackConfig) {
  const car = atSpeed(track, 11);
  car.gear = Math.min(2, tuning.gearRatios.length);
  const startHeading = car.heading;
  const coast = runFor(car, tuning, "polished", 0.7, () => ({
    ...idleInput,
    steer: 0.78,
  }));
  const coastHeadingDeg = Math.abs(normalizeAngle(car.heading - startHeading)) * (180 / Math.PI);
  const coastEndMph = car.speed * 2.237;
  const commitment = car.lowSpeedTurnCommitment;
  const powered = runFor(car, tuning, "polished", 0.8, () => ({
    ...idleInput,
    throttle: 0.72,
    steer: 0.68,
  }));
  return {
    commitment,
    coastHeadingDeg,
    coastRearSlip: coast.maxRearSlip,
    coastAngle: coast.maxAngle,
    coastEndMph,
    poweredRearSlip: powered.maxRearSlip,
    poweredAngle: powered.maxAngle,
    poweredEndMph: car.speed * 2.237,
  };
}

function zeroThrottleSteerProbe(tuning: CarTuning, track: TrackConfig) {
  const car = createCarState(track);
  const start = { ...car.position };
  runFor(car, tuning, "polished", 1.2, () => ({
    ...idleInput,
    steer: 1,
  }));
  return {
    displacement: Math.hypot(car.position.x - start.x, car.position.z - start.z),
    speed: car.speed,
    yawVelocity: car.yawVelocity,
  };
}

function slideBrakeProbe(tuning: CarTuning, track: TrackConfig) {
  const coastCar = atSpeed(track, 25);
  coastCar.gear = Math.min(3, tuning.gearRatios.length);
  runFor(coastCar, tuning, "polished", 1.1, () => ({
    ...idleInput,
    throttle: 0.86,
    steer: 0.62,
  }));
  runFor(coastCar, tuning, "polished", 0.8, (_time, state) => ({
    ...idleInput,
    steer: -state.driftDirection * 0.18,
  }));

  const car = atSpeed(track, 25);
  car.gear = Math.min(3, tuning.gearRatios.length);
  runFor(car, tuning, "polished", 1.1, () => ({
    ...idleInput,
    throttle: 0.86,
    steer: 0.62,
  }));
  const entryMph = car.speed * 2.237;
  const entryAngle = car.slipAngle;
  const startHeading = car.heading;
  const braking = runFor(car, tuning, "polished", 0.8, (_time, state) => ({
    ...idleInput,
    brake: 0.62,
    steer: -state.driftDirection * 0.18,
  }));
  const exitMph = car.speed * 2.237;
  const exitAngle = car.slipAngle;
  const brakeHeadingDeg = Math.abs(normalizeAngle(car.heading - startHeading)) * (180 / Math.PI);
  const throttleRecovery = runFor(car, tuning, "polished", 0.8, (_time, state) => ({
    ...idleInput,
    throttle: 0.78,
    steer: -state.driftDirection * 0.2,
  }));
  return {
    entryMph,
    entryAngle,
    coastMph: coastCar.speed * 2.237,
    coastAngle: coastCar.slipAngle,
    exitMph,
    exitAngle,
    brakeHeadingDeg,
    brakingPeakRearSlip: braking.maxRearSlip,
    recoveredMph: car.speed * 2.237,
    recoveryAngle: throttleRecovery.maxAngle,
  };
}

function hardCorrectionProbe(tuning: CarTuning, track: TrackConfig) {
  const car = atSpeed(track, 30);
  car.gear = Math.min(3, tuning.gearRatios.length);
  runFor(car, tuning, "polished", 1.3, () => ({ ...idleInput, throttle: 0.9, steer: 0.62 }));

  const start = { ...car.position };
  const startHeading = car.heading;
  const right = { x: Math.cos(startHeading), z: -Math.sin(startHeading) };
  const startSideSpeed = car.velocity.x * right.x + car.velocity.z * right.z;
  const correction = runFor(car, tuning, "polished", 0.7, () => ({
    ...idleInput,
    throttle: 0.78,
    steer: -0.94,
  }));
  const endSideSpeed = car.velocity.x * right.x + car.velocity.z * right.z;
  const lateralDisplacement = Math.abs((car.position.x - start.x) * right.x + (car.position.z - start.z) * right.z);
  const headingChange = Math.abs(normalizeAngle(car.heading - startHeading));

  return {
    startSideSpeed,
    endSideSpeed,
    lateralDisplacement,
    sideSpeedChange: Math.abs(endSideSpeed - startSideSpeed),
    lateralVelocityChangePerSecond: Math.abs(endSideSpeed - startSideSpeed) / 0.7,
    headingChangeDeg: headingChange * (180 / Math.PI),
    lateralMetersPerRadian: lateralDisplacement / Math.max(headingChange, 0.05),
    peakAngle: correction.maxAngle,
    peakRearSlip: correction.maxRearSlip,
  };
}

function highSpeedFishtailProbe(tuning: CarTuning, track: TrackConfig) {
  const car = atSpeed(track, 36);
  car.gear = Math.min(4, tuning.gearRatios.length);
  runFor(car, tuning, "polished", 1.15, () => ({ ...idleInput, throttle: 0.96, steer: 0.56 }));

  let directionChanges = 0;
  let driftDirectionChanges = 0;
  let previousDirection = car.driftDirection;
  let previousYawDirection = Math.abs(car.yawVelocity) > 0.05 ? Math.sign(car.yawVelocity) : 0;
  let peakRearSlip = 0;
  let peakAngle = 0;
  let peakPowerSlip = 0;
  let peakRpmFlare = 0;
  let peakRpm = car.rpm;
  const samples: Array<{ time: number; steer: number; direction: number; yawVelocity: number; sideSpeed: number; slip: number }> = [];
  for (let i = 0; i < Math.round(2.8 / step); i++) {
    const time = i * step;
    const steer = Math.floor(time / 0.58) % 2 === 0 ? -0.82 : 0.82;
    updateCar(car, { ...idleInput, throttle: 0.9, steer }, tuning, step, true, "polished");
    const forward = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
    const forwardSpeed = Math.abs(car.velocity.x * forward.x + car.velocity.z * forward.z);
    const wheelRpm = (forwardSpeed / (2 * Math.PI * tuning.wheelRadius)) * 60;
    const roadRpm = wheelRpm * (tuning.gearRatios[car.gear - 1] ?? tuning.gearRatios[0]) * tuning.finalDrive;
    peakRpmFlare = Math.max(peakRpmFlare, car.rpm - roadRpm);
    peakRpm = Math.max(peakRpm, car.rpm);
    peakRearSlip = Math.max(peakRearSlip, Math.abs(car.rearSlipAngle));
    peakAngle = Math.max(peakAngle, car.slipAngle);
    peakPowerSlip = Math.max(peakPowerSlip, car.powerSlip);
    if (car.driftDirection !== previousDirection) driftDirectionChanges += 1;
    previousDirection = car.driftDirection;
    const yawDirection = Math.abs(car.yawVelocity) > 0.05 ? Math.sign(car.yawVelocity) : previousYawDirection;
    if (previousYawDirection !== 0 && yawDirection !== previousYawDirection) directionChanges += 1;
    previousYawDirection = yawDirection;
    if (i % Math.round(0.29 / step) === 0) {
      const right = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
      samples.push({
        time,
        steer,
        direction: car.driftDirection,
        yawVelocity: car.yawVelocity,
        sideSpeed: car.velocity.x * right.x + car.velocity.z * right.z,
        slip: car.slipAngle,
      });
    }
  }

  return {
    directionChanges,
    driftDirectionChanges,
    peakRearSlip,
    peakAngle,
    peakPowerSlip,
    peakRpm,
    peakRpmFlare,
    endMph: car.speed * 2.237,
    samples,
  };
}

function grassRecovery(tuning: CarTuning, track: TrackConfig, profile: HandlingProfileId, gear: number) {
  const car = atSpeed(track, gear >= 4 ? 31 : 23);
  car.gear = Math.min(gear, tuning.gearRatios.length);
  car.rpm = tuning.shiftUpRpm * 0.72;
  const entryMph = car.speed * 2.237;
  const grass = runFor(
    car,
    tuning,
    profile,
    0.72,
    () => ({ ...idleInput, throttle: 0.58, steer: 0.56 }),
    () => false,
  );
  const grassExitMph = car.speed * 2.237;
  runFor(car, tuning, profile, 2.6, (time, state) => ({
    ...idleInput,
    throttle: time < 0.45 ? 0.58 : 0.86,
    steer: state.driftDirection * (time < 0.7 ? 0.24 : 0.08),
  }));
  return {
    entryGear: gear,
    entryMph,
    grassExitMph,
    grassPeakAngle: grass.maxAngle,
    recoveryMph: car.speed * 2.237,
    recoveryGear: car.gear,
    recoveryRpm: car.rpm,
    surfaceRecovered: car.offTrackAmount < 0.01,
  };
}

function profileReport(tuning: CarTuning, track: TrackConfig, profile: HandlingProfileId) {
  const launchCar = createCarState(track);
  runFor(launchCar, tuning, profile, 4, () => ({ ...idleInput, throttle: 1 }));

  const turnCar = atSpeed(track, 22);
  const steadyTurn = runFor(turnCar, tuning, profile, 3.5, () => ({ ...idleInput, throttle: 0.62, steer: 0.48 }));

  const powerInitiationCar = atSpeed(track, 23);
  const powerInitiation = runFor(
    powerInitiationCar,
    tuning,
    profile,
    1.25,
    () => ({ ...idleInput, throttle: 0.92, steer: 0.64 }),
  );

  const handbrakeCar = atSpeed(track, 23);
  const handbrake = runFor(handbrakeCar, tuning, profile, 0.95, () => ({
    ...idleInput,
    throttle: 0.42,
    steer: 0.7,
    handbrake: true,
  }));
  const heldDrift = runFor(handbrakeCar, tuning, profile, 3.4, (time, car) => ({
    ...idleInput,
    throttle: 0.82,
    steer: -car.driftDirection * (time < 0.55 ? 0.08 : 0.24),
  }));
  const slipBeforeLift = handbrakeCar.slipAngle;
  runFor(handbrakeCar, tuning, profile, 1.5, (_time, car) => ({
    ...idleInput,
    steer: car.driftDirection * 0.28,
  }));

  const transitionCar = atSpeed(track, 25);
  runFor(transitionCar, tuning, profile, 1.6, () => ({ ...idleInput, throttle: 0.72, steer: 0.62 }));
  const transition = runFor(transitionCar, tuning, profile, 1.8, () => ({ ...idleInput, throttle: 0.72, steer: -0.62 }));

  const brakeCar = atSpeed(track, 27);
  runFor(brakeCar, tuning, profile, 2.2, () => ({ ...idleInput, brake: 0.82 }));

  return {
    profile,
    launchMph: launchCar.speed * 2.237,
    steadyTurnAngle: steadyTurn.maxAngle,
    steadyTurnRearSlip: steadyTurn.maxRearSlip,
    steadyReleaseMemory: steadyTurn.maxReleaseMemory,
    powerInitiationAngle: powerInitiation.maxAngle,
    powerInitiationRearSlip: powerInitiation.maxRearSlip,
    handbrakeRearSlip: handbrake.maxRearSlip,
    handbrakeAngle: handbrake.maxAngle,
    handbrakeLock: handbrake.maxHandbrake,
    heldDriftAngle: heldDrift.maxAngle,
    heldRearSlip: heldDrift.maxRearSlip,
    heldReleaseMemory: heldDrift.maxReleaseMemory,
    heldDriftSeconds: heldDrift.driftSeconds,
    heldDriftEndGear: handbrakeCar.gear,
    liftRecoveryAngle: handbrakeCar.slipAngle,
    liftRecovered: handbrakeCar.slipAngle < Math.max(10, slipBeforeLift * 0.82),
    transitionAngle: transition.maxAngle,
    transitionDirectionChanges: transition.transitions,
    brakingEndMph: brakeCar.speed * 2.237,
    grassRecoveryGear2: grassRecovery(tuning, track, profile, 2),
    grassRecoveryGear4: grassRecovery(tuning, track, profile, 4),
  };
}

function scoringRun(track: TrackConfig, dt: number) {
  const car = atSpeed(track, 22);
  const drift = createDriftState();
  drift.bestRun = 0;
  const count = Math.round(12 / dt);
  let peakTier = 0;

  for (let i = 0; i < count; i++) {
    const time = i * dt;
    const active = time < 10.4;
    const phase = time < 2.4 ? 0 : time < 6.3 ? 1 : 2;
    car.speed = active ? [22, 28, 35][phase] : 12;
    car.slipAngle = active ? [20, 32, 44][phase] : 2;
    car.rearSlipAngle = active ? [18, 28, 38][phase] : 2;
    car.driftAmount = active ? [0.48, 0.7, 0.86][phase] : 0;
    car.yawVelocity = active ? 0.62 : 0.05;
    car.driftDirection = time >= 6.35 ? -1 : 1;
    updateDriftScore(drift, car, dt, true, -1, 0);
    peakTier = Math.max(peakTier, drift.tier);
  }

  return { total: drift.totalScore + drift.comboScore, peakTier, transitions: drift.transitionCooldown > 0 ? 1 : 0 };
}

function calibratedScoringRun(track: TrackConfig, expert: boolean) {
  const car = atSpeed(track, expert ? 34 : 26);
  const drift = createDriftState();
  drift.bestRun = 0;
  let peakTier = 0;
  let transitions = 0;
  let previousCooldown = 0;
  const duration = 90;
  const transitionPeriod = expert ? 5.2 : 7.8;

  for (let i = 0; i < Math.round(duration / step); i++) {
    const time = i * step;
    const wave = Math.sin(time * (expert ? 0.72 : 0.48));
    car.speed = (expert ? 34 : 26) + wave * (expert ? 3 : 2);
    car.slipAngle = (expert ? 43 : 27) + wave * (expert ? 6 : 4);
    car.rearSlipAngle = (expert ? 38 : 25) + wave * (expert ? 5 : 3);
    car.driftAmount = expert ? 0.9 : 0.68;
    car.yawVelocity = expert ? 1.05 : 0.7;
    car.driftDirection = Math.floor(time / transitionPeriod) % 2 === 0 ? 1 : -1;
    updateDriftScore(drift, car, step, true, -1, 0);
    peakTier = Math.max(peakTier, drift.tier);
    if (drift.transitionCooldown > 0 && previousCooldown <= 0) transitions += 1;
    previousCooldown = drift.transitionCooldown;
  }

  return { total: finishDriftRun(drift), peakTier, transitions };
}

function linkedLapScoringRun(track: TrackConfig) {
  const car = atSpeed(track, 29);
  const drift = createDriftState();
  drift.bestRun = 0;
  let peakTier = 0;
  let transitions = 0;
  let previousCooldown = 0;
  const duration = 90;

  for (let i = 0; i < Math.round(duration / step); i++) {
    const time = i * step;
    const cycle = Math.floor(time / 12);
    const cycleTime = time % 12;
    const active = cycleTime < 8.6;
    const transitionDirection = cycleTime < 4.25 ? 1 : -1;
    car.speed = active ? 29 + Math.sin(time * 0.62) * 2.5 : 18;
    car.slipAngle = active ? 34 + Math.sin(time * 0.55) * 5 : 3;
    car.rearSlipAngle = active ? 30 + Math.sin(time * 0.51) * 4 : 3;
    car.driftAmount = active ? 0.78 : 0.05;
    car.yawVelocity = active ? 0.84 : 0.08;
    car.driftDirection = transitionDirection;
    const zone = active && cycleTime > 5.2 ? cycle : -1;
    updateDriftScore(drift, car, step, true, zone, 0);
    peakTier = Math.max(peakTier, drift.tier);
    if (drift.transitionCooldown > 0 && previousCooldown <= 0) transitions += 1;
    previousCooldown = drift.transitionCooldown;
  }

  return { total: finishDriftRun(drift), peakTier, transitions };
}

function scoringExploitProbe(track: TrackConfig) {
  const reverseCar = atSpeed(track, 24);
  reverseCar.velocity.x *= -1;
  reverseCar.velocity.z *= -1;
  const reverse = createDriftState();
  reverse.bestRun = 0;

  const donutCar = atSpeed(track, 16);
  const donut = createDriftState();
  donut.bestRun = 0;
  for (let i = 0; i < Math.round(8 / step); i++) {
    reverseCar.slipAngle = 35;
    reverseCar.rearSlipAngle = 34;
    reverseCar.driftAmount = 0.86;
    reverseCar.yawVelocity = 1.15;
    reverseCar.driftDirection = 1;
    updateDriftScore(reverse, reverseCar, step, true, -1, 0);

    const angle = i * step * 1.85;
    donutCar.heading = angle;
    donutCar.velocity.x = Math.sin(angle + Math.PI / 2) * 16;
    donutCar.velocity.z = Math.cos(angle + Math.PI / 2) * 16;
    donutCar.speed = 16;
    donutCar.slipAngle = 76;
    donutCar.rearSlipAngle = 68;
    donutCar.driftAmount = 0.96;
    donutCar.yawVelocity = 1.85;
    donutCar.driftDirection = 1;
    updateDriftScore(donut, donutCar, step, true, -1, 0);
  }

  return {
    reverseScore: finishDriftRun(reverse),
    donutScore: finishDriftRun(donut),
  };
}

export function runHandlingHarness(tuning: CarTuning, track: TrackConfig) {
  const classic = profileReport(tuning, track, "classic");
  const polished = profileReport(tuning, track, "polished");
  const score60 = scoringRun(track, 1 / 60);
  const score120 = scoringRun(track, 1 / 120);
  const controlledRun = calibratedScoringRun(track, false);
  const expertRun = calibratedScoringRun(track, true);
  const linkedLap = linkedLapScoringRun(track);
  const drivetrain = drivetrainReport(tuning, track, "polished");
  const hardCorrection = hardCorrectionProbe(tuning, track);
  const highSpeedFishtail = highSpeedFishtailProbe(tuning, track);
  const tightCorner = tightCornerProbe(tuning, track);
  const slideBrake = slideBrakeProbe(tuning, track);
  const zeroThrottleSteer = zeroThrottleSteerProbe(tuning, track);
  const scoringExploits = scoringExploitProbe(track);
  const scoringDelta = Math.abs(score60.total - score120.total) / Math.max(1, score120.total);
  const checks = {
    launch: polished.launchMph > 25,
    rearInitiation: polished.powerInitiationRearSlip > 9 && polished.powerInitiationAngle > 8,
    handbrakeInitiates: polished.handbrakeLock > 0.95 && polished.heldRearSlip > 10,
    sustainedDrift: polished.heldDriftSeconds > 0.6,
    recovery: polished.liftRecovered,
    transition: polished.transitionAngle > 9,
    braking: polished.brakingEndMph < 36,
    grassRecoveryGear2:
      polished.grassRecoveryGear2.surfaceRecovered &&
      polished.grassRecoveryGear2.recoveryMph > polished.grassRecoveryGear2.grassExitMph * 1.18,
    grassRecoveryGear4:
      polished.grassRecoveryGear4.surfaceRecovered &&
      polished.grassRecoveryGear4.recoveryMph > polished.grassRecoveryGear4.grassExitMph * 1.18,
    scoreRateIndependent: scoringDelta < 0.025,
    tiersEscalate: score120.peakTier >= 2,
    controlledScoreRange: controlledRun.total >= 500000 && controlledRun.total <= 1800000,
    linkedLapScoreRange: linkedLap.total >= 650000 && linkedLap.total <= 1400000,
    expertScoreRange: expertRun.total >= 1000000,
    lowGearPull: drivetrain.lowGear.endMph > drivetrain.lowGear.startMph + 8,
    midGearPull: drivetrain.midGear.endMph > drivetrain.midGear.startMph + 3,
    highGearPull: drivetrain.highGear.endMph > drivetrain.highGear.startMph + 1,
    torqueBreakaway:
      drivetrain.initiation.peakPowerSlip > 0.12 &&
      drivetrain.initiation.rearSlip > 9 &&
      drivetrain.initiation.angle > 8,
    standingPowerOver:
      drivetrain.standingInitiation.peakPowerSlip > 0.3 &&
      drivetrain.standingInitiation.rearSlip > 7 &&
      drivetrain.standingInitiation.angle > 6,
    shiftContinuity: drivetrain.shift.shifts >= 1 && drivetrain.shift.worstAcceleration > -1.5,
    shiftRpmHeadroom: drivetrain.shift.events
      .filter((event) => event.to > event.from && event.to <= 3)
      .every((event) => event.rpmFraction >= 0.55 && event.rpmFraction <= 0.78),
    hardCorrectionDoesNotStrafe:
      hardCorrection.lateralVelocityChangePerSecond < 4 && hardCorrection.peakRearSlip > 15,
    highSpeedFishtail:
      highSpeedFishtail.directionChanges >= 2 &&
      highSpeedFishtail.peakRearSlip > 14 &&
      highSpeedFishtail.peakRpmFlare > 180,
    tightCornerRotation:
      tightCorner.commitment > 0.35 &&
      tightCorner.coastHeadingDeg > 8 &&
      tightCorner.coastRearSlip > 4 &&
      tightCorner.coastEndMph > 10,
    tightCornerPowerContinuation:
      tightCorner.poweredRearSlip > 8 &&
      tightCorner.poweredAngle > 7,
    slideBrakePreservesMomentum:
      slideBrake.exitMph > slideBrake.entryMph * 0.45 &&
      slideBrake.exitMph < slideBrake.entryMph * 0.94,
    slideBrakeControlsLine:
      slideBrake.exitAngle > 5 &&
      slideBrake.brakeHeadingDeg > 6 &&
      slideBrake.recoveryAngle > 7,
    zeroThrottleSteerStationary:
      zeroThrottleSteer.displacement < 0.001 &&
      zeroThrottleSteer.speed < 0.001 &&
      Math.abs(zeroThrottleSteer.yawVelocity) < 0.001,
    reverseScoreSuppressed: scoringExploits.reverseScore === 0,
    donutScoreSuppressed: scoringExploits.donutScore < 10000,
  };
  return {
    classic,
    polished,
    scoring: { hz60: score60, hz120: score120, delta: scoringDelta, controlledRun, linkedLap, expertRun },
    drivetrain,
    hardCorrection,
    highSpeedFishtail,
    tightCorner,
    slideBrake,
    zeroThrottleSteer,
    scoringExploits,
    checks,
  };
}

export function runFleetTransmissionHarness(
  cars: Array<{ id: string; tuning: CarTuning }>,
  track: TrackConfig,
) {
  const reports = cars.map(({ id, tuning }) => {
    const profile = profileReport(tuning, track, "polished");
    const drivetrain = drivetrainReport(tuning, track, "polished");
    const shifts = automaticShiftProbe(tuning, track);
    const hardCorrection = hardCorrectionProbe(tuning, track);
    const highSpeedFishtail = highSpeedFishtailProbe(tuning, track);
    const checks = {
      fourSpeeds: tuning.gearRatios.length === 4,
      lowGearPull: drivetrain.lowGear.endMph > drivetrain.lowGear.startMph + 8,
      midGearPull: drivetrain.midGear.endMph > drivetrain.midGear.startMph + 3,
      highGearPull: drivetrain.highGear.endMph > drivetrain.highGear.startMph + 1,
      powerInitiation: profile.powerInitiationRearSlip > 9 && profile.powerInitiationAngle > 8,
      standingPowerOver:
        drivetrain.standingInitiation.peakPowerSlip > 0.3 &&
        drivetrain.standingInitiation.rearSlip > 7 &&
        drivetrain.standingInitiation.angle > 6,
      sustainedDrift: profile.heldDriftSeconds > 0.6,
      liftRecovery: profile.liftRecovered,
      upshift: shifts.upshift.maxGear >= 3,
      downshift: shifts.downshift.minGear <= 2,
      shiftRpmHeadroom: drivetrain.shift.events
        .filter((event) => event.to > event.from && event.to <= 3)
        .every((event) => event.rpmFraction >= 0.55 && event.rpmFraction <= 0.78),
      grassRecovery:
        profile.grassRecoveryGear2.surfaceRecovered &&
        profile.grassRecoveryGear4.surfaceRecovered &&
        profile.grassRecoveryGear2.recoveryMph > profile.grassRecoveryGear2.grassExitMph * 1.18 &&
        profile.grassRecoveryGear4.recoveryMph > profile.grassRecoveryGear4.grassExitMph * 1.18,
      hardCorrectionDoesNotStrafe:
        hardCorrection.lateralVelocityChangePerSecond < 4,
      highSpeedFishtail:
        highSpeedFishtail.directionChanges >= 2 &&
        highSpeedFishtail.peakRearSlip > 14 &&
        highSpeedFishtail.peakRpmFlare > 180,
    };
    return {
      id,
      finalDrive: tuning.finalDrive,
      gearBandsMph: tuning.gearRatios.map((_ratio, index) => gearBandMph(tuning, index + 1)),
      shiftUpRpm: tuning.shiftUpRpm,
      shiftDownRpm: tuning.shiftDownRpm,
      drivetrain,
      shifts,
      hardCorrection,
      highSpeedFishtail,
      profile: {
        initiationAngle: profile.powerInitiationAngle,
        initiationRearSlip: profile.powerInitiationRearSlip,
        heldDriftAngle: profile.heldDriftAngle,
        heldDriftSeconds: profile.heldDriftSeconds,
        liftRecoveryAngle: profile.liftRecoveryAngle,
        grassRecoveryGear2: profile.grassRecoveryGear2,
        grassRecoveryGear4: profile.grassRecoveryGear4,
      },
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  });

  return { reports, passed: reports.every((report) => report.passed) };
}

export function mountHandlingHarnessReport(report: ReturnType<typeof runHandlingHarness>) {
  const root = document.createElement("pre");
  root.className = "handling-harness";
  root.textContent = `HANDLING / SCORE PROBE\n${JSON.stringify(report, null, 2)}`;
  document.body.append(root);
}
