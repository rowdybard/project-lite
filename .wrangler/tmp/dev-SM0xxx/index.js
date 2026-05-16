var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/net/protocol.ts
var onlineMaxPlayers = 6;
var driftReadySeconds = 45;
var driftMatchSeconds = 90;
function sanitizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
__name(sanitizeRoomCode, "sanitizeRoomCode");
function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
__name(makeRoomCode, "makeRoomCode");

// worker/index.ts
var defaultPose = { x: 0, z: 0, heading: 0, speed: 0 };
function now() {
  return Date.now();
}
__name(now, "now");
function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...init?.headers
    }
  });
}
__name(json, "json");
function safeName(value) {
  if (typeof value !== "string") return "Guest";
  return value.trim().replace(/\s+/g, " ").slice(0, 18) || "Guest";
}
__name(safeName, "safeName");
function parseMessage(data) {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}
__name(parseMessage, "parseMessage");
function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}
__name(send, "send");
function scoreInput(session, input, dt, phase) {
  if (phase !== "racing" || session.player.finished) return;
  session.player.pose = input.pose;
  const angle = Math.abs(input.angle);
  const rearSlip = Math.abs(input.rearSlip);
  const isScoring = input.onTrack && input.speedMph > 18 && angle > 7.5 && rearSlip > 8 && input.driftAmount > 0.24;
  if (!isScoring) {
    session.comboGrace -= dt;
    if (session.comboGrace <= 0 && session.player.combo > 0) {
      session.player.score += session.player.combo;
      session.player.combo = 0;
      session.player.multiplier = 1;
      session.driftTime = 0;
    }
    return;
  }
  session.comboGrace = 1.15;
  session.driftTime += dt;
  session.player.multiplier = Math.min(5, 1 + session.driftTime * 0.12);
  const angleScore = Math.min(Math.max(angle - 4, 0), 58);
  const speedScore = Math.min(input.speedMph, 95);
  const throttleBonus = 0.96 + Math.max(0, input.throttle) * 0.18;
  session.player.combo += speedScore * angleScore * 0.38 * throttleBonus * session.player.multiplier * dt;
}
__name(scoreInput, "scoreInput");
var DriftRoom = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    void this.state;
    void this.env;
  }
  static {
    __name(this, "DriftRoom");
  }
  sessions = /* @__PURE__ */ new Map();
  roomCode = "ROOM";
  leaderId = null;
  phase = "queue";
  readyDeadline = null;
  matchStartAt = null;
  matchEndsAt = null;
  snapshotTimer = null;
  startTimer = null;
  endTimer = null;
  async fetch(request) {
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
  onMessage(socket, data) {
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
      if (message.ready && !this.readyDeadline) this.readyDeadline = now() + driftReadySeconds * 1e3;
      this.evaluateStart();
      this.broadcast({ type: "room_state", room: this.roomState() });
      return;
    }
    if (message.type === "input") {
      const t = now();
      const dt = Math.min(0.2, Math.max(0, (t - session.lastInputAt) / 1e3 || 1 / 20));
      session.lastInputAt = t;
      scoreInput(session, message.input, dt, this.phase);
      if (this.matchEndsAt && t >= this.matchEndsAt) this.finishMatch();
    }
  }
  join(socket, message) {
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
    const player = {
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
      pose: defaultPose
    };
    this.sessions.set(socket, {
      socket,
      player,
      comboGrace: 0,
      driftTime: 0,
      lastInputAt: now()
    });
    this.ensureSnapshotTimer();
    send(socket, { type: "joined", playerId, room: this.roomState() });
    this.broadcast({ type: "room_state", room: this.roomState() });
  }
  onClose(socket) {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    if (this.leaderId === session.player.id) {
      this.leaderId = this.sessions.values().next().value?.player.id ?? null;
    }
    if (this.sessions.size === 0) this.clearTimers();
    this.broadcast({ type: "room_state", room: this.roomState() });
  }
  evaluateStart() {
    if (this.phase === "racing" || this.phase === "finished") return;
    const sessions = [...this.sessions.values()];
    if (!sessions.length) return;
    const leader = sessions.find((session) => session.player.id === this.leaderId);
    const allReady = sessions.every((session) => session.player.ready);
    const leaderReady = !!leader?.player.ready;
    if (allReady || leaderReady && this.readyDeadline && now() >= this.readyDeadline) {
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
  startCountdown() {
    if (this.phase === "countdown" || this.phase === "racing") return;
    this.phase = "countdown";
    this.matchStartAt = now() + 3e3;
    this.matchEndsAt = this.matchStartAt + driftMatchSeconds * 1e3;
    this.broadcast({ type: "match_start", room: this.roomState() });
    this.startTimer = setTimeout(() => {
      this.phase = "racing";
      this.broadcast({ type: "room_state", room: this.roomState() });
      this.endTimer = setTimeout(() => this.finishMatch(), driftMatchSeconds * 1e3 + 250);
    }, 3e3);
  }
  finishMatch() {
    if (this.phase === "finished") return;
    this.phase = "finished";
    for (const session of this.sessions.values()) {
      if (session.player.combo > 0) {
        session.player.score += session.player.combo;
        session.player.combo = 0;
      }
      session.player.finished = true;
      session.player.multiplier = 1;
    }
    this.broadcast({ type: "match_end", room: this.roomState() });
    this.clearTimers();
  }
  ensureSnapshotTimer() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setInterval(() => {
      this.evaluateStart();
      if (this.phase === "racing" || this.phase === "countdown") {
        this.broadcast({ type: "snapshot", room: this.roomState() });
      } else {
        this.broadcast({ type: "room_state", room: this.roomState() });
      }
    }, 100);
  }
  clearTimers() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.snapshotTimer = null;
    this.startTimer = null;
    this.endTimer = null;
  }
  roomState() {
    const players = [...this.sessions.values()].map((session) => ({
      ...session.player,
      leader: this.leaderId === session.player.id,
      score: Math.round(session.player.score),
      combo: Math.round(session.player.combo)
    }));
    return {
      roomCode: this.roomCode,
      leaderId: this.leaderId,
      phase: this.phase,
      players,
      readyDeadline: this.readyDeadline,
      matchStartAt: this.matchStartAt,
      matchEndsAt: this.matchEndsAt,
      serverNow: now()
    };
  }
  broadcast(message) {
    for (const session of this.sessions.values()) send(session.socket, message);
  }
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "project-lite-online" });
    if (url.pathname !== "/api/ws") return json({ error: "Not found" }, { status: 404 });
    const requestedRoom = sanitizeRoomCode(url.searchParams.get("room") || "") || makeRoomCode();
    const id = env.DRIFT_ROOMS.idFromName(requestedRoom);
    const room = env.DRIFT_ROOMS.get(id);
    url.searchParams.set("room", requestedRoom);
    return room.fetch(new Request(url, request));
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-XQRuGN/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-XQRuGN/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  DriftRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
