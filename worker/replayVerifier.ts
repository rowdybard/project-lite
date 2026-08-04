import hatchbackTuningJson from "../public/assets/cars/imports/hatchback-tuning.json";
import muscleTuningJson from "../public/assets/cars/imports/muscle-tuning.json";
import muscle2TuningJson from "../public/assets/cars/imports/muscle2-tuning.json";
import pickupTuningJson from "../public/assets/cars/imports/pickup-tuning.json";
import sedanTuningJson from "../public/assets/cars/imports/sedan-tuning.json";
import suvTuningJson from "../public/assets/cars/imports/suv-tuning.json";
import starterTuningJson from "../public/assets/cars/starter/tuning.json";

import { createEndlessTrack } from "../src/game/endless/endlessTrack";
import {
  ENDLESS_CRASH_SEVERITY,
  ENDLESS_GATE_REWARD_SECONDS,
  ENDLESS_INITIAL_CLOCK_SECONDS,
} from "../src/game/endless/endlessState";
import { PHYSICS_VERSION, REPLAY_FIXED_STEP_SECONDS } from "../src/game/endless/physicsVersion";
import {
  createReplayInputSampler,
  deserializeReplay,
  type ReplayCheckpoint,
  type ReplayData,
} from "../src/game/endless/replay";
import { createCarState, updateCar } from "../src/game/simulation/car";
import { createDriftState, finishDriftRun, updateDriftScore } from "../src/game/simulation/drift";
import { applyStandardDriftTransmission } from "../src/game/simulation/driftTransmission";
import { updateTrackCollision } from "../src/game/simulation/trackCollision";
import { applyVehicleGeometryTuning } from "../src/game/simulation/vehicleGeometry";
import type { CarTuning, InputState, TrackConfig } from "../src/game/types";

const scoreToleranceRatio = 0.01;
const checkpointPositionToleranceMeters = 2;
const distanceToleranceRatio = 0.01;
const minimumDistanceToleranceMeters = 2;
const maximumReplaySeconds = 600;
const maximumReplaySteps = Math.ceil(maximumReplaySeconds / REPLAY_FIXED_STEP_SECONDS) + 2;

const replayTrackConfig: TrackConfig = {
  id: "endless",
  name: "Endless",
  start: { x: 0, z: 0, heading: 0 },
  checkpoints: [],
  roadWidth: 22,
  boundaryMargin: 0,
};

const baseTunings: Readonly<Record<string, CarTuning>> = {
  "starter-coupe": starterTuningJson as CarTuning,
  "pack-suv": suvTuningJson as CarTuning,
  "pack-pickup": pickupTuningJson as CarTuning,
  "pack-hatchback": hatchbackTuningJson as CarTuning,
  "pack-sedan": sedanTuningJson as CarTuning,
  "pack-muscle": muscleTuningJson as CarTuning,
  "pack-muscle-2": muscle2TuningJson as CarTuning,
};

const supportedTuningPresets = new Set(["grip", "balanced", "drift"]);

export type ReplayVerificationCode =
  | "physics-version"
  | "unsupported-car"
  | "unsupported-tuning"
  | "invalid-duration"
  | "invalid-replay"
  | "simulation-error"
  | "continued-after-failure"
  | "run-did-not-finish"
  | "checkpoint-desync"
  | "score-mismatch"
  | "gate-mismatch"
  | "distance-mismatch";

export type ReplayVerificationMetrics = {
  simulatedScore: number;
  claimedScore: number;
  scoreDeltaRatio: number;
  simulatedDistance: number;
  claimedDistance: number;
  simulatedGatesPassed: number;
  claimedGatesPassed: number;
  simulatedDuration: number;
  claimedDuration: number;
  maximumCheckpointPositionError: number;
  maximumCheckpointHeadingError: number;
  maximumCheckpointSpeedError: number;
  checkedCheckpoints: number;
  failReason: "crash" | "clock" | null;
};

export type ReplayVerificationResult =
  | { ok: true; metrics: ReplayVerificationMetrics }
  | {
      ok: false;
      code: ReplayVerificationCode;
      reason: string;
      metrics?: ReplayVerificationMetrics;
    };

