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
  state.grade = "Drift";
  state.currentZone = -1;
  state.zonesHit = [];
  state.callout = "Drift";
  state.calloutTimer = 0;
  state.onTrack = true;
}

export function finishDriftRun(state: DriftState) {
  const finalScore = state.totalScore + state.comboScore;
  state.bestCombo = Math.max(state.bestCombo, state.comboScore);
  state.bestRun = Math.max(state.bestRun, finalScore);
  saveBestRun(state.bestRun);
  state.totalScore = finalScore;
  state.comboScore = 0;
  state.active = false;
  state.grace = 0;
  state.multiplier = 1;
  state.driftTime = 0;
  return finalScore;
}

export function updateDriftScore(state: DriftState, car: CarState, dt: number, onTrack: boolean, zoneIndex: number) {
  const speedMph = car.speed * mph;
  const angle = car.slipAngle;
  const rearSlip = Math.abs(car.rearSlipAngle);
  const slipQuality = Math.min(Math.max(angle - 4, 0), Math.max(rearSlip - 6, 0) * 1.25);
  const isScoring = onTrack && speedMph > 18 && angle > 7.5 && rearSlip > 8 && car.driftAmount > 0.24;

  state.calloutTimer = Math.max(0, state.calloutTimer - dt);
  state.onTrack = onTrack;
  state.currentZone = zoneIndex;
  state.bestRun = Math.max(state.bestRun, state.totalScore + state.comboScore);

  if (isScoring) {
    if (!state.active) {
      state.callout = "Drift started";
      state.calloutTimer = 1.1;
    }

    state.active = true;
    state.grace = 1.15;
    state.driftTime += dt;
    state.totalDriftTime += dt;
    state.multiplier = Math.min(5, 1 + state.driftTime * 0.12);
    state.grade = gradeFor(state.comboScore, angle, state.driftTime);

    if (zoneIndex >= 0 && !state.zonesHit.includes(zoneIndex)) {
      const zoneBonus = 900 * state.multiplier;
      state.comboScore += zoneBonus;
      state.zonesHit.push(zoneIndex);
      if (state.zonesHit.length > 6) state.zonesHit.shift();
      state.callout = `Corner clip +${Math.round(zoneBonus)}`;
      state.calloutTimer = 1.1;
    }

    const angleScore = Math.min(slipQuality, 58);
    const speedScore = Math.min(speedMph, 95);
    const throttleBonus = 0.86 + car.throttleAxis * 0.28;
    const rate = speedScore * angleScore * 0.38 * throttleBonus * state.multiplier;
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
