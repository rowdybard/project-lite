import { driftTiers } from "../simulation/drift";
import type { CarState, DriftState, InputState } from "../types";
import {
  serializeReplay,
  type InputFrame,
  type ReplayCheckpoint,
  type ReplayData,
  type ReplayOverrides,
} from "./replay";
import { normalizeTrackSeed } from "./trackGenerator";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const roundScoreTarget = (value: number) => Math.round(value / 500) * 500;

export const ENDLESS_INITIAL_CLOCK_SECONDS = 30;
export const ENDLESS_GATE_REWARD_SECONDS = 12;
export const ENDLESS_CRASH_SEVERITY = 0.58;
export const ENDLESS_CLOCK_WARNING_SECONDS = 10;
export const ENDLESS_REPLAY_CHECKPOINT_SECONDS = 2;

export type EndlessFailReason = "crash" | "clock" | null;
export type EndlessRiskLevel = "safe" | "building" | "high" | "critical";
export type EndlessObjectiveKind =
  | "chain-duration"
  | "reach-tier"
  | "flow-hold"
  | "traction-hold"
  | "combo-score"
  | "speed-drift"
  | "clean-distance"
  | "transitions";
export type EndlessObjectiveUnit = "seconds" | "tier" | "score" | "meters" | "transitions";

export type EndlessObjective = {
  readonly id: string;
  readonly stage: number;
  readonly kind: EndlessObjectiveKind;
  readonly label: string;
  readonly description: string;
  readonly target: number;
  readonly unit: EndlessObjectiveUnit;
  /** Optional quality/speed threshold for hold objectives. */
  readonly threshold: number | null;
  value: number;
  progress: number;
  completed: boolean;
};

export type EndlessObjectiveResult = {
  readonly objective: EndlessObjective;
  readonly completed: boolean;
  readonly reason: "completed" | "checkpoint-reached";
};

export type EndlessRunEvent =
  | { readonly type: "gate"; readonly gatesPassed: number; readonly clockAdded: number; readonly stage: number }
  | { readonly type: "stage"; readonly stage: number; readonly majorMilestone: boolean }
  | { readonly type: "objective-complete"; readonly objective: EndlessObjective; readonly completedCount: number }
  | { readonly type: "objective-missed"; readonly objective: EndlessObjective }
  | { readonly type: "run-ended"; readonly reason: Exclude<EndlessFailReason, null> };

export type EndlessRunState = {
  clock: number;
  /** Banked drift score plus the currently live combo. */
  totalScore: number;
  bankedScore: number;
  liveScore: number;
  bestCombo: number;
  distance: number;
  nextGateDistance: number;
  gatesPassed: number;
  stage: number;
  alive: boolean;
  failReason: EndlessFailReason;
  readonly seed: number;
  readonly inputs: InputFrame[];
  readonly checkpoints: ReplayCheckpoint[];
  readonly startedAt: number;
  duration: number;
  carId: string;
  tuningPreset: string;
  objective: EndlessObjective;
  objectivesCompleted: number;
  lastObjective: EndlessObjectiveResult | null;
  potentialBonus: number;
  riskLevel: EndlessRiskLevel;
};

export type EndlessStateOptions = {
  initialClock?: number;
  gateReward?: number;
  carId?: string;
  tuningPreset?: string;
  startedAt?: number;
};

export type EndlessTelemetry = {
  car: Pick<CarState, "speed" | "driftDirection">;
  drift: Pick<
    DriftState,
    | "totalScore"
    | "comboScore"
    | "bestCombo"
    | "active"
    | "driftTime"
    | "tier"
    | "flow"
    | "tractionQuality"
    | "scoreRate"
    | "multiplier"
  >;
  trackProgress?: number;
  nextGateDistance?: number;
  onTrack?: boolean;
};

export type CheckpointCarState = Pick<CarState, "position" | "heading" | "speed">;

