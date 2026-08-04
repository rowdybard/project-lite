import {
  driftMatchSeconds,
  driftReadySeconds,
  makeRoomCode,
  onlineMaxPlayers,
  sanitizeRoomCode,
  type ClientOnlineMessage,
  type LeaderboardBoard,
  type OnlineInputTelemetry,
  type OnlinePlayerState,
  type OnlineRoomState,
  type ServerOnlineMessage,
} from "../src/net/protocol";
import {
  Leaderboard,
  maxLeaderboardSubmissionBytes,
  type LeaderboardRpcResult,
} from "./leaderboard";

export { Leaderboard };

export type Env = {
  DRIFT_ROOMS: DurableObjectNamespace<DriftRoom>;
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
};

type PlayerSession = {
  socket: WebSocket;
  player: OnlinePlayerState;
  lastInputAt: number;
};

const defaultPose = { x: 0, z: 0, heading: 0, speed: 0 };

function now() {
  return Date.now();
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      ...init?.headers,
    },
  });
}

type ParsedBody = { ok: true; value: unknown } | { ok: false; response: Response };

async function readBoundedJson(request: Request, maxBytes: number): Promise<ParsedBody> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { ok: false, response: json({ error: "Content-Type must be application/json." }, { status: 415 }) };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      return { ok: false, response: json({ error: "Content-Length is invalid." }, { status: 400 }) };
    }
    if (declaredBytes > maxBytes) {
      return { ok: false, response: json({ error: "Submission payload is too large." }, { status: 413 }) };
    }
  }
  if (!request.body) return { ok: false, response: json({ error: "Submission body is required." }, { status: 400 }) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel("Submission payload is too large.");
        return { ok: false, response: json({ error: "Submission payload is too large." }, { status: 413 }) };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: json({ error: "Submission body is not valid JSON." }, { status: 400 }) };
  }
}

function rpcResponse<T>(result: LeaderboardRpcResult<T>) {
  return result.ok ? json(result.value) : json({ error: result.error }, { status: result.status });
}

function isLeaderboardBoard(value: string | undefined): value is LeaderboardBoard {
  return value === "daily" || value === "all-time";
}

async function handleLeaderboardRequest(request: Request, env: Env, url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const leaderboard = env.LEADERBOARD.getByName("global");

  if (request.method === "GET" && segments.length === 3 && segments[1] === "leaderboard") {
    if (segments[2] === "daily-seed") return rpcResponse(await leaderboard.getDailyInfo(Date.now()));
    if (!isLeaderboardBoard(segments[2])) return json({ error: "Unknown leaderboard board." }, { status: 404 });
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
    return rpcResponse(await leaderboard.getBoard(segments[2], requestedLimit, Date.now()));
  }

  if (
    request.method === "POST" &&
    segments.length === 3 &&
    segments[1] === "leaderboard" &&
    segments[2] === "submit"
  ) {
    const body = await readBoundedJson(request, maxLeaderboardSubmissionBytes);
    if (!body.ok) return body.response;
    return rpcResponse(await leaderboard.submit(body.value, Date.now()));
  }

  if (request.method === "GET" && segments.length === 3 && segments[1] === "replay") {
    let replayId: string;
    try {
      replayId = decodeURIComponent(segments[2]);
    } catch {
      return json({ error: "Replay id is invalid." }, { status: 400 });
    }
    const replay = await leaderboard.getReplay(replayId);
    if (!replay.ok) return rpcResponse(replay);
    return replay.value ? json(replay.value) : json({ error: "Replay not found." }, { status: 404 });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST, OPTIONS" } });
  }
  return json({ error: "Not found" }, { status: 404 });
}

function safeName(value: unknown) {
  if (typeof value !== "string") return "Guest";
  return value.trim().replace(/\s+/g, " ").slice(0, 18) || "Guest";
}

