import { DurableObject } from "cloudflare:workers";

import type { ReplayData } from "../src/game/endless/replay";
import {
  dailyDayKeyForTimestamp,
  dailySeedForTimestamp,
  type DailySeedResponse,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type SubmitResponse,
  utcDayMilliseconds,
} from "../src/net/protocol";
import { verifyReplay } from "./replayVerifier";

const inputStride = 5;
const checkpointStride = 5;
const topBoardSize = 50;
const maxRunSeconds = 600;
const maxReplayJsonBytes = 1_800_000;
const maxScorePerSecond = 500_000;
const replayRetentionMilliseconds = 7 * utcDayMilliseconds;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifierPattern = /^[a-z0-9][a-z0-9-]{0,47}$/i;

export const maxLeaderboardSubmissionBytes = 1_900_000;

type RpcSuccess<T> = { ok: true; value: T };
type RpcFailure = { ok: false; status: number; error: string };
export type LeaderboardRpcResult<T> = RpcSuccess<T> | RpcFailure;

type DailyMetaRow = {
  dayKey: number;
  seed: number;
  resetAt: number;
};

type CountRow = { total: number };

type EntryRow = {
  id: string;
  playerName: string;
  carId: string;
  score: number;
  distance: number;
  gatesPassed: number;
  duration: number;
  createdAt: number;
  verified: number;
};

type ReplayRow = { replay: string };

type PendingReplayRow = {
  id: string;
  replay: string;
};

type ValidatedSubmission = {
  board: LeaderboardBoard;
  playerName: string;
  replay: ReplayData;
  replayJson: string;
};

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function success<T>(value: T): RpcSuccess<T> {
  return { ok: true, value };
}

