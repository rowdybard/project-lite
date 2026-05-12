import type { CarState, DriftState } from "../types";

const mph = 2.237;
const bestRunKey = "cargame.bestDriftRun";

function readBestRun() {
  const raw = window.localStorage.getItem(bestRunKey);
  return raw ? Number(raw) || 0 : 0;
}

function saveBestRun(score: number) {
  window.localStorage.setItem(bestRunKey, Math.round(score).toString());
}

function gradeFor(combo: number, angle: number, driftTime: number) {
  if (combo > 25000 || (angle > 44 && driftTime > 4.5)) return "Master Drift";
  if (combo > 12000 || angle > 36) return "Sick";
  if (combo > 5000 || angle > 26) return "Great";
  if (combo > 1200 || angle > 14) return "Good";
  return "Drift";
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
    transitionCooldown: 0,
    transitionCount: 0,
    grade: "Drift",
    bestRun: readBestRun(),
    currentZone: -1,
    zonesHit: [],
    callout: "Drift",
    calloutTimer: 0,
    onTrack: true,
  };
}

export function resetDrift(state: DriftState) {
  state.totalScore = 0;
  state.comboScore = 0;
  state.bestCombo = 0;
  state.multiplier = 1;
  state.driftTime = 0;
  state.totalDriftTime = 0;
  state.active = false;
  state.grace = 0;
  state.lastDirection = 0;
  state.transitionCooldown = 0;
  state.transitionCount = 0;
  state.grade = "Drift";
  state.currentZone = -1;
  state.zonesHit = [];
  state.callout = "Drift";
  state.calloutTimer = 0;
  state.onTrack = true;
}

export function updateDriftScore(state: DriftState, car: CarState, dt: number, onTrack: boolean, zoneIndex: number) {
  const speedMph = car.speed * mph;
  const angle = car.slipAngle;
  const direction = Math.sign(car.driftDirection || car.steerAxis || car.yawVelocity);
  const isScoring = onTrack && speedMph > 14 && angle > 6 && car.driftAmount > 0.18;

  state.transitionCooldown = Math.max(0, state.transitionCooldown - dt);
  state.calloutTimer = Math.max(0, state.calloutTimer - dt);
  state.onTrack = onTrack;
  state.currentZone = zoneIndex;
  state.bestRun = Math.max(state.bestRun, state.totalScore + state.comboScore);

  if (isScoring) {
    if (!state.active) {
      state.callout = "Drift started";
      state.calloutTimer = 1.1;
      state.transitionCount = 0;
    }

    state.active = true;
    state.grace = 1.15;
    state.driftTime += dt;
    state.totalDriftTime += dt;
    state.multiplier = Math.min(5, 1 + state.driftTime * 0.1 + state.transitionCount * 0.35);
    state.grade = gradeFor(state.comboScore, angle, state.driftTime);

    if (state.lastDirection !== 0 && direction !== 0 && direction !== state.lastDirection && state.transitionCooldown <= 0) {
      const bonus = 450 * state.multiplier;
      state.comboScore += bonus;
      state.transitionCount += 1;
      state.transitionCooldown = 0.8;
      state.callout = `Transition +${Math.round(bonus)}`;
      state.calloutTimer = 1.2;
    }

    if (direction !== 0) state.lastDirection = direction;

    if (zoneIndex >= 0 && !state.zonesHit.includes(zoneIndex)) {
      const zoneBonus = 900 * state.multiplier;
      state.comboScore += zoneBonus;
      state.zonesHit.push(zoneIndex);
      if (state.zonesHit.length > 6) state.zonesHit.shift();
      state.callout = `Corner clip +${Math.round(zoneBonus)}`;
      state.calloutTimer = 1.1;
    }

    const angleScore = Math.min(angle, 58);
    const speedScore = Math.min(speedMph, 95);
    const rate = speedScore * angleScore * 0.42 * state.multiplier;
    state.comboScore += rate * dt;
    state.bestCombo = Math.max(state.bestCombo, state.comboScore);

    if (state.calloutTimer <= 0) {
      if (angle > 42) state.callout = "Great angle";
      else if (state.driftTime > 5) state.callout = "Long drift";
      else state.callout = state.grade;
      state.calloutTimer = 0.45;
    }

    if (state.totalScore + state.comboScore > state.bestRun) {
      state.bestRun = state.totalScore + state.comboScore;
      saveBestRun(state.bestRun);
    }

    return;
  }

  if (state.active && !onTrack) {
    state.comboScore = 0;
    state.active = false;
    state.grace = 0;
    state.multiplier = 1;
    state.driftTime = 0;
    state.lastDirection = 0;
    state.grade = "Off track";
    state.callout = "Off track";
    state.calloutTimer = 1.25;
    return;
  }

  if (state.active) {
    state.grace -= dt;
    if (state.grace > 0) return;

    state.totalScore += state.comboScore;
    if (state.totalScore > state.bestRun) {
      state.bestRun = state.totalScore;
      saveBestRun(state.bestRun);
    }
    if (state.comboScore > 120) {
      state.callout = `Banked +${Math.round(state.comboScore)}`;
      state.calloutTimer = 1.5;
    }
  }

  state.active = false;
  state.comboScore = 0;
  state.multiplier = 1;
  state.driftTime = 0;
  state.lastDirection = 0;
  state.grade = "Drift";
}
