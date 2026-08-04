import type { CarState, DriftState } from "../types";

const mph = 2.237;
const bestRunKey = "cargame.bestDriftRun";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export const driftTiers = [
  { name: "Initiate", multiplier: 1, progress: 0 },
  { name: "Street", multiplier: 1.2, progress: 1.8 },
  { name: "Flow", multiplier: 1.5, progress: 4.8 },
  { name: "Pro", multiplier: 1.9, progress: 8.8 },
  { name: "Elite", multiplier: 2.4, progress: 14 },
  { name: "Master", multiplier: 3, progress: 21 },
  { name: "Legend", multiplier: 3.8, progress: 30 },
  { name: "Apex", multiplier: 4.8, progress: 42 },
] as const;

export const driftScoreConfig = {
  pointScale: 50,
  minSpeedMph: 18,
  minAngleDeg: 7.5,
  minRearSlipDeg: 8,
  minDriftAmount: 0.24,
  chainGraceSeconds: 1.05,
  transitionCooldownSeconds: 1.15,
  zoneBonusCooldownSize: 8,
  spinAngleDeg: 82,
  spinYawRate: 2.65,
  spinBreakSeconds: 0.38,
  minForwardSpeedMps: 5.5,
  minForwardVelocityRatio: 0.34,
  loopYawRate: 1.3,
  loopBreakSeconds: 1.15,
} as const;

function readBestRun() {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(bestRunKey);
  return raw ? Number(raw) || 0 : 0;
}

function saveBestRun(score: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(bestRunKey, Math.round(score).toString());
}

function applyTier(state: DriftState, tier: number) {
  state.tier = clamp(Math.round(tier), 0, driftTiers.length - 1);
  state.tierName = driftTiers[state.tier].name;
  state.multiplier = driftTiers[state.tier].multiplier;
  state.grade = `${state.tier + 1} ${state.tierName}`;
}

function bankChain(state: DriftState, bankFactor = 1) {
  const banked = state.comboScore * bankFactor;
  state.totalScore += banked;
  state.bestCombo = Math.max(state.bestCombo, state.comboScore);
  state.bestRun = Math.max(state.bestRun, state.totalScore);
  saveBestRun(state.bestRun);
  state.comboScore = 0;
  return banked;
}

function clearChain(state: DriftState) {
  state.active = false;
  state.grace = 0;
  state.driftTime = 0;
  state.lastDirection = 0;
  state.flow = 0;
  state.tractionQuality = 0;
  state.angleQuality = 0;
  state.speedQuality = 0;
  state.scoreRate = 0;
  state.tierProgress = 0;
  state.transitionCooldown = 0;
  state.spinTime = 0;
  state.loopTime = 0;
  state.zonesHit = [];
  applyTier(state, 0);
}

function breakChain(state: DriftState, label: string, bankFactor: number) {
  const banked = bankChain(state, bankFactor);
  clearChain(state);
  state.grade = label;
  state.callout = `${label} - banked ${Math.round(banked)}`;
  state.calloutTimer = 1.35;
}

export function createDriftState(): DriftState {
  return {
    totalScore: 0,
    comboScore: 0,
    bestCombo: 0,
    multiplier: 1,
    driftTime: 0,
    totalDriftTime: 0,
    active: false,
    grace: 0,
    lastDirection: 0,
    grade: "1 Initiate",
    bestRun: readBestRun(),
    currentZone: -1,
    zonesHit: [],
    callout: "Drift",
    calloutTimer: 0,
    onTrack: true,
    tier: 0,
    tierName: driftTiers[0].name,
    tierProgress: 0,
    flow: 0,
    tractionQuality: 0,
    angleQuality: 0,
    speedQuality: 0,
    scoreRate: 0,
    transitionCooldown: 0,
    contactCooldown: 0,
    spinTime: 0,
    loopTime: 0,
  };
}

export function resetDrift(state: DriftState) {
  const bestRun = state.bestRun;
  Object.assign(state, createDriftState(), { bestRun });
}

