import { isReplayData, type ReplayData } from "../game/endless/replay";
import {
  makeGuestName,
  type DailySeedResponse,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type SubmitLeaderboardRequest,
  type SubmitResponse,
} from "./protocol";

const requestTimeoutMilliseconds = 12_000;
const replayTimeoutMilliseconds = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.playerName === "string" &&
    typeof value.carId === "string" &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.distance) &&
    isFiniteNumber(value.gatesPassed) &&
    isFiniteNumber(value.duration) &&
    isFiniteNumber(value.createdAt) &&
    typeof value.verified === "boolean"
  );
}

function isLeaderboardResponse(value: unknown): value is LeaderboardResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.entries) &&
    value.entries.every(isLeaderboardEntry) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.dailySeed) &&
    isFiniteNumber(value.dailyResetAt)
  );
}

function isDailySeedResponse(value: unknown): value is DailySeedResponse {
  return isRecord(value) && isFiniteNumber(value.seed) && isFiniteNumber(value.resetAt);
}

function isSubmitResponse(value: unknown): value is SubmitResponse {
  return (
    isRecord(value) &&
    typeof value.accepted === "boolean" &&
    (value.rank === null || isFiniteNumber(value.rank)) &&
    typeof value.message === "string" &&
    (value.id === null || typeof value.id === "string") &&
    typeof value.verified === "boolean"
  );
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Leaderboard URL must use HTTP, HTTPS, WS, or WSS.");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/api\/ws\/?$/, "").replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function defaultBaseUrl() {
  const configuredHttp = import.meta.env.VITE_ONLINE_HTTP_URL as string | undefined;
  const configuredWs = import.meta.env.VITE_ONLINE_WS_URL as string | undefined;
  if (configuredHttp || configuredWs) return normalizeBaseUrl(configuredHttp || configuredWs || "");
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return `http://${window.location.hostname}:8787`;
  }
  return "https://project-lite-online.maxpug17.workers.dev";
}

async function requestJson(url: string, init?: RequestInit, timeoutMilliseconds = requestTimeoutMilliseconds) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMilliseconds);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Leaderboard request timed out.");
    throw new Error("Could not reach the leaderboard service.", { cause: error });
  } finally {
    window.clearTimeout(timeout);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(response.ok ? "Leaderboard returned an invalid response." : `Leaderboard request failed (${response.status}).`);
  }
  if (!response.ok) {
    const error = isRecord(data) && typeof data.error === "string" ? data.error : `Request failed (${response.status}).`;
    throw new Error(error);
  }
  return data;
}

export function createLeaderboardClient(baseUrl = defaultBaseUrl()) {
  const base = normalizeBaseUrl(baseUrl);

  return {
    async fetchBoard(board: LeaderboardBoard, requestedLimit = 50): Promise<LeaderboardResponse> {
      const limit = Math.max(1, Math.min(50, Math.floor(requestedLimit) || 50));
      const data = await requestJson(`${base}/api/leaderboard/${board}?limit=${limit}`);
      if (!isLeaderboardResponse(data)) throw new Error("Leaderboard returned malformed board data.");
      return data;
    },

    async fetchDailySeed(): Promise<DailySeedResponse> {
      const data = await requestJson(`${base}/api/leaderboard/daily-seed`);
      if (!isDailySeedResponse(data)) throw new Error("Leaderboard returned malformed daily seed data.");
      return data;
    },

    async submitRun(
      replay: ReplayData,
      board: LeaderboardBoard,
      playerName = "Driver",
    ): Promise<SubmitResponse> {
      const payload: SubmitLeaderboardRequest<ReplayData> = {
        board,
        playerName: makeGuestName(playerName),
        replay,
      };
      const data = await requestJson(`${base}/api/leaderboard/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!isSubmitResponse(data)) throw new Error("Leaderboard returned a malformed submission result.");
      return data;
    },

    async fetchReplay(id: string): Promise<ReplayData> {
      const replayId = id.trim();
      if (!replayId) throw new Error("Replay id is required.");
      const data = await requestJson(
        `${base}/api/replay/${encodeURIComponent(replayId)}`,
        undefined,
        replayTimeoutMilliseconds,
      );
      if (!isReplayData(data)) throw new Error("Leaderboard returned malformed replay data.");
      return data;
    },
  };
}

export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>;
