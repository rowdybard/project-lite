import type { EndlessRunState } from "./endlessState";
import { PHYSICS_VERSION } from "./physicsVersion";

const MAX_REPLAY_DURATION_SECONDS = 600;
const MAX_PACKED_INPUT_VALUES = 360_005;
const MAX_PACKED_CHECKPOINT_VALUES = 2_005;
const INPUT_HEARTBEAT_SECONDS = 0.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const roundTo = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

export const REPLAY_INPUT_STRIDE = 5;
export const REPLAY_CHECKPOINT_STRIDE = 5;

export type InputFrame = {
  /** Seconds from the beginning of the deterministic simulation. */
  t: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
};

export type ReplayCheckpoint = {
  t: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
};

export type ReplayData = {
  /** Physics compatibility hash, not a network schema version. */
  version: number;
  seed: number;
  carId: string;
  tuningPreset: string;
  /** Sparse held-input samples: [t, throttle, brake, steer, handbrake01]. */
  inputs: number[];
  /** Sparse safety points: [t, x, z, heading, speed]. */
  checkpoints: number[];
  duration: number;
  finalScore: number;
  gatesPassed: number;
  distance: number;
};

export type ReplayOverrides = Partial<
  Pick<ReplayData, "carId" | "tuningPreset" | "duration" | "finalScore" | "gatesPassed" | "distance">
>;

function sameControls(a: InputFrame, b: InputFrame) {
  return (
    a.throttle === b.throttle &&
    a.brake === b.brake &&
    a.steer === b.steer &&
    a.handbrake === b.handbrake
  );
}

function quantizeInput(frame: InputFrame): InputFrame {
  return {
    t: roundTo(Math.max(0, frame.t), 4),
    throttle: roundTo(clamp(frame.throttle, 0, 1), 4),
    brake: roundTo(clamp(frame.brake, 0, 1), 4),
    steer: roundTo(clamp(frame.steer, -1, 1), 4),
    handbrake: frame.handbrake,
  };
}

function packInputs(frames: readonly InputFrame[]) {
  const packed: number[] = [];
  let previous: InputFrame | null = null;
  let lastPackedTime = -Infinity;
  for (const source of frames) {
    const frame = quantizeInput(source);
    if (
      previous && sameControls(previous, frame) &&
      frame.t - lastPackedTime < INPUT_HEARTBEAT_SECONDS
    ) {
      continue;
    }
    packed.push(frame.t, frame.throttle, frame.brake, frame.steer, frame.handbrake ? 1 : 0);
    previous = frame;
    lastPackedTime = frame.t;
  }
  return packed;
}

function packCheckpoints(checkpoints: readonly ReplayCheckpoint[]) {
  const packed: number[] = [];
  for (const checkpoint of checkpoints) {
    packed.push(
      roundTo(Math.max(0, checkpoint.t), 4),
      roundTo(checkpoint.x, 3),
      roundTo(checkpoint.z, 3),
      roundTo(checkpoint.heading, 5),
      roundTo(Math.max(0, checkpoint.speed), 3),
    );
  }
  return packed;
}