function parseMessage(data: unknown): ClientOnlineMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function send(socket: WebSocket, message: ServerOnlineMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function scoreInput(session: PlayerSession, input: OnlineInputTelemetry, dt: number, phase: OnlineRoomState["phase"]) {
  if (phase !== "racing" || session.player.finished) return;

  session.player.pose = input.pose;
  // Client sends true total score in score field, just store it directly
  session.player.score = input.score;
  session.player.combo = input.combo;
  session.player.multiplier = input.multiplier;
}

export class DriftRoom {
  private sessions = new Map<WebSocket, PlayerSession>();
  private roomCode = "ROOM";
  private leaderId: string | null = null;
  private phase: OnlineRoomState["phase"] = "queue";
  private readyDeadline: number | null = null;
  private matchStartAt: number | null = null;
  private matchEndsAt: number | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private state: DurableObjectState, private env: Env) {
    void this.state;
    void this.env;
  }

  async fetch(request: Request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") return json({ error: "Expected WebSocket upgrade" }, { status: 426 });

    const url = new URL(request.url);
    this.roomCode = sanitizeRoomCode(url.searchParams.get("room") || "") || makeRoomCode();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    server.addEventListener("message", (event) => this.onMessage(server, event.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(socket: WebSocket, data: unknown) {
    const message = parseMessage(data);
    if (!message) return send(socket, { type: "error", message: "Bad message" });

    if (message.type === "join") {
      this.join(socket, message);
      return;
    }

    const session = this.sessions.get(socket);
    if (!session) return send(socket, { type: "error", message: "Join room first" });

    if (message.type === "set_ready") {
      if (this.phase !== "queue" && this.phase !== "countdown") return;
      session.player.ready = message.ready;
      if (message.ready && !this.readyDeadline) this.readyDeadline = now() + driftReadySeconds * 1000;
      this.evaluateStart();
      this.broadcast({ type: "room_state", room: this.roomState() });
      return;
    }

    if (message.type === "input") {
      const t = now();
      const dt = Math.min(0.2, Math.max(0, (t - session.lastInputAt) / 1000 || 1 / 20));
      session.lastInputAt = t;
      // Always update pose so ghosts move in all phases (queue, countdown, racing)
      session.player.pose = message.input.pose;
      scoreInput(session, message.input, dt, this.phase);
      if (this.matchEndsAt && t >= this.matchEndsAt) this.finishMatch();
    }
  }

  private join(socket: WebSocket, message: Extract<ClientOnlineMessage, { type: "join" }>) {
    if (this.sessions.has(socket)) return;
    if (this.sessions.size >= onlineMaxPlayers) {
      send(socket, { type: "error", message: "Room is full" });
      socket.close(1008, "Room full");
      return;
    }
    if (this.phase === "racing" || this.phase === "finished") {
      send(socket, { type: "error", message: "Match already started" });
      socket.close(1008, "Match started");
      return;
    }

    const playerId = crypto.randomUUID();
    if (!this.leaderId) this.leaderId = playerId;
    const player: OnlinePlayerState = {
      id: playerId,
      name: safeName(message.name),
      carId: message.carId,
      customization: message.customization,
      ready: false,
      connected: true,
      leader: this.leaderId === playerId,
      finished: false,
      score: 0,
      combo: 0,
      multiplier: 1,
      pose: defaultPose,
    };

    this.sessions.set(socket, {
      socket,
      player,
      lastInputAt: now(),
    });
    this.ensureSnapshotTimer();
    send(socket, { type: "joined", playerId, room: this.roomState() });
    this.broadcast({ type: "room_state", room: this.roomState() });
  }

  private onClose(socket: WebSocket) {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    if (this.leaderId === session.player.id) {
      this.leaderId = this.sessions.values().next().value?.player.id ?? null;
      this.readyDeadline = null;
    }
    if (this.sessions.size === 0) this.clearTimers();
    this.broadcast({ type: "room_state", room: this.roomState() });
  }

  private evaluateStart() {
    if (this.phase === "racing" || this.phase === "finished") return;
    const sessions = [...this.sessions.values()];
    if (!sessions.length) return;
    const leader = sessions.find((session) => session.player.id === this.leaderId);
    const allReady = sessions.every((session) => session.player.ready);
    const leaderReady = !!leader?.player.ready;

    if (allReady || (leaderReady && this.readyDeadline && now() >= this.readyDeadline)) {
      this.startCountdown();
      return;
    }

    if (leaderReady && this.readyDeadline && !this.startTimer) {
      const delay = Math.max(0, this.readyDeadline - now());
      this.startTimer = setTimeout(() => {
        this.startTimer = null;
        this.evaluateStart();
      }, delay);
    }
  }

  private startCountdown() {
    if (this.phase === "countdown" || this.phase === "racing") return;
    this.phase = "countdown";
    this.matchStartAt = now() + 3000;
    this.matchEndsAt = this.matchStartAt + driftMatchSeconds * 1000;
    this.broadcast({ type: "match_start", room: this.roomState() });
    this.startTimer = setTimeout(() => {
      this.phase = "racing";
      this.broadcast({ type: "room_state", room: this.roomState() });
      this.endTimer = setTimeout(() => this.finishMatch(), driftMatchSeconds * 1000 + 250);
    }, 3000);
  }

  private finishMatch() {
    if (this.phase === "finished") return;
    this.phase = "finished";
    for (const session of this.sessions.values()) {
      // The client score is already banked score plus its active combo.
      // Preserve that single total and only close the combo presentation.
      session.player.combo = 0;
      session.player.finished = true;
    }
    this.broadcast({ type: "match_end", room: this.roomState() });
    this.clearTimers();
  }

  private ensureSnapshotTimer() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      this.evaluateStart();
      if (this.phase === "racing" || this.phase === "countdown") {
        this.broadcast({ type: "snapshot", room: this.roomState() });
      } else {
        this.broadcast({ type: "room_state", room: this.roomState() });
      }
    }, 50);
  }

  private clearTimers() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.snapshotTimer = null;
    this.startTimer = null;
    this.endTimer = null;
  }

  private roomState(): OnlineRoomState {
    const players = [...this.sessions.values()].map((session) => ({
      ...session.player,
      leader: this.leaderId === session.player.id,
      score: Math.round(session.player.score),
      combo: Math.round(session.player.combo),
    }));
    return {
      roomCode: this.roomCode,
      leaderId: this.leaderId,
      phase: this.phase,
      players,
      readyDeadline: this.readyDeadline,
      matchStartAt: this.matchStartAt,
      matchEndsAt: this.matchEndsAt,
      serverNow: now(),
    };
  }

  private broadcast(message: ServerOnlineMessage) {
    for (const session of this.sessions.values()) send(session.socket, message);
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "86400",
        },
      });
    }

    try {
      if (url.pathname === "/api/health") return json({ ok: true, service: "project-lite-online" });
      if (url.pathname.startsWith("/api/leaderboard/") || url.pathname.startsWith("/api/replay/")) {
        return await handleLeaderboardRequest(request, env, url);
      }
      if (url.pathname !== "/api/ws") return json({ error: "Not found" }, { status: 404 });

      const requestedRoom = sanitizeRoomCode(url.searchParams.get("room") || "") || makeRoomCode();
      const id = env.DRIFT_ROOMS.idFromName(requestedRoom);
      const room = env.DRIFT_ROOMS.get(id);
      url.searchParams.set("room", requestedRoom);
      return await room.fetch(new Request(url, request));
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request failed",
          method: request.method,
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: "Internal server error." }, { status: 500 });
    }
  },
};