function fail(
  code: ReplayVerificationCode,
  reason: string,
  metrics?: ReplayVerificationMetrics,
): ReplayVerificationResult {
  return { ok: false, code, reason, ...(metrics ? { metrics } : {}) };
}

function applyReplayTuningPreset(base: CarTuning, preset: string): CarTuning {
  const tuning: CarTuning = { ...base, gearRatios: [...base.gearRatios] };

  if (preset === "grip") {
    tuning.frontGrip *= 1.18;
    tuning.rearGrip *= 1.22;
    tuning.handbrakeRearGrip *= 1.12;
    tuning.frontCorneringStiffness *= 1.1;
    tuning.rearCorneringStiffness *= 1.12;
    tuning.throttleGripLoss *= 0.62;
    tuning.counterSteerAssist *= 1.18;
    tuning.slideDrag *= 1.16;
    tuning.driftDrag *= 1.08;
    tuning.yawDamping *= 1.22;
    tuning.yawInertia *= 1.08;
  } else if (preset === "drift") {
    tuning.maxSteerAngle *= 1.03;
    tuning.steeringAtSpeed *= 1.04;
    tuning.rearGrip *= 0.88;
    tuning.handbrakeRearGrip *= 0.82;
    tuning.throttleGripLoss *= 1.18;
    tuning.counterSteerAssist *= 0.94;
    tuning.slideDrag *= 1.02;
    tuning.yawDamping *= 0.9;
  } else if (preset === "balanced") {
    tuning.frontGrip *= 1.06;
    tuning.rearGrip *= 1.04;
    tuning.counterSteerAssist *= 1.08;
    tuning.slideDrag *= 1.06;
    tuning.yawDamping *= 1.1;
    tuning.yawInertia *= 1.05;
  }

  return tuning;
}

