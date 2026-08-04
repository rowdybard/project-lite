import type { CarCustomization } from "../game/customization";

export const onlineMaxPlayers = 6;
export const driftReadySeconds = 45;
export const driftMatchSeconds = 90;

export type OnlinePhase = "queue" | "countdown" | "racing" | "finished";

export type OnlinePose = {
  x: number;
  z: number;
  heading: number;
  speed: number;
};

export type OnlineCustomization = Pick<
  CarCustomization,
  "selectedCar" | "paint" | "wheelColor" | "stance" | "spoiler" | "frontLip" | "sideSkirts" | "underglow" | "tuningPreset"
>;

export type OnlinePlayerState = {
  id: string;
  name: string;
  carId: string;
  customization: OnlineCustomization;
  ready: boolean;
  connected: boolean;
  leader: boolean;
  finished: boolean;
  score: number;
  combo: number;
  multiplier: number;
  pose: OnlinePose;
};

export type OnlineRoomState = {
  roomCode: string;
  leaderId: string | null;
  phase: OnlinePhase;
  players: OnlinePlayerState[];
  readyDeadline: number | null;
  matchStartAt: number | null;
  matchEndsAt: number | null;
  serverNow: number;
};

export type OnlineInputTelemetry = {
  seq: number;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  reset: boolean;
  pose: OnlinePose;
  speedMph: number;
  angle: number;
  rearSlip: number;
  driftAmount: number;
  onTrack: boolean;
  score: number;
  combo: number;
  multiplier: number;
};

export type ClientOnlineMessage =
  | {
      type: "join";
      name: string;
      carId: string;
      customization: OnlineCustomization;
    }
  | {
      type: "set_ready";
      ready: boolean;
    }
  | {
      type: "input";
      input: OnlineInputTelemetry;
    };

export type ServerOnlineMessage =
  | {
      type: "joined";
      playerId: string;
      room: OnlineRoomState;
    }
  | {
      type: "room_state";
      room: OnlineRoomState;
    }
  | {
      type: "snapshot";
      room: OnlineRoomState;
    }
  | {
      type: "match_start";
      room: OnlineRoomState;
    }
  | {
      type: "match_end";
      room: OnlineRoomState;
    }
  | {
      type: "error";
      message: string;
    };

export type LeaderboardBoard = "daily" | "all-time";

export type LeaderboardEntry = {
  id: string;
  playerName: string;
  carId: string;
  score: number;
  distance: number;
  gatesPassed: number;
  duration: number;
  createdAt: number;
  verified: boolean;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  total: number;
  dailySeed: number;
  dailyResetAt: number;
};

export type DailySeedResponse = {
  seed: number;
  resetAt: number;
};

export type SubmitLeaderboardRequest<TReplay = unknown> = {
  board: LeaderboardBoard;
  playerName: string;
  replay: TReplay;
};

export type SubmitResponse = {
  accepted: boolean;
  rank: number | null;
  message: string;
  id: string | null;
  verified: boolean;
};

export type ApiErrorResponse = {
  error: string;
};

export const utcDayMilliseconds = 86_400_000;

function mixDailySeed(value: number) {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  return (mixed ^ (mixed >>> 15)) >>> 0;
}

export function dailyDayKeyForTimestamp(timestamp: number) {
  return Math.floor(timestamp / utcDayMilliseconds);
}

export function dailySeedForDayKey(dayKey: number) {
  return mixDailySeed((dayKey ^ 0x4452_4946) >>> 0) || 1;
}

/** The canonical Daily board seed and next UTC-midnight reset. */
export function dailySeedForTimestamp(timestamp: number): DailySeedResponse {
  const dayKey = dailyDayKeyForTimestamp(timestamp);
  return {
    seed: dailySeedForDayKey(dayKey),
    resetAt: (dayKey + 1) * utcDayMilliseconds,
  };
}

export function sanitizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function makeGuestName(value: string) {
  const clean = value.trim().replace(/\s+/g, " ").slice(0, 18);
  return clean || "Guest";
}
