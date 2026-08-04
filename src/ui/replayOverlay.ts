import { getCarLabel } from "../game/customization";
import type { LeaderboardEntry } from "../net/protocol";

const score = (value: number) => Math.round(value).toLocaleString("en-US");

export function createReplayOverlay(onExit: () => void) {
  const root = document.createElement("div");
  root.className = "replay-overlay";
  root.hidden = true;
  root.innerHTML = `
    <section class="replay-overlay__info">
      <p data-replay-label>Leaderboard replay</p>
      <h2 data-replay-driver>Driver</h2>
      <div class="replay-overlay__stats">
        <span data-replay-score>0 pts</span>
        <span data-replay-distance>0 m</span>
        <span data-replay-gates>0 gates</span>
        <span data-replay-car>Car</span>
      </div>
      <progress data-replay-progress max="1" value="0"></progress>
    </section>
    <button data-replay-exit type="button">Exit Replay</button>
  `;
  document.body.append(root);
  root.querySelector("[data-replay-exit]")!.addEventListener("click", onExit);

  return {
    root,
    show(entry: LeaderboardEntry, versionWarning = false) {
      root.hidden = false;
      root.querySelector("[data-replay-label]")!.textContent = versionWarning
        ? "Replay · physics version differs · corrections active"
        : "Leaderboard replay · follow camera";
      root.querySelector("[data-replay-driver]")!.textContent = entry.playerName;
      root.querySelector("[data-replay-score]")!.textContent = `${score(entry.score)} pts`;
      root.querySelector("[data-replay-distance]")!.textContent = `${Math.round(entry.distance).toLocaleString("en-US")} m`;
      root.querySelector("[data-replay-gates]")!.textContent = `${entry.gatesPassed} gates`;
      root.querySelector("[data-replay-car]")!.textContent = getCarLabel(entry.carId);
      (root.querySelector("[data-replay-progress]") as HTMLProgressElement).value = 0;
    },
    update(elapsed: number, duration: number) {
      const progress = root.querySelector("[data-replay-progress]") as HTMLProgressElement;
      progress.value = duration > 0 ? Math.min(1, elapsed / duration) : 0;
    },
    setFinished() {
      root.querySelector("[data-replay-label]")!.textContent = "Replay complete · exit or watch again from the board";
    },
    hide() {
      root.hidden = true;
    },
  };
}
