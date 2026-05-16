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