export function finishDriftRun(state: DriftState) {
  bankChain(state);
  clearChain(state);
  return state.totalScore;
}

export function updateDriftScore(
  state: DriftState,
  car: CarState,
  dt: number,
  onTrack: boolean,
  zoneIndex: number,
  contactSeverity = 0,
) {
  const speedMph = car.speed * mph;
  const angle = car.slipAngle;
  const rearSlip = Math.abs(car.rearSlipAngle);
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const forwardSpeed = car.velocity.x * forwardX + car.velocity.z * forwardZ;
  const forwardRatio = forwardSpeed / Math.max(car.speed, 0.1);
  const isScoring =
    onTrack && speedMph > driftScoreConfig.minSpeedMph && angle > driftScoreConfig.minAngleDeg &&
    rearSlip > driftScoreConfig.minRearSlipDeg && car.driftAmount > driftScoreConfig.minDriftAmount &&
    forwardSpeed > driftScoreConfig.minForwardSpeedMps && forwardRatio > driftScoreConfig.minForwardVelocityRatio;

  state.calloutTimer = Math.max(0, state.calloutTimer - dt);
  state.transitionCooldown = Math.max(0, state.transitionCooldown - dt);
  state.contactCooldown = Math.max(0, state.contactCooldown - dt);
  state.onTrack = onTrack;
  state.currentZone = zoneIndex;
  state.bestRun = Math.max(state.bestRun, state.totalScore + state.comboScore);

  const spinning =
    onTrack && speedMph > 22 && (angle > driftScoreConfig.spinAngleDeg || Math.abs(car.yawVelocity) > driftScoreConfig.spinYawRate);
  state.spinTime = spinning ? state.spinTime + dt : Math.max(0, state.spinTime - dt * 2.5);
  if (state.active && state.spinTime >= driftScoreConfig.spinBreakSeconds) {
    breakChain(state, "Spin out", 0.45);
    return;
  }

  const looping =
    onTrack && speedMph > 18 && Math.abs(car.yawVelocity) > driftScoreConfig.loopYawRate &&
    (angle > 58 || forwardRatio < 0.48);
  state.loopTime = looping ? state.loopTime + dt : Math.max(0, state.loopTime - dt * 2.4);
  if (state.active && state.loopTime >= driftScoreConfig.loopBreakSeconds) {
    breakChain(state, "Drift loop", 0.2);
    return;
  }

  if (state.active && contactSeverity > 0.08 && state.contactCooldown <= 0) {
    state.contactCooldown = 0.8;
    if (contactSeverity >= 0.58) {
      breakChain(state, "Heavy contact", 0.6);
      return;
    }

    state.comboScore *= 0.92;
    const reducedTier = Math.max(0, state.tier - 1);
    const tierCeiling = driftTiers[Math.min(driftTiers.length - 1, reducedTier + 1)].progress;
    state.tierProgress = Math.min(state.tierProgress * 0.82, Math.max(0, tierCeiling - 0.2));
    applyTier(state, reducedTier);
    state.grace = Math.min(state.grace, 0.45);
    state.callout = "Contact - tier down";
    state.calloutTimer = 1;
  }

  if (isScoring) {
    const overspinControl = 1 - clamp((angle - 60) / 24, 0, 0.72);
    const tractionTarget =
      clamp((rearSlip - 7) / 27, 0, 1) * (0.72 + clamp(car.driftAmount, 0, 1) * 0.28);
    const angleTarget = clamp((angle - 7) / 39, 0, 1) * overspinControl;
    const speedTarget = clamp((speedMph - 18) / 72, 0, 1);
    state.tractionQuality += (tractionTarget - state.tractionQuality) * smooth(3.3, dt);
    state.angleQuality += (angleTarget - state.angleQuality) * smooth(2.8, dt);
    state.speedQuality += (speedTarget - state.speedQuality) * smooth(2.4, dt);

    const liveQuality =
      Math.pow(Math.max(0.001, state.tractionQuality), 0.42) *
      Math.pow(Math.max(0.001, state.angleQuality), 0.33) *
      Math.pow(Math.max(0.001, state.speedQuality), 0.25);
    state.flow += (liveQuality - state.flow) * smooth(liveQuality > state.flow ? 2.2 : 4.4, dt);

    if (!state.active) {
      state.callout = "Chain started";
      state.calloutTimer = 0.9;
      state.lastDirection = car.driftDirection;
    }

    state.active = true;
    state.grace = driftScoreConfig.chainGraceSeconds;
    state.driftTime += dt;
    state.totalDriftTime += dt;
    state.tierProgress += Math.pow(state.flow, 1.35) * (0.78 + state.tractionQuality * 0.27) * dt;

    let nextTier = state.tier;
    while (nextTier + 1 < driftTiers.length && state.tierProgress >= driftTiers[nextTier + 1].progress) nextTier += 1;
    if (nextTier > state.tier) {
      applyTier(state, nextTier);
      state.callout = `Tier ${state.tier + 1} - ${state.tierName}`;
      state.calloutTimer = 1.25;
    } else {
      applyTier(state, state.tier);
    }

    const direction = car.driftDirection || state.lastDirection || 1;
    if (
      state.lastDirection !== 0 && direction !== state.lastDirection && state.transitionCooldown <= 0 &&
      state.driftTime > 1.2 && state.flow > 0.34 && angle > 12 && rearSlip > 11
    ) {
      const transitionBonus = 150 * driftScoreConfig.pointScale * state.multiplier * (0.65 + state.flow * 0.55);
      state.comboScore += transitionBonus;
      state.tierProgress += 0.28 + state.flow * 0.18;
      state.transitionCooldown = driftScoreConfig.transitionCooldownSeconds;
      state.callout = `Clean link +${Math.round(transitionBonus)}`;
      state.calloutTimer = 1;
    }
    state.lastDirection = direction;

    if (zoneIndex >= 0 && state.flow > 0.46 && angle > 16 && !state.zonesHit.includes(zoneIndex)) {
      const lineBonus = 230 * driftScoreConfig.pointScale * state.multiplier * (0.7 + state.flow * 0.5);
      state.comboScore += lineBonus;
      state.zonesHit.push(zoneIndex);
      if (state.zonesHit.length > driftScoreConfig.zoneBonusCooldownSize) state.zonesHit.shift();
      state.callout = `Committed line +${Math.round(lineBonus)}`;
      state.calloutTimer = 1;
    }

    const primaryRate =
      speedMph * Math.min(angle, 62) * (0.25 + state.tractionQuality * 0.75) * 0.16;
    state.scoreRate = primaryRate * driftScoreConfig.pointScale * state.flow * state.multiplier;
    state.comboScore += state.scoreRate * dt;
    state.bestCombo = Math.max(state.bestCombo, state.comboScore);

    if (state.calloutTimer <= 0) {
      if (angle > 46 && speedMph > 55 && state.flow > 0.58) {
        state.callout = "Fast high angle";
        state.calloutTimer = 0.65;
      } else if (state.tractionQuality > 0.72 && state.driftTime > 3.5) {
        state.callout = "Rear grip broken";
        state.calloutTimer = 0.65;
      }
    }
    return;
  }

  state.scoreRate = 0;
  state.tractionQuality += (0 - state.tractionQuality) * smooth(5, dt);
  state.angleQuality += (0 - state.angleQuality) * smooth(5, dt);
  state.speedQuality += (0 - state.speedQuality) * smooth(4, dt);
  state.flow += (0 - state.flow) * smooth(3.2, dt);

  if (state.active && !onTrack) {
    const banked = bankChain(state);
    clearChain(state);
    state.grade = "Off track";
    state.callout = `Off track - banked ${Math.round(banked)}`;
    state.calloutTimer = 1.25;
    return;
  }

  if (state.active) {
    state.grace -= dt;
    if (state.grace > 0) return;

    const banked = bankChain(state);
    clearChain(state);
    if (banked > 2500) {
      state.callout = `Banked +${Math.round(banked)}`;
      state.calloutTimer = 1.4;
    }
  }
}
