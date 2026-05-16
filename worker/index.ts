import {
  driftMatchSeconds,
  driftReadySeconds,
  makeRoomCode,
  onlineMaxPlayers,
  sanitizeRoomCode,
  type ClientOnlineMessage,
  type OnlineInputTelemetry,
  type OnlinePlayerState,
  type OnlineRoomState,
  type ServerOnlineMessage,
} from "../src/net/protocol";

export type Env = {
  DRIFT_ROOMS: DurableObjectNamespace<DriftRoom>;
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
      ...init?.headers,
    },
  });
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
      if (session.player.combo > 0) {
        session.player.score += session.player.combo;
        session.player.combo = 0;
      }
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
    if (url.pathname === "/api/health") return json({ ok: true, service: "project-lite-online" });
    if (url.pathname !== "/api/ws") return json({ error: "Not found" }, { status: 404 });

    const requestedRoom = sanitizeRoomCode(url.searchParams.get("room") || "") || makeRoomCode();
    const id = env.DRIFT_ROOMS.idFromName(requestedRoom);
    const room = env.DRIFT_ROOMS.get(id);
    url.searchParams.set("room", requestedRoom);
    return room.fetch(new Request(url, request));
  },
};
