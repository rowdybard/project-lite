import { getCarLabel } from "../game/customization";
import type { LeaderboardBoard, LeaderboardEntry, LeaderboardResponse } from "../net/protocol";

type LeaderboardClientLike<TReplay> = {
  fetchBoard(board: LeaderboardBoard, limit?: number): Promise<LeaderboardResponse>;
  fetchReplay(id: string): Promise<TReplay>;
};

const formatScore = (value: number) => Math.round(value).toLocaleString("en-US");
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

function resetCountdown(resetAt: number) {
  const remaining = Math.max(0, resetAt - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function createLeaderboardUi<TReplay>(
  client: LeaderboardClientLike<TReplay>,
  callbacks: {
    onWatch: (entry: LeaderboardEntry, replay: TReplay) => void | Promise<void>;
    onClose: () => void;
  },
) {
  const root = document.createElement("div");
  root.className = "leaderboard-ui";
  root.hidden = true;
  root.innerHTML = `
    <section class="leaderboard-panel" aria-label="Endless drift leaderboards">
      <header class="leaderboard-header">
        <div>
          <p>Endless Drift</p>
          <h1>Leaderboards + Replays</h1>
        </div>
        <button data-board-close type="button" aria-label="Close leaderboards">Close</button>
      </header>
      <nav class="leaderboard-tabs" aria-label="Leaderboard board">
        <button data-board-tab="daily" type="button">Daily Seed</button>
        <button data-board-tab="all-time" type="button">All-Time</button>
      </nav>
      <div class="leaderboard-list" data-board-list aria-live="polite"></div>
      <footer class="leaderboard-footer">
        <span data-board-meta>Loading board...</span>
        <button data-board-refresh type="button">Refresh</button>
      </footer>
    </section>
  `;
  document.body.append(root);

  const list = root.querySelector("[data-board-list]") as HTMLElement;
  const meta = root.querySelector("[data-board-meta]") as HTMLElement;
  let activeBoard: LeaderboardBoard = "daily";
  let requestToken = 0;
  let resetAt = 0;
  let countdownId = 0;

  function updateTabs() {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-board-tab]")) {
      const selected = button.dataset.boardTab === activeBoard;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function updateMeta(response?: LeaderboardResponse) {
    if (response) resetAt = response.dailyResetAt;
    if (activeBoard === "daily") {
      meta.textContent = response
        ? `Seed ${response.dailySeed >>> 0} · resets in ${resetCountdown(response.dailyResetAt)}`
        : `Daily board · resets in ${resetCountdown(resetAt)}`;
    } else {
      meta.textContent = response ? `${response.total.toLocaleString("en-US")} recorded runs` : "All-time endless runs";
    }
  }

  function renderRows(response: LeaderboardResponse) {
    list.replaceChildren();
    if (response.entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "leaderboard-empty";
      empty.textContent = "No runs yet. Set the first target.";
      list.append(empty);
      return;
    }

    response.entries.forEach((entry, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "leaderboard-row";
      row.title = `Watch ${entry.playerName}'s replay`;
      const values = [
        `#${index + 1}`,
        entry.playerName,
        formatScore(entry.score),
        `${Math.round(entry.distance).toLocaleString("en-US")} m`,
        `${entry.gatesPassed} gates`,
        formatDuration(entry.duration),
        getCarLabel(entry.carId),
      ];
      values.forEach((value, valueIndex) => {
        const cell = document.createElement(valueIndex === 2 ? "strong" : valueIndex > 2 ? "small" : "span");
        cell.textContent = value;
        row.append(cell);
      });
      row.addEventListener("click", async () => {
        const token = ++requestToken;
        meta.textContent = `Loading ${entry.playerName}'s replay...`;
        row.disabled = true;
        try {
          const replay = await client.fetchReplay(entry.id);
          if (token !== requestToken) return;
          await callbacks.onWatch(entry, replay);
        } catch (error) {
          if (token !== requestToken) return;
          meta.textContent = error instanceof Error ? error.message : "Could not load replay.";
          row.disabled = false;
        }
      });
      list.append(row);
    });
  }

  async function refresh() {
    const token = ++requestToken;
    updateTabs();
    list.innerHTML = '<p class="leaderboard-empty">Loading runs...</p>';
    meta.textContent = "Connecting to leaderboard...";
    try {
      const response = await client.fetchBoard(activeBoard, 50);
      if (token !== requestToken) return;
      renderRows(response);
      updateMeta(response);
    } catch (error) {
      if (token !== requestToken) return;
      list.innerHTML = '<p class="leaderboard-empty">Leaderboard unavailable.</p>';
      meta.textContent = error instanceof Error ? error.message : "Could not load the leaderboard.";
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-board-tab]")) {
    button.addEventListener("click", () => {
      activeBoard = button.dataset.boardTab as LeaderboardBoard;
      void refresh();
    });
  }
  root.querySelector("[data-board-refresh]")!.addEventListener("click", () => void refresh());
  root.querySelector("[data-board-close]")!.addEventListener("click", () => {
    root.hidden = true;
    requestToken += 1;
    callbacks.onClose();
  });

  return {
    root,
    show(board: LeaderboardBoard = activeBoard) {
      activeBoard = board;
      root.hidden = false;
      window.clearInterval(countdownId);
      countdownId = window.setInterval(() => {
        if (!root.hidden && resetAt > 0) updateMeta();
      }, 30_000);
      void refresh();
    },
    hide() {
      root.hidden = true;
      requestToken += 1;
      window.clearInterval(countdownId);
    },
    refresh,
  };
}