function failure(status: number, error: string): RpcFailure {
  return { ok: false, status, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUint32(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isBoard(value: unknown): value is LeaderboardBoard {
  return value === "daily" || value === "all-time";
}

function sanitizePlayerName(value: unknown) {
  if (typeof value !== "string") return "Driver";
  return value.trim().replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 18) || "Driver";
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function getDailySeedInfo(timestamp = Date.now()): DailySeedResponse & { dayKey: number } {
  const dayKey = dailyDayKeyForTimestamp(timestamp);
  const info = dailySeedForTimestamp(timestamp);
  return {
    dayKey,
    seed: info.seed,
    resetAt: info.resetAt,
  };
}

function validateNumberArray(value: unknown, label: string): ValidationResult<number[]> {
  if (!Array.isArray(value)) return { ok: false, error: `${label} must be an array.` };
  const normalized = new Array<number>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isFiniteNumber(item)) return { ok: false, error: `${label} contains a non-finite value.` };
    normalized[index] = item;
  }
  return { ok: true, value: normalized };
}

function validateReplay(value: unknown): ValidationResult<{ replay: ReplayData; replayJson: string }> {
  if (!isRecord(value)) return { ok: false, error: "Replay data is missing." };

  const {
    version,
    seed,
    carId,
    tuningPreset,
    inputs: rawInputs,
    checkpoints: rawCheckpoints,
    duration,
    finalScore,
    gatesPassed,
    distance,
  } = value;

  if (!isUint32(version)) return { ok: false, error: "Replay physics version is invalid." };
  if (!isUint32(seed)) return { ok: false, error: "Replay seed must be a 32-bit unsigned integer." };
  if (typeof carId !== "string" || !identifierPattern.test(carId)) {
    return { ok: false, error: "Replay car is invalid." };
  }
  if (typeof tuningPreset !== "string" || !identifierPattern.test(tuningPreset)) {
    return { ok: false, error: "Replay tuning preset is invalid." };
  }
  if (!isFiniteNumber(duration) || duration <= 0 || duration > maxRunSeconds) {
    return { ok: false, error: `Run duration must be between 0 and ${maxRunSeconds} seconds.` };
  }
  if (!isFiniteNumber(finalScore) || finalScore <= 0 || !Number.isSafeInteger(Math.round(finalScore))) {
    return { ok: false, error: "Score must be a positive finite number." };
  }
  const scoreLimit = duration * maxScorePerSecond + 100_000;
  if (finalScore > scoreLimit) return { ok: false, error: "Score is outside the plausible range for this run." };
  if (!isFiniteNumber(gatesPassed) || !Number.isInteger(gatesPassed) || gatesPassed < 0 || gatesPassed > 1_000) {
    return { ok: false, error: "Gate count is invalid." };
  }
  if (!isFiniteNumber(distance) || distance < 0 || distance > duration * 120 + 100) {
    return { ok: false, error: "Distance is outside the plausible range for this run." };
  }
  if (gatesPassed > Math.floor(distance / 80) + 2) {
    return { ok: false, error: "Gate count does not match the reported distance." };
  }

  const inputsResult = validateNumberArray(rawInputs, "Replay inputs");
  if (!inputsResult.ok) return inputsResult;
  const inputs = inputsResult.value;
  if (inputs.length === 0 || inputs.length % inputStride !== 0) {
    return { ok: false, error: "Replay inputs use an invalid packed layout." };
  }
  const frameCount = inputs.length / inputStride;
  if (frameCount > Math.ceil(duration * 130) + 4) {
    return { ok: false, error: "Replay contains too many input frames for its duration." };
  }

  let previousInputTime = -Infinity;
  for (let index = 0; index < inputs.length; index += inputStride) {
    const time = inputs[index];
    const throttle = inputs[index + 1];
    const brake = inputs[index + 2];
    const steer = inputs[index + 3];
    const handbrake = inputs[index + 4];
    if (time < 0 || time + 1e-6 < previousInputTime || time > duration + 0.25) {
      return { ok: false, error: "Replay input timestamps are invalid." };
    }
    if (throttle < 0 || throttle > 1 || brake < 0 || brake > 1 || steer < -1 || steer > 1) {
      return { ok: false, error: "Replay input axes are outside their valid range." };
    }
    if (handbrake !== 0 && handbrake !== 1) {
      return { ok: false, error: "Replay handbrake values must be packed as 0 or 1." };
    }
    previousInputTime = time;
  }

  const checkpointsResult = validateNumberArray(rawCheckpoints, "Replay checkpoints");
  if (!checkpointsResult.ok) return checkpointsResult;
  const checkpoints = checkpointsResult.value;
  if (checkpoints.length % checkpointStride !== 0) {
    return { ok: false, error: "Replay checkpoints use an invalid packed layout." };
  }
  if (checkpoints.length / checkpointStride > Math.ceil(duration * 10) + 4) {
    return { ok: false, error: "Replay contains too many checkpoints for its duration." };
  }

  let previousCheckpointTime = -Infinity;
  let previousX = 0;
  let previousZ = 0;
  let checkpointDistance = 0;
  for (let index = 0; index < checkpoints.length; index += checkpointStride) {
    const time = checkpoints[index];
    const x = checkpoints[index + 1];
    const z = checkpoints[index + 2];
    const speed = checkpoints[index + 4];
    if (time < 0 || time + 1e-6 < previousCheckpointTime || time > duration + 0.25) {
      return { ok: false, error: "Replay checkpoint timestamps are invalid." };
    }
    if (Math.abs(x) > 100_000 || Math.abs(z) > 100_000 || speed < 0 || speed > 120) {
      return { ok: false, error: "Replay checkpoint telemetry is outside the plausible range." };
    }
    if (previousCheckpointTime !== -Infinity) {
      const elapsed = Math.max(1 / 120, time - previousCheckpointTime);
      const segmentDistance = Math.hypot(x - previousX, z - previousZ);
      if (segmentDistance / elapsed > 140) {
        return { ok: false, error: "Replay checkpoints contain an impossible position jump." };
      }
      checkpointDistance += segmentDistance;
    }
    previousCheckpointTime = time;
    previousX = x;
    previousZ = z;
  }
  if (checkpointDistance > distance + 75) {
    return { ok: false, error: "Replay checkpoint path exceeds the reported distance." };
  }

  const replay: ReplayData = {
    version,
    seed,
    carId,
    tuningPreset,
    inputs,
    checkpoints,
    duration,
    finalScore,
    gatesPassed,
    distance,
  };
  const replayJson = JSON.stringify(replay);
  if (utf8ByteLength(replayJson) > maxReplayJsonBytes) {
    return { ok: false, error: "Replay is too large to store." };
  }
  return { ok: true, value: { replay, replayJson } };
}

function validateSubmission(value: unknown): ValidationResult<ValidatedSubmission> {
  if (!isRecord(value)) return { ok: false, error: "Submission body must be a JSON object." };
  if (!isBoard(value.board)) return { ok: false, error: "Board must be daily or all-time." };
  const replayResult = validateReplay(value.replay);
  if (!replayResult.ok) return replayResult;
  return {
    ok: true,
    value: {
      board: value.board,
      playerName: sanitizePlayerName(value.playerName),
      replay: replayResult.value.replay,
      replayJson: replayResult.value.replayJson,
    },
  };
}

function toEntry(row: EntryRow): LeaderboardEntry {
  return {
    id: row.id,
    playerName: row.playerName,
    carId: row.carId,
    score: row.score,
    distance: row.distance,
    gatesPassed: row.gatesPassed,
    duration: row.duration,
    createdAt: row.createdAt,
    verified: row.verified === 1,
  };
}

export class Leaderboard extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.ensureVerificationAlarm();
    });
  }

  private migrate() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const current = this.ctx.storage.sql
      .exec<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM _sql_schema_migrations")
      .toArray()[0]?.version ?? 0;

    if (current < 1) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            board TEXT NOT NULL CHECK (board IN ('daily', 'all-time')),
            day_key INTEGER NOT NULL,
            player_name TEXT NOT NULL,
            car_id TEXT NOT NULL,
            score INTEGER NOT NULL,
            distance REAL NOT NULL,
            gates INTEGER NOT NULL,
            duration REAL NOT NULL,
            seed INTEGER NOT NULL,
            physics_version INTEGER NOT NULL,
            replay TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_runs_board_rank
            ON runs(board, day_key, verified, score DESC, distance DESC, duration ASC, created_at ASC);
          CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
          CREATE TABLE IF NOT EXISTS daily_meta (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            day_key INTEGER NOT NULL,
            seed INTEGER NOT NULL,
            reset_at INTEGER NOT NULL
          );
        `);
        this.ctx.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (version, applied_at) VALUES (1, ?)",
          Date.now(),
        );
      });
    }

    if (current < 2) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS replay_verification_queue (
            run_id TEXT PRIMARY KEY,
            requested_at INTEGER NOT NULL
          )
        `);
        // Any rows created by an interim build must earn the verified flag
        // through deterministic simulation before becoming visible again.
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO replay_verification_queue (run_id, requested_at)
           SELECT id, created_at FROM runs WHERE verified = 1`,
        );
        this.ctx.storage.sql.exec("UPDATE runs SET verified = 0 WHERE verified = 1");
        this.ctx.storage.sql.exec(
          "INSERT INTO _sql_schema_migrations (version, applied_at) VALUES (2, ?)",
          Date.now(),
        );
      });
    }
  }

  private async ensureVerificationAlarm() {
    this.ctx.storage.sql.exec(
      "DELETE FROM replay_verification_queue WHERE run_id NOT IN (SELECT id FROM runs)",
    );
    const pending = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS total FROM replay_verification_queue")
      .toArray()[0]?.total ?? 0;
    if (pending === 0) return;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + 25);
  }

  private refreshDailyMeta(timestamp: number): DailyMetaRow {
    const info = getDailySeedInfo(timestamp);
    const stored = this.ctx.storage.sql
      .exec<DailyMetaRow>(
        "SELECT day_key AS dayKey, seed, reset_at AS resetAt FROM daily_meta WHERE singleton = 1",
      )
      .toArray()[0];
    if (!stored || stored.dayKey !== info.dayKey || stored.seed !== info.seed || stored.resetAt !== info.resetAt) {
      this.ctx.storage.sql.exec(
        `INSERT INTO daily_meta (singleton, day_key, seed, reset_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET day_key = excluded.day_key, seed = excluded.seed, reset_at = excluded.reset_at`,
        info.dayKey,
        info.seed,
        info.resetAt,
      );
    }
    return { dayKey: info.dayKey, seed: info.seed, resetAt: info.resetAt };
  }

  async getDailyInfo(timestamp: number): Promise<LeaderboardRpcResult<DailySeedResponse>> {
    const meta = this.refreshDailyMeta(timestamp);
    return success({ seed: meta.seed, resetAt: meta.resetAt });
  }

  async getBoard(
    board: LeaderboardBoard,
    requestedLimit: number,
    timestamp: number,
  ): Promise<LeaderboardRpcResult<LeaderboardResponse>> {
    if (!isBoard(board)) return failure(400, "Board must be daily or all-time.");
    const limit = Math.max(1, Math.min(topBoardSize, Math.floor(requestedLimit) || topBoardSize));
    const daily = this.refreshDailyMeta(timestamp);
    const dayKey = board === "daily" ? daily.dayKey : 0;
    const entries = this.ctx.storage.sql
      .exec<EntryRow>(
        `SELECT id, player_name AS playerName, car_id AS carId, score, distance,
                gates AS gatesPassed, duration, created_at AS createdAt, verified
         FROM runs
         WHERE board = ? AND day_key = ? AND verified = 1
         ORDER BY score DESC, distance DESC, duration ASC, created_at ASC
         LIMIT ?`,
        board,
        dayKey,
        limit,
      )
      .toArray()
      .map(toEntry);
    const total = this.ctx.storage.sql
      .exec<CountRow>(
        "SELECT COUNT(*) AS total FROM runs WHERE board = ? AND day_key = ? AND verified = 1",
        board,
        dayKey,
      )
      .toArray()[0]?.total ?? 0;
    return success({
      entries,
      total,
      dailySeed: daily.seed,
      dailyResetAt: daily.resetAt,
    });
  }

  private rankFor(
    board: LeaderboardBoard,
    dayKey: number,
    score: number,
    distance: number,
    duration: number,
    createdAt: number,
  ) {
    const ahead = this.ctx.storage.sql
      .exec<CountRow>(
        `SELECT COUNT(*) AS total
         FROM runs
         WHERE board = ? AND day_key = ? AND verified = 1 AND (
           score > ? OR
           (score = ? AND distance > ?) OR
           (score = ? AND distance = ? AND duration < ?) OR
           (score = ? AND distance = ? AND duration = ? AND created_at <= ?)
         )`,
        board,
        dayKey,
        score,
        score,
        distance,
        score,
        distance,
        duration,
        score,
        distance,
        duration,
        createdAt,
      )
      .toArray()[0]?.total ?? 0;
    return ahead + 1;
  }

  async submit(
    request: unknown,
    timestamp: number,
  ): Promise<LeaderboardRpcResult<SubmitResponse>> {
    const validated = validateSubmission(request);
    if (!validated.ok) return failure(400, validated.error);
    const { board, playerName, replay, replayJson } = validated.value;
    const daily = this.refreshDailyMeta(timestamp);
    if (board === "daily" && replay.seed !== daily.seed) {
      return failure(409, "Daily seed has reset. Start a new daily run and try again.");
    }

    const createdAt = Math.max(0, Math.floor(timestamp));
    const dayKey = board === "daily" ? daily.dayKey : 0;
    const score = Math.round(replay.finalScore);
    const rank = this.rankFor(board, dayKey, score, replay.distance, replay.duration, createdAt);
    const needsVerification = rank <= topBoardSize;
    const id = crypto.randomUUID();

    this.ctx.storage.sql.exec(
      `INSERT INTO runs (
         id, board, day_key, player_name, car_id, score, distance, gates, duration,
         seed, physics_version, replay, verified, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      board,
      dayKey,
      playerName,
      replay.carId,
      score,
      replay.distance,
      replay.gatesPassed,
      replay.duration,
      replay.seed,
      replay.version,
      replayJson,
      0,
      createdAt,
    );
    if (needsVerification) {
      this.ctx.storage.sql.exec(
        "INSERT INTO replay_verification_queue (run_id, requested_at) VALUES (?, ?)",
        id,
        createdAt,
      );
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM runs WHERE verified = 0 AND created_at < ?",
      createdAt - replayRetentionMilliseconds,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM replay_verification_queue WHERE run_id NOT IN (SELECT id FROM runs)",
    );
    if (needsVerification) await this.ensureVerificationAlarm();

    return success({
      accepted: true,
      rank,
      message: needsVerification
        ? "Run accepted. Deterministic top-board verification is pending."
        : "Run saved outside the current top 50.",
      id,
      verified: false,
    });
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM replay_verification_queue WHERE run_id NOT IN (SELECT id FROM runs)",
    );
    const pending = this.ctx.storage.sql
      .exec<PendingReplayRow>(
        `SELECT runs.id, runs.replay
         FROM replay_verification_queue
         JOIN runs ON runs.id = replay_verification_queue.run_id
         ORDER BY replay_verification_queue.requested_at ASC
         LIMIT 1`,
      )
      .toArray()[0];
    if (!pending) return;

    let verified = false;
    let failureReason = "Stored replay could not be decoded.";
    try {
      const decoded = JSON.parse(pending.replay) as unknown;
      const replay = validateReplay(decoded);
      if (replay.ok) {
        const result = verifyReplay(replay.value.replay);
        verified = result.ok;
        failureReason = result.ok ? "" : result.reason;
      } else {
        failureReason = replay.error;
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM replay_verification_queue WHERE run_id = ?", pending.id);
      if (verified) this.ctx.storage.sql.exec("UPDATE runs SET verified = 1 WHERE id = ?", pending.id);
      else this.ctx.storage.sql.exec("DELETE FROM runs WHERE id = ?", pending.id);
    });
    if (!verified) {
      console.warn(
        JSON.stringify({
          message: "leaderboard replay verification rejected",
          runId: pending.id,
          reason: failureReason,
        }),
      );
    }
    await this.ensureVerificationAlarm();
  }

  async getReplay(id: string): Promise<LeaderboardRpcResult<ReplayData | null>> {
    if (!uuidPattern.test(id)) return failure(400, "Replay id is invalid.");
    const row = this.ctx.storage.sql
      .exec<ReplayRow>("SELECT replay FROM runs WHERE id = ?", id)
      .toArray()[0];
    if (!row) return success(null);
    try {
      const replay = JSON.parse(row.replay) as unknown;
      const validated = validateReplay(replay);
      return validated.ok ? success(validated.value.replay) : failure(500, "Stored replay is invalid.");
    } catch {
      return failure(500, "Stored replay could not be decoded.");
    }
  }
}