function resolveReplayTuning(carId: string, preset: string): CarTuning | null {
  const base = baseTunings[carId];
  if (!base || !supportedTuningPresets.has(preset)) return null;
  const geometryTuning = applyVehicleGeometryTuning(base);
  const transmissionTuning = applyStandardDriftTransmission(geometryTuning);
  return applyReplayTuningPreset(transmissionTuning, preset);
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

type CheckpointErrorSummary = {
  maximumPosition: number;
  maximumHeading: number;
  maximumSpeed: number;
  checked: number;
};

function compareCheckpoint(
  checkpoint: ReplayCheckpoint,
  car: ReturnType<typeof createCarState>,
  summary: CheckpointErrorSummary,
) {
  summary.maximumPosition = Math.max(
    summary.maximumPosition,
    Math.hypot(car.position.x - checkpoint.x, car.position.z - checkpoint.z),
  );
  summary.maximumHeading = Math.max(
    summary.maximumHeading,
    Math.abs(wrapAngle(car.heading - checkpoint.heading)),
  );
  summary.maximumSpeed = Math.max(summary.maximumSpeed, Math.abs(car.speed - checkpoint.speed));
  summary.checked += 1;
}

/**
 * Replays a claimed run through the production deterministic simulation.
 *
 * This function deliberately never applies the sparse checkpoint corrections used
 * by the theater. Checkpoints are evidence here, not trusted simulation inputs.
 */
export function verifyReplayDetailed(replay: ReplayData): ReplayVerificationResult {
  if (replay.version !== PHYSICS_VERSION) {
    return fail(
      "physics-version",
      `Replay physics ${replay.version.toString(16)} does not match server physics ${PHYSICS_VERSION.toString(16)}.`,
    );
  }
  if (!baseTunings[replay.carId]) {
    return fail("unsupported-car", `Car '${replay.carId}' is not supported by the replay verifier.`);
  }
  if (!supportedTuningPresets.has(replay.tuningPreset)) {
    return fail("unsupported-tuning", `Tuning preset '${replay.tuningPreset}' is not supported by the replay verifier.`);
  }

  const exactStepCount = replay.duration / REPLAY_FIXED_STEP_SECONDS;
  const stepCount = Math.round(exactStepCount);
  const simulatedDuration = stepCount * REPLAY_FIXED_STEP_SECONDS;
  if (
    !Number.isFinite(replay.duration) || replay.duration <= 0 || replay.duration > maximumReplaySeconds ||
    stepCount <= 0 || stepCount > maximumReplaySteps ||
    Math.abs(simulatedDuration - replay.duration) > 0.00011
  ) {
    return fail("invalid-duration", "Replay duration is not aligned to the 120 Hz deterministic simulation.");
  }

  let replayFrames: ReturnType<typeof deserializeReplay>;
  try {
    replayFrames = deserializeReplay(replay);
  } catch {
    return fail("invalid-replay", "Replay data could not be decoded by the deterministic input sampler.");
  }
  const tuning = resolveReplayTuning(replay.carId, replay.tuningPreset);
  if (!tuning) return fail("unsupported-tuning", "Replay tuning could not be resolved.");

  const input: InputState = {
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
  const sampler = createReplayInputSampler(replayFrames.inputs);
  const car = createCarState(replayTrackConfig);
  const drift = createDriftState();
  const track = createEndlessTrack(replay.seed);
  const checkpointErrors: CheckpointErrorSummary = {
    maximumPosition: 0,
    maximumHeading: 0,
    maximumSpeed: 0,
    checked: 0,
  };
  const initialCheckpoints: ReplayCheckpoint[] = [];
  const finalCheckpoints: ReplayCheckpoint[] = [];
  const prePhysicsCheckpointsByStep = new Map<number, ReplayCheckpoint[]>();
  for (const checkpoint of replayFrames.checkpoints) {
    if (checkpoint.t <= 0.00011) {
      initialCheckpoints.push(checkpoint);
      continue;
    }
    if (Math.abs(checkpoint.t - replay.duration) <= 0.00011) {
      finalCheckpoints.push(checkpoint);
      continue;
    }
    // The recorder advances its timestamp and captures the car immediately
    // before the corresponding physics step. For example, the regular 2.0 s
    // checkpoint is the car state at the beginning of step 240.
    const prePhysicsStep = Math.max(0, Math.round(checkpoint.t / REPLAY_FIXED_STEP_SECONDS) - 1);
    const list = prePhysicsCheckpointsByStep.get(prePhysicsStep);
    if (list) list.push(checkpoint);
    else prePhysicsCheckpointsByStep.set(prePhysicsStep, [checkpoint]);
  }

  let clock = ENDLESS_INITIAL_CLOCK_SECONDS;
  let gatesPassed = 0;
  let completedSteps = 0;
  let runoffTime = 0;
  let failReason: "crash" | "clock" | null = null;
  let failureStep = -1;

  const comparePrePhysicsCheckpointsAtStep = (step: number) => {
    const checkpoints = prePhysicsCheckpointsByStep.get(step);
    if (!checkpoints) return;
    for (const checkpoint of checkpoints) compareCheckpoint(checkpoint, car, checkpointErrors);
  };

  try {
    for (const checkpoint of initialCheckpoints) compareCheckpoint(checkpoint, car, checkpointErrors);
    for (let step = 0; step < stepCount; step += 1) {
      const elapsed = step * REPLAY_FIXED_STEP_SECONDS;
      const sampled = sampler.sample(elapsed);
      input.throttle = sampled.throttle;
      input.brake = sampled.brake;
      input.steer = sampled.steer;
      input.handbrake = sampled.handbrake;

      // This ordering mirrors the live endless fixed-step callback. The track
      // observes the movement produced by the previous step, so gate rewards
      // and streamed barriers are settled before recording/simulating this one.
      const trackUpdate = track.update(car.position);
      gatesPassed += trackUpdate.passedGates.length;
      clock += trackUpdate.passedGates.length * ENDLESS_GATE_REWARD_SECONDS;
      comparePrePhysicsCheckpointsAtStep(step);
      updateCar(
        car,
        input,
        tuning,
        REPLAY_FIXED_STEP_SECONDS,
        track.isOnTrack(car.position),
        "polished",
      );
      const stepOnTrack = track.isOnTrack(car.position);
      const stepInRunoff = track.isInRunoff(car.position);
      if (stepOnTrack) runoffTime = 0;
      else if (stepInRunoff) runoffTime += REPLAY_FIXED_STEP_SECONDS;
      else runoffTime = 999;
      const scoringSurface = stepOnTrack || (stepInRunoff && runoffTime <= 1.15);
      const impact = updateTrackCollision(
        car,
        track.getColliders(),
        REPLAY_FIXED_STEP_SECONDS,
        tuning,
      );
      updateDriftScore(
        drift,
        car,
        REPLAY_FIXED_STEP_SECONDS,
        scoringSurface,
        Math.floor(track.getProgress(car.position) / 80),
        impact,
      );

      completedSteps = step + 1;
      clock = Math.max(0, clock - REPLAY_FIXED_STEP_SECONDS);
      // The live state drains the clock before checking impact, so simultaneous
      // expiry/contact is recorded as a clock failure.
      if (clock <= 0 || impact >= ENDLESS_CRASH_SEVERITY) {
        failReason = clock <= 0 ? "clock" : "crash";
        failureStep = completedSteps;
        break;
      }
    }
    for (const checkpoint of finalCheckpoints) compareCheckpoint(checkpoint, car, checkpointErrors);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("simulation-error", `Replay simulation failed: ${message}`);
  }

  const simulatedScore = finishDriftRun(drift);
  const claimedScore = replay.finalScore;
  const scoreDeltaRatio = Math.abs(simulatedScore - claimedScore) / Math.max(1, Math.abs(claimedScore));
  const metrics: ReplayVerificationMetrics = {
    simulatedScore,
    claimedScore,
    scoreDeltaRatio,
    simulatedDistance: track.state.progressDistance,
    claimedDistance: replay.distance,
    simulatedGatesPassed: gatesPassed,
    claimedGatesPassed: replay.gatesPassed,
    simulatedDuration: completedSteps * REPLAY_FIXED_STEP_SECONDS,
    claimedDuration: replay.duration,
    maximumCheckpointPositionError: checkpointErrors.maximumPosition,
    maximumCheckpointHeadingError: checkpointErrors.maximumHeading,
    maximumCheckpointSpeedError: checkpointErrors.maximumSpeed,
    checkedCheckpoints: checkpointErrors.checked,
    failReason,
  };

  if (failureStep >= 0 && failureStep !== stepCount) {
    return fail("continued-after-failure", "Replay continues after its deterministic crash or clock expiry.", metrics);
  }
  if (!failReason) {
    return fail("run-did-not-finish", "Replay ends before a deterministic crash or clock expiry.", metrics);
  }
  if (checkpointErrors.maximumPosition > checkpointPositionToleranceMeters) {
    return fail(
      "checkpoint-desync",
      `Replay path differs from its checkpoints by up to ${checkpointErrors.maximumPosition.toFixed(2)} m.`,
      metrics,
    );
  }
  if (scoreDeltaRatio > scoreToleranceRatio) {
    return fail(
      "score-mismatch",
      `Claimed score differs from the deterministic result by ${(scoreDeltaRatio * 100).toFixed(2)}%.`,
      metrics,
    );
  }
  if (gatesPassed !== replay.gatesPassed) {
    return fail(
      "gate-mismatch",
      `Replay passed ${gatesPassed} gates, but claims ${replay.gatesPassed}.`,
      metrics,
    );
  }
  const distanceTolerance = Math.max(
    minimumDistanceToleranceMeters,
    Math.abs(replay.distance) * distanceToleranceRatio,
  );
  if (Math.abs(track.state.progressDistance - replay.distance) > distanceTolerance) {
    return fail(
      "distance-mismatch",
      `Claimed distance differs from the deterministic result by more than ${distanceTolerance.toFixed(2)} m.`,
      metrics,
    );
  }

  return { ok: true, metrics };
}

export type LeaderboardReplayVerification = {
  verified: boolean;
  simulatedScore: number;
  reason: string;
};

/** Compact result used by the leaderboard's pending-verification queue. */
export function verifyReplay(replay: ReplayData): LeaderboardReplayVerification {
  const result = verifyReplayDetailed(replay);
  if (result.ok) {
    return {
      verified: true,
      simulatedScore: result.metrics.simulatedScore,
      reason: "Replay matches the deterministic simulation.",
    };
  }
  return {
    verified: false,
    simulatedScore: result.metrics?.simulatedScore ?? 0,
    reason: `${result.code}: ${result.reason}`,
  };
}