export type EndlessStateManager = {
  readonly state: EndlessRunState;
  recordInput(input: InputState, dt: number, car?: CheckpointCarState): void;
  recordStep(input: InputState, car: CheckpointCarState, dt: number): void;
  captureCheckpoint(car: CheckpointCarState, force?: boolean): boolean;
  syncTelemetry(telemetry: EndlessTelemetry, dt?: number): void;
  onGatePassed(gateDistance?: number): boolean;
  onCrash(severity: number): boolean;
  update(dt: number): void;
  finish(overrides?: ReplayOverrides): ReplayData;
  consumeEvents(): EndlessRunEvent[];
};

function objectiveHash(seed: number, stage: number) {
  let value = (seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function tierLabel(index: number) {
  return driftTiers[clamp(Math.round(index), 0, driftTiers.length - 1)].name;
}

function createObjective(
  seed: number,
  stage: number,
  previousKind: EndlessObjectiveKind | null,
): EndlessObjective {
  let kind: EndlessObjectiveKind;
  if (stage === 1) {
    kind = "chain-duration";
  } else {
    const kinds: EndlessObjectiveKind[] = [
      "chain-duration",
      "reach-tier",
      "flow-hold",
      "traction-hold",
      "combo-score",
      "speed-drift",
      "clean-distance",
      "transitions",
    ];
    let index = objectiveHash(seed, stage) % kinds.length;
    if (kinds[index] === previousKind) index = (index + 1) % kinds.length;
    kind = kinds[index];
  }

  const id = `${seed.toString(16).padStart(8, "0")}:${stage}:${kind}`;
  if (kind === "chain-duration") {
    const target = stage === 1 ? 3 : clamp(3.4 + stage * 0.42, 4, 9);
    return {
      id,
      stage,
      kind,
      label: `Hold a ${target.toFixed(1)}s drift chain`,
      description: "Keep the drift alive without a spin, wall hit, or runoff.",
      target,
      unit: "seconds",
      threshold: null,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "reach-tier") {
    const target = clamp(1 + Math.floor(stage / 2), 2, Math.min(6, driftTiers.length - 1));
    return {
      id,
      stage,
      kind,
      label: `Reach ${tierLabel(target)} tier`,
      description: "Build flow and hold the line long enough to raise your drift tier.",
      target,
      unit: "tier",
      threshold: null,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "flow-hold") {
    const target = clamp(1.5 + stage * 0.18, 2, 4.5);
    const threshold = clamp(0.36 + stage * 0.018, 0.4, 0.68);
    return {
      id,
      stage,
      kind,
      label: `Hold ${Math.round(threshold * 100)}% flow for ${target.toFixed(1)}s`,
      description: "Carry speed, angle, and a controlled transition rhythm.",
      target,
      unit: "seconds",
      threshold,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "traction-hold") {
    const target = clamp(1.8 + stage * 0.16, 2.2, 4.5);
    const threshold = clamp(0.46 + stage * 0.014, 0.5, 0.7);
    return {
      id,
      stage,
      kind,
      label: `Hold clean grip for ${target.toFixed(1)}s`,
      description: `Keep traction quality above ${Math.round(threshold * 100)}% while drifting.`,
      target,
      unit: "seconds",
      threshold,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "combo-score") {
    const target = roundScoreTarget(clamp(7_000 + stage * 3_250, 10_000, 48_000));
    return {
      id,
      stage,
      kind,
      label: `Build a ${target.toLocaleString()} live combo`,
      description: "Keep points at risk in one connected chain.",
      target,
      unit: "score",
      threshold: null,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "speed-drift") {
    const target = clamp(2 + stage * 0.18, 2.5, 5);
    const threshold = clamp(18 + stage * 0.9, 20, 32);
    return {
      id,
      stage,
      kind,
      label: `Drift above ${Math.round(threshold * 2.237)} mph`,
      description: `Carry that speed for ${target.toFixed(1)} seconds without leaving the road.`,
      target,
      unit: "seconds",
      threshold,
      value: 0,
      progress: 0,
      completed: false,
    };
  }
  if (kind === "clean-distance") {
    const target = Math.round(clamp(105 + stage * 16, 130, 270));
    return {
      id,
      stage,
      kind,
      label: `Stay clean for ${target}m`,
      description: "Keep all four tires on the scoring surface; runoff resets progress.",
      target,
      unit: "meters",
      threshold: null,
      value: 0,
      progress: 0,
      completed: false,
    };
  }

  const target = clamp(1 + Math.floor(stage / 5), 1, 3);
  return {
    id,
    stage,
    kind: "transitions",
    label: `Land ${target} clean transition${target === 1 ? "" : "s"}`,
    description: "Link opposite drift directions while flow is established.",
    target,
    unit: "transitions",
    threshold: null,
    value: 0,
    progress: 0,
    completed: false,
  };
}

function cloneObjective(objective: EndlessObjective): EndlessObjective {
  return { ...objective };
}

function monotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function createEndlessState(
  seed: number,
  initialClockOrOptions: number | EndlessStateOptions = ENDLESS_INITIAL_CLOCK_SECONDS,
): EndlessStateManager {
  const options: EndlessStateOptions =
    typeof initialClockOrOptions === "number"
      ? { initialClock: initialClockOrOptions }
      : initialClockOrOptions;
  const initialClock = Math.max(0, options.initialClock ?? ENDLESS_INITIAL_CLOCK_SECONDS);
  const gateReward = Math.max(0, options.gateReward ?? ENDLESS_GATE_REWARD_SECONDS);
  const normalizedSeed = normalizeTrackSeed(seed);
  const events: EndlessRunEvent[] = [];
  let recordingTime = 0;
  let nextCheckpointTime = ENDLESS_REPLAY_CHECKPOINT_SECONDS;
  let objectiveAccumulator = 0;
  let lastTrackProgress = 0;
  let lastDriftDirection = 0;
  let transitionCooldown = 0;

  const state: EndlessRunState = {
    clock: initialClock,
    totalScore: 0,
    bankedScore: 0,
    liveScore: 0,
    bestCombo: 0,
    distance: 0,
    nextGateDistance: Infinity,
    gatesPassed: 0,
    stage: 1,
    alive: initialClock > 0,
    failReason: initialClock > 0 ? null : "clock",
    seed: normalizedSeed,
    inputs: [],
    checkpoints: [],
    startedAt: options.startedAt ?? monotonicNow(),
    duration: 0,
    carId: options.carId ?? "unknown",
    tuningPreset: options.tuningPreset ?? "balanced",
    objective: createObjective(normalizedSeed, 1, null),
    objectivesCompleted: 0,
    lastObjective: null,
    potentialBonus: 0,
    riskLevel: initialClock <= ENDLESS_CLOCK_WARNING_SECONDS ? "critical" : "safe",
  };

  if (!state.alive) events.push({ type: "run-ended", reason: "clock" });

  const completeObjective = () => {
    if (state.objective.completed) return;
    state.objective.value = Math.max(state.objective.value, state.objective.target);
    state.objective.progress = 1;
    state.objective.completed = true;
    state.objectivesCompleted += 1;
    const snapshot = cloneObjective(state.objective);
    state.lastObjective = { objective: snapshot, completed: true, reason: "completed" };
    events.push({ type: "objective-complete", objective: snapshot, completedCount: state.objectivesCompleted });
  };

  const setObjectiveValue = (value: number) => {
    if (state.objective.completed) return;
    state.objective.value = Math.max(0, value);
    state.objective.progress = clamp(state.objective.value / Math.max(state.objective.target, 1e-6), 0, 1);
    if (state.objective.progress >= 1) completeObjective();
  };

  const finishRun = (reason: Exclude<EndlessFailReason, null>) => {
    if (!state.alive) return false;
    state.alive = false;
    state.failReason = reason;
    state.clock = Math.max(0, state.clock);
    events.push({ type: "run-ended", reason });
    return true;
  };

  const captureCheckpoint = (car: CheckpointCarState, force = false) => {
    if (!force && recordingTime + 1e-6 < nextCheckpointTime) return false;
    const checkpoint: ReplayCheckpoint = {
      t: recordingTime,
      x: car.position.x,
      z: car.position.z,
      heading: car.heading,
      speed: car.speed,
    };
    const previous = state.checkpoints.at(-1);
    if (previous && Math.abs(previous.t - checkpoint.t) < 1e-6) {
      Object.assign(previous, checkpoint);
    } else {
      state.checkpoints.push(checkpoint);
    }
    while (nextCheckpointTime <= recordingTime + 1e-6) {
      nextCheckpointTime += ENDLESS_REPLAY_CHECKPOINT_SECONDS;
    }
    return true;
  };

  const recordInput = (input: InputState, dt: number, car?: CheckpointCarState) => {
    if (!state.alive) return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (state.inputs.length === 0 && car) {
      state.checkpoints.push({
        t: 0,
        x: car.position.x,
        z: car.position.z,
        heading: car.heading,
        speed: car.speed,
      });
    }
    state.inputs.push({
      t: recordingTime,
      throttle: clamp(input.throttle, 0, 1),
      brake: clamp(input.brake, 0, 1),
      steer: clamp(input.steer, -1, 1),
      handbrake: input.handbrake,
    });
    recordingTime += step;
    if (car) captureCheckpoint(car);
  };

  const syncTelemetry = (telemetry: EndlessTelemetry, dt = 0) => {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const onTrack = telemetry.onTrack ?? true;
    const trackProgress = Math.max(0, telemetry.trackProgress ?? state.distance);
    const progressDelta = Math.max(0, trackProgress - lastTrackProgress);
    lastTrackProgress = trackProgress;
    state.distance = Math.max(state.distance, trackProgress);
    state.nextGateDistance = Math.max(0, telemetry.nextGateDistance ?? state.nextGateDistance);
    state.bankedScore = Math.max(0, telemetry.drift.totalScore);
    state.liveScore = Math.max(0, telemetry.drift.comboScore);
    state.totalScore = state.bankedScore + state.liveScore;
    state.bestCombo = Math.max(state.bestCombo, telemetry.drift.bestCombo, state.liveScore);

    const estimatedGateSeconds = Number.isFinite(state.nextGateDistance)
      ? clamp(state.nextGateDistance / Math.max(telemetry.car.speed, 8), 0, 12)
      : 0;
    const projectedGain = Math.max(0, telemetry.drift.scoreRate) * estimatedGateSeconds;
    // This is presentation-only and never claims more than the score currently at risk.
    state.potentialBonus = Math.round(Math.min(state.liveScore, projectedGain));

    const scoreAtRiskRatio = state.liveScore / Math.max(1, state.totalScore);
    if (state.clock <= ENDLESS_CLOCK_WARNING_SECONDS) {
      state.riskLevel = "critical";
    } else if (
      state.liveScore >= 28_000 || telemetry.drift.tier >= 5 ||
      (scoreAtRiskRatio > 0.7 && state.liveScore >= 9_000)
    ) {
      state.riskLevel = "critical";
    } else if (
      state.liveScore >= 10_000 || telemetry.drift.tier >= 3 ||
      (scoreAtRiskRatio > 0.42 && state.liveScore >= 4_000)
    ) {
      state.riskLevel = "high";
    } else if (telemetry.drift.active || state.liveScore > 0) {
      state.riskLevel = "building";
    } else {
      state.riskLevel = "safe";
    }

    if (!state.alive) return;
    if (state.objective.completed) return;
    transitionCooldown = Math.max(0, transitionCooldown - safeDt);
    const objective = state.objective;
    if (objective.kind === "chain-duration") {
      objectiveAccumulator = Math.max(objectiveAccumulator, telemetry.drift.driftTime);
    } else if (objective.kind === "reach-tier") {
      objectiveAccumulator = Math.max(objectiveAccumulator, telemetry.drift.tier);
    } else if (objective.kind === "flow-hold") {
      const meetsTarget =
        telemetry.drift.active && onTrack && telemetry.drift.flow >= (objective.threshold ?? 0);
      objectiveAccumulator = meetsTarget
        ? objectiveAccumulator + safeDt
        : Math.max(0, objectiveAccumulator - safeDt * 0.6);
    } else if (objective.kind === "traction-hold") {
      const meetsTarget =
        telemetry.drift.active && onTrack && telemetry.drift.tractionQuality >= (objective.threshold ?? 0);
      objectiveAccumulator = meetsTarget
        ? objectiveAccumulator + safeDt
        : Math.max(0, objectiveAccumulator - safeDt * 0.6);
    } else if (objective.kind === "combo-score") {
      objectiveAccumulator = Math.max(objectiveAccumulator, telemetry.drift.comboScore);
    } else if (objective.kind === "speed-drift") {
      const meetsTarget =
        telemetry.drift.active && onTrack && telemetry.car.speed >= (objective.threshold ?? Infinity);
      objectiveAccumulator = meetsTarget
        ? objectiveAccumulator + safeDt
        : Math.max(0, objectiveAccumulator - safeDt * 0.45);
    } else if (objective.kind === "clean-distance") {
      objectiveAccumulator = onTrack ? objectiveAccumulator + progressDelta : 0;
    } else {
      const direction = telemetry.car.driftDirection;
      if (
        telemetry.drift.active && onTrack && telemetry.drift.flow > 0.34 &&
        direction !== 0 && lastDriftDirection !== 0 && direction !== lastDriftDirection &&
        transitionCooldown <= 0
      ) {
        objectiveAccumulator += 1;
        transitionCooldown = 0.8;
      }
      if (telemetry.drift.active && direction !== 0) lastDriftDirection = direction;
      if (!telemetry.drift.active) lastDriftDirection = 0;
    }
    setObjectiveValue(objectiveAccumulator);
  };

  const onGatePassed = (gateDistance?: number) => {
    if (!state.alive) return false;
    if (Number.isFinite(gateDistance)) state.distance = Math.max(state.distance, gateDistance ?? 0);
    state.clock += gateReward;
    state.gatesPassed += 1;
    if (!state.objective.completed) {
      const snapshot = cloneObjective(state.objective);
      state.lastObjective = { objective: snapshot, completed: false, reason: "checkpoint-reached" };
      events.push({ type: "objective-missed", objective: snapshot });
    }
    const previousKind = state.objective.kind;
    state.stage = state.gatesPassed + 1;
    state.objective = createObjective(normalizedSeed, state.stage, previousKind);
    objectiveAccumulator = 0;
    lastDriftDirection = 0;
    transitionCooldown = 0;
    events.push({ type: "gate", gatesPassed: state.gatesPassed, clockAdded: gateReward, stage: state.stage });
    events.push({ type: "stage", stage: state.stage, majorMilestone: state.stage % 3 === 0 });
    return true;
  };

  const update = (dt: number) => {
    if (!state.alive) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    state.duration += elapsed;
    state.clock = Math.max(0, state.clock - elapsed);
    if (state.clock <= ENDLESS_CLOCK_WARNING_SECONDS) state.riskLevel = "critical";
    if (state.clock <= 0) finishRun("clock");
  };

  return {
    state,
    recordInput,
    recordStep: (input, car, dt) => recordInput(input, dt, car),
    captureCheckpoint,
    syncTelemetry,
    onGatePassed,
    onCrash: (severity) => Number.isFinite(severity) && severity >= ENDLESS_CRASH_SEVERITY
      ? finishRun("crash")
      : false,
    update,
    finish: (overrides) => serializeReplay(state, overrides),
    consumeEvents: () => events.splice(0, events.length),
  };
}

export type { InputFrame, ReplayCheckpoint, ReplayData } from "./replay";
