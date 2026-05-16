import { driftMatchSeconds, driftReadySeconds, sanitizeRoomCode, type OnlineRoomState } from "../net/protocol";

type OnlineMatchUiCallbacks = {
  onConnect: (roomCode?: string) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onShowQueue: () => void;
};

const formatScore = (value: number) => Math.round(value).toLocaleString();
const secondsLeft = (target: number | null, serverNow: number) =>
  target ? Math.max(0, Math.ceil((target - serverNow) / 1000)) : 0;

function playerRows(room: OnlineRoomState | null, localId: string | null) {
  const players = room?.players ?? [];
  if (!players.length) return `<div class="online-match__empty">Waiting for drivers</div>`;
  return players
    .map((player) => {
      const tags = [
        player.leader ? "Leader" : "",
        player.id === localId ? "You" : "",
        player.ready ? "Ready" : "Not ready",
      ].filter(Boolean);
      return `
        <div class="online-match__player ${player.id === localId ? "is-local" : ""}">
          <span>${player.name}</span>
          <small>${tags.join(" / ")}</small>
        </div>
      `;
    })
    .join("");
}

function leaderboard(room: OnlineRoomState | null, localId: string | null) {
  const players = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);
  if (!players.length) return "";
  return players
    .map(
      (player, index) => `
        <div class="online-board__row ${player.id === localId ? "is-local" : ""}">
          <strong>${index + 1}</strong>
          <span>${player.name}</span>
          <em>${formatScore(player.score)}</em>
          <small>x${player.multiplier.toFixed(1)}</small>
        </div>
      `,
    )
    .join("");
}

export function createOnlineMatchUi(callbacks: OnlineMatchUiCallbacks) {
  const root = document.createElement("div");
  root.className = "online-match";
  root.hidden = true;
  document.body.append(root);

  const modal = document.createElement("div");
  modal.className = "online-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="online-modal__panel">
      <h2>Drift Attack Online</h2>
      <p>Join an online drift attack session</p>
      <div class="online-modal__actions">
        <button type="button" data-create-room>Create New Room</button>
        <button type="button" data-join-code>Join with Code</button>
        <button type="button" data-cancel>Cancel</button>
      </div>
    </div>
  `;
  document.body.append(modal);

  const board = document.createElement("aside");
  board.className = "online-board";
  board.hidden = true;
  document.body.append(board);

  modal.querySelector("[data-create-room]")!.addEventListener("click", () => {
    modal.hidden = true;
    callbacks.onConnect(undefined); // Create new room
  });

  modal.querySelector("[data-join-code]")!.addEventListener("click", () => {
    modal.hidden = true;
    callbacks.onShowQueue(); // Show queue with room code input
  });

  modal.querySelector("[data-cancel]")!.addEventListener("click", () => {
    modal.hidden = true;
  });

  let latestRoom: OnlineRoomState | null = null;
  let localPlayerId: string | null = null;
  let status = "Offline";
  let preferredRoomCode = "";
  let connected = false;

  function renderQueue() {
    const roomCode = latestRoom?.roomCode ?? preferredRoomCode;
    const local = latestRoom?.players.find((player) => player.id === localPlayerId);
    const queueLeft = latestRoom ? secondsLeft(latestRoom.readyDeadline, latestRoom.serverNow) : driftReadySeconds;
    const countdown = latestRoom ? secondsLeft(latestRoom.matchStartAt, latestRoom.serverNow) : 0;
    const canReady = connected && !!latestRoom && (latestRoom.phase === "queue" || latestRoom.phase === "countdown");
    const readyLabel = local?.ready ? "Unready" : "Ready";
    const phaseText =
      latestRoom?.phase === "countdown"
        ? `Launching in ${countdown}s`
        : latestRoom?.phase === "queue"
          ? `Queue timer ${queueLeft}s`
          : latestRoom?.phase === "finished"
            ? "Run finished"
            : status;

    if (!root.querySelector(".online-match__panel")) {
      root.innerHTML = `
        <section class="online-match__panel">
          <div class="online-match__header">
            <p>Private Drift Queue Slab</p>
            <h2 data-phase></h2>
          </div>
          <label class="online-match__code">
            <span>Room code</span>
            <input type="text" data-room-code maxlength="6" placeholder="NEW ROOM" autocomplete="off" spellcheck="false" />
          </label>
          <div class="online-match__actions">
            <button type="button" data-connect></button>
            <button type="button" data-ready></button>
            <button type="button" data-leave>Leave</button>
          </div>
          <div class="online-match__meta">
            <span data-drivers></span>
            <span>E ready</span>
            <span>Esc leave</span>
            <span>Instanced pad</span>
            <span>90s Drift Attack</span>
          </div>
          <div class="online-match__players"></div>
        </section>
      `;
      const input = root.querySelector<HTMLInputElement>("[data-room-code]")!;
      input.addEventListener("input", () => {
        input.value = sanitizeRoomCode(input.value);
        preferredRoomCode = input.value;
      });
      root.querySelector("[data-connect]")!.addEventListener("click", () => callbacks.onConnect(input.value || undefined));
      root.querySelector("[data-ready]")!.addEventListener("click", () => callbacks.onReady(!local?.ready));
      root.querySelector("[data-leave]")!.addEventListener("click", callbacks.onLeave);
    }

    const input = root.querySelector<HTMLInputElement>("[data-room-code]")!;
    if (document.activeElement !== input) {
      input.value = roomCode;
    }
    root.querySelector("[data-phase]")!.textContent = phaseText;
    root.querySelector("[data-connect]")!.textContent = connected ? "Reconnect" : "Create / Join";
    const readyBtn = root.querySelector<HTMLButtonElement>("[data-ready]")!;
    readyBtn.textContent = readyLabel;
    readyBtn.disabled = !canReady;
    root.querySelector("[data-drivers]")!.textContent = `${latestRoom?.players.length ?? 0}/6 drivers`;
    root.querySelector(".online-match__players")!.innerHTML = playerRows(latestRoom, localPlayerId);
  }

  function renderBoard() {
    if (!latestRoom || (latestRoom.phase !== "racing" && latestRoom.phase !== "countdown" && latestRoom.phase !== "finished")) {
      board.hidden = true;
      return;
    }
    const runLeft = secondsLeft(latestRoom.matchEndsAt, latestRoom.serverNow);
    board.hidden = false;
    board.innerHTML = `
      <div class="online-board__header">
        <span>${latestRoom.roomCode}</span>
        <strong>${latestRoom.phase === "finished" ? "Final" : `${Math.min(driftMatchSeconds, runLeft)}s`}</strong>
      </div>
      ${leaderboard(latestRoom, localPlayerId)}
    `;
  }

  return {
    root,
    board,
    modal,
    show(roomCode?: string) {
      preferredRoomCode = sanitizeRoomCode(roomCode ?? preferredRoomCode);
      root.hidden = false;
      renderQueue();
    },
    showModal() {
      modal.hidden = false;
    },
    hideModal() {
      modal.hidden = true;
    },
    hideQueue() {
      root.hidden = true;
    },
    hideAll() {
      root.hidden = true;
      board.hidden = true;
      modal.hidden = true;
    },
    setStatus(next: string) {
      status = next;
      connected = next === "Connected" || !!latestRoom;
      renderQueue();
    },
    setLocalPlayer(id: string) {
      localPlayerId = id;
      renderQueue();
      renderBoard();
    },
    updateRoom(room: OnlineRoomState) {
      latestRoom = room;
      connected = true;
      preferredRoomCode = room.roomCode;
      renderQueue();
      renderBoard();
    },
  };
}
