import type { CarCustomization } from "../game/customization";
import {
  makeGuestName,
  makeRoomCode,
  sanitizeRoomCode,
  type ClientOnlineMessage,
  type OnlineInputTelemetry,
  type OnlineRoomState,
  type ServerOnlineMessage,
} from "./protocol";
import type { PlayerProfile } from "./profile";

type OnlineClientCallbacks = {
  onJoined: (playerId: string, room: OnlineRoomState) => void;
  onRoom: (room: OnlineRoomState) => void;
  onMatchStart: (room: OnlineRoomState) => void;
  onMatchEnd: (room: OnlineRoomState) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
};

export type OnlineClient = ReturnType<typeof createOnlineClient>;

function makeWsUrl(roomCode?: string) {
  const configured = import.meta.env.VITE_ONLINE_WS_URL as string | undefined;
  const base =
    configured ||
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
      ? `ws://${window.location.hostname}:8787/api/ws`
      : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/ws`);
  const url = new URL(base);
  const cleanCode = sanitizeRoomCode(roomCode ?? "");
  if (cleanCode) url.searchParams.set("room", cleanCode);
  return url.toString();
}

function onlineCustomization(customization: CarCustomization) {
  const { selectedMode, ...payload } = customization;
  void selectedMode;
  return payload;
}

export function createOnlineClient(callbacks: OnlineClientCallbacks) {
  let socket: WebSocket | null = null;
  let playerId: string | null = null;
  let room: OnlineRoomState | null = null;
  let connectionId = 0;

  function send(message: ClientOnlineMessage) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function handleMessage(message: ServerOnlineMessage) {
    if (message.type === "error") {
      callbacks.onError(message.message);
      return;
    }
    room = message.room;
    if (message.type === "joined") {
      playerId = message.playerId;
      callbacks.onJoined(message.playerId, message.room);
      return;
    }
    if (message.type === "match_start") {
      callbacks.onMatchStart(message.room);
      return;
    }
    if (message.type === "match_end") {
      callbacks.onMatchEnd(message.room);
      return;
    }
    callbacks.onRoom(message.room);
  }

  return {
    get playerId() {
      return playerId;
    },
    get room() {
      return room;
    },
    connect(profile: PlayerProfile, customization: CarCustomization, roomCode?: string) {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close();
      const currentConnection = ++connectionId;
      const requestedRoomCode = sanitizeRoomCode(roomCode ?? "") || makeRoomCode();
      callbacks.onStatus("Connecting");
      socket = new WebSocket(makeWsUrl(requestedRoomCode));
      const activeSocket = socket;
      socket.addEventListener("open", () => {
        if (currentConnection !== connectionId || activeSocket !== socket) return;
        callbacks.onStatus("Connected");
        send({
          type: "join",
          name: makeGuestName(profile.name),
          carId: customization.selectedCar,
          customization: onlineCustomization(customization),
        });
      });
      socket.addEventListener("message", (event) => {
        if (currentConnection !== connectionId || activeSocket !== socket) return;
        try {
          handleMessage(JSON.parse(event.data as string) as ServerOnlineMessage);
        } catch {
          callbacks.onError("Bad server message");
        }
      });
      socket.addEventListener("close", () => {
        if (currentConnection === connectionId && activeSocket === socket) callbacks.onStatus("Disconnected");
      });
      socket.addEventListener("error", () =>
        currentConnection === connectionId && activeSocket === socket
          ? callbacks.onError("Could not reach online server. In dev, run npm run dev so Vite and the Worker start together.")
          : undefined,
      );
      return requestedRoomCode;
    },
    setReady(ready: boolean) {
      return send({ type: "set_ready", ready });
    },
    sendInput(input: OnlineInputTelemetry) {
      return send({ type: "input", input });
    },
    disconnect() {
      connectionId += 1;
      socket?.close();
      socket = null;
      playerId = null;
      room = null;
    },
  };
}
