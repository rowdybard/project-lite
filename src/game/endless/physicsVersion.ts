import { drivetrainTuning } from "../simulation/car";
import { driftScoreConfig } from "../simulation/drift";
import { stabilityTuning } from "../simulation/handlingStability";

export const REPLAY_FIXED_STEP_SECONDS = 1 / 120;

// Bump this when deterministic equations change without a corresponding tuning
// constant change. The tuning objects below take care of ordinary balance edits.
export const PHYSICS_IMPLEMENTATION_REVISION = 1;

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return "null";
}

/** Stable unsigned FNV-1a hash used as the compact replay compatibility stamp. */
export function hashPhysicsConstants(value: unknown): number {
  const source = canonicalize(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const PHYSICS_VERSION_SOURCE = canonicalize({
  implementationRevision: PHYSICS_IMPLEMENTATION_REVISION,
  fixedStepSeconds: REPLAY_FIXED_STEP_SECONDS,
  driftScoreConfig,
  drivetrainTuning,
  stabilityTuning,
});

export const PHYSICS_VERSION = hashPhysicsConstants({
  implementationRevision: PHYSICS_IMPLEMENTATION_REVISION,
  fixedStepSeconds: REPLAY_FIXED_STEP_SECONDS,
  driftScoreConfig,
  drivetrainTuning,
  stabilityTuning,
});

export const PHYSICS_VERSION_HEX = PHYSICS_VERSION.toString(16).padStart(8, "0");