export function serializeReplay(state: EndlessRunState, overrides: ReplayOverrides = {}): ReplayData {
  const lastInputTime = state.inputs.at(-1)?.t ?? 0;
  const duration = Math.max(0, overrides.duration ?? state.duration, lastInputTime);
  return {
    version: PHYSICS_VERSION,
    seed: state.seed,
    carId: overrides.carId ?? state.carId,
    tuningPreset: overrides.tuningPreset ?? state.tuningPreset,
    inputs: packInputs(state.inputs),
    checkpoints: packCheckpoints(state.checkpoints),
    duration: roundTo(duration, 4),
    finalScore: Math.max(0, overrides.finalScore ?? state.totalScore),
    gatesPassed: Math.max(0, Math.trunc(overrides.gatesPassed ?? state.gatesPassed)),
    distance: Math.max(0, overrides.distance ?? state.distance),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberArray(value: unknown, maximumLength: number): value is number[] {
  return (
    Array.isArray(value) && value.length <= maximumLength &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

export function isReplayData(value: unknown): value is ReplayData {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.version) || !isFiniteNumber(value.version) || value.version < 0 || value.version > 0xffff_ffff) {
    return false;
  }
  if (!Number.isInteger(value.seed) || !isFiniteNumber(value.seed) || value.seed < -0x8000_0000 || value.seed > 0xffff_ffff) {
    return false;
  }
  if (typeof value.carId !== "string" || value.carId.length === 0 || value.carId.length > 96) return false;
  if (
    typeof value.tuningPreset !== "string" || value.tuningPreset.length === 0 ||
    value.tuningPreset.length > 96
  ) {
    return false;
  }
  if (!isFiniteNumberArray(value.inputs, MAX_PACKED_INPUT_VALUES) || value.inputs.length === 0) return false;
  if (value.inputs.length % REPLAY_INPUT_STRIDE !== 0) return false;
  if (!isFiniteNumberArray(value.checkpoints, MAX_PACKED_CHECKPOINT_VALUES)) return false;
  if (value.checkpoints.length % REPLAY_CHECKPOINT_STRIDE !== 0) return false;
  if (
    !isFiniteNumber(value.duration) || value.duration < 0 || value.duration > MAX_REPLAY_DURATION_SECONDS + 0.01 ||
    !isFiniteNumber(value.finalScore) || value.finalScore < 0 ||
    !Number.isInteger(value.gatesPassed) || !isFiniteNumber(value.gatesPassed) || value.gatesPassed < 0 ||
    !isFiniteNumber(value.distance) || value.distance < 0
  ) {
    return false;
  }

  let previousTime = -Infinity;
  for (let index = 0; index < value.inputs.length; index += REPLAY_INPUT_STRIDE) {
    const time = value.inputs[index];
    const throttle = value.inputs[index + 1];
    const brake = value.inputs[index + 2];
    const steer = value.inputs[index + 3];
    const handbrake = value.inputs[index + 4];
    if (
      time < previousTime || time < 0 || time > value.duration + 0.3 ||
      throttle < 0 || throttle > 1 || brake < 0 || brake > 1 || steer < -1 || steer > 1 ||
      (handbrake !== 0 && handbrake !== 1)
    ) {
      return false;
    }
    previousTime = time;
  }

  previousTime = -Infinity;
  for (let index = 0; index < value.checkpoints.length; index += REPLAY_CHECKPOINT_STRIDE) {
    const time = value.checkpoints[index];
    const speed = value.checkpoints[index + 4];
    if (time < previousTime || time < 0 || time > value.duration + 0.3 || speed < 0) return false;
    previousTime = time;
  }
  return true;
}

export function deserializeReplay(data: ReplayData): {
  inputs: InputFrame[];
  checkpoints: ReplayCheckpoint[];
} {
  if (!isReplayData(data)) throw new TypeError("Invalid endless replay data.");
  const inputs: InputFrame[] = [];
  const checkpoints: ReplayCheckpoint[] = [];
  for (let index = 0; index < data.inputs.length; index += REPLAY_INPUT_STRIDE) {
    inputs.push({
      t: data.inputs[index],
      throttle: data.inputs[index + 1],
      brake: data.inputs[index + 2],
      steer: data.inputs[index + 3],
      handbrake: data.inputs[index + 4] === 1,
    });
  }
  for (let index = 0; index < data.checkpoints.length; index += REPLAY_CHECKPOINT_STRIDE) {
    checkpoints.push({
      t: data.checkpoints[index],
      x: data.checkpoints[index + 1],
      z: data.checkpoints[index + 2],
      heading: data.checkpoints[index + 3],
      speed: data.checkpoints[index + 4],
    });
  }
  return { inputs, checkpoints };
}

export function createReplayInputSampler(frames: readonly InputFrame[]) {
  let index = 0;
  const fallback: InputFrame = { t: 0, throttle: 0, brake: 0, steer: 0, handbrake: false };
  return {
    reset() {
      index = 0;
    },
    sample(time: number): InputFrame {
      const target = Math.max(0, time);
      if (frames.length === 0) return fallback;
      if (target < frames[index].t) index = 0;
      while (index + 1 < frames.length && frames[index + 1].t <= target + 1e-6) index += 1;
      return frames[index];
    },
  };
}
