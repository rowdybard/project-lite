import type { CarState, DriftState } from "../game/types";

const formatScore = (value: number) => Math.round(value).toLocaleString("en-US");
const formatTime = (seconds: number) => `${seconds.toFixed(1)}s`;

export function createHud() {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <div class="hud__cluster">
      <div class="hud__label">Speed</div>
      <div class="hud__speed"><span data-speed>0</span><small>mph</small></div>
      <div class="hud__gear"><span data-gear>1</span><strong data-rpm>850</strong> rpm</div>
      <div class="hud__rpm"><span data-rpm-bar></span></div>
    </div>
    <div class="hud__strip">
      <span>Time <strong data-time>90.0s</strong></span>
      <span>Surface <strong data-surface>Track</strong></span>
      <span>Grip <strong data-grip>100%</strong></span>
      <span>Heat <strong data-heat>0%</strong></span>
      <span>Load <strong data-load>50F/50R</strong></span>
      <span>Angle <strong data-angle>0 deg</strong></span>
    </div>
    <div class="hud__slip"><span data-slip></span></div>
    <div class="drift-score">
      <div class="drift-score__label">Drift score</div>
      <div class="drift-score__total" data-total-score>0</div>
      <div class="drift-score__combo">
        <span data-combo-score>+0</span>
        <strong data-multiplier>x1.0</strong>
      </div>
      <div class="drift-score__meta">
        <span>Chain <strong data-chain>0.0s</strong></span>
        <span>Best <strong data-best-run>0</strong></span>
      </div>
      <div class="drift-score__callout" data-callout hidden>Drift</div>
    </div>
    <div class="hud__hint">R restart</div>
  `;
  document.body.append(root);

  return {
    root,
    update(car: CarState, drift: DriftState) {
      root.querySelector("[data-speed]")!.textContent = Math.round(car.speed * 2.237).toString();
      root.querySelector("[data-gear]")!.textContent = car.gear.toString();
      root.querySelector("[data-rpm]")!.textContent = Math.round(car.rpm).toString();
      (root.querySelector("[data-rpm-bar]") as HTMLElement).style.transform = `scaleX(${Math.min(1, car.rpm / 6900)})`;
      root.querySelector("[data-surface]")!.textContent = drift.onTrack ? "Track" : "Off";
      root.querySelector("[data-grip]")!.textContent = `${Math.round(car.gripAmount * 100)}%`;
      root.querySelector("[data-heat]")!.textContent = `${Math.round(car.tireHeat * 100)}%`;
      root.querySelector("[data-load]")!.textContent =
        `${Math.round(car.weightForward * 100)}F/${Math.round((1 - car.weightForward) * 100)}R`;
      root.querySelector("[data-angle]")!.textContent = `${Math.round(car.slipAngle)} deg`;
      (root.querySelector("[data-slip]") as HTMLElement).style.transform = `scaleX(${car.slipAmount})`;
      root.querySelector("[data-total-score]")!.textContent = formatScore(drift.totalScore + drift.comboScore);
      root.querySelector("[data-combo-score]")!.textContent = `+${formatScore(drift.comboScore)}`;
      root.querySelector("[data-multiplier]")!.textContent = `x${drift.multiplier.toFixed(1)}`;
      root.querySelector("[data-chain]")!.textContent = formatTime(drift.driftTime);
      root.querySelector("[data-best-run]")!.textContent = formatScore(drift.bestRun);

      const callout = root.querySelector("[data-callout]") as HTMLElement;
      callout.textContent = drift.calloutTimer > 0 ? drift.callout : drift.grade;
      callout.hidden = drift.calloutTimer <= 0 && !drift.active;
    },
    updateTimer(secondsRemaining: number) {
      root.querySelector("[data-time]")!.textContent = `${Math.max(0, secondsRemaining).toFixed(1)}s`;
    },
  };
}

export function createSessionOverlay(onPlay: () => void, onRestart: () => void, tunePanel: HTMLElement) {
  const root = document.createElement("div");
  root.className = "session-overlay";
  root.innerHTML = `
    <section class="session-card" data-menu>
      <p class="session-card__eyebrow">Project Lite</p>
      <h1>Training Circuit</h1>
      <p>90 seconds. Stay on asphalt, link clean angle, bank the biggest combo.</p>
      <div class="session-card__actions">
        <button data-play type="button">Play</button>
        <button class="session-card__secondary" data-options type="button">Options</button>
      </div>
    </section>
    <section class="session-card session-card--options" data-options-panel hidden>
      <p class="session-card__eyebrow">Garage</p>
      <h1>Options</h1>
      <div data-tune-slot></div>
      <div class="session-card__actions">
        <button data-options-play type="button">Play</button>
        <button class="session-card__secondary" data-options-back type="button">Back</button>
      </div>
    </section>
    <section class="session-card session-card--end" data-end hidden>
      <p class="session-card__eyebrow">Run Complete</p>
      <div class="session-card__score-label">Final score</div>
      <h1 data-final-score>0</h1>
      <div class="session-card__stats">
        <span>Best combo <strong data-final-combo>0</strong></span>
        <span>Best run <strong data-final-best>0</strong></span>
      </div>
      <div class="session-card__actions">
        <button data-restart type="button">Restart</button>
        <button class="session-card__secondary" data-end-options type="button">Options</button>
      </div>
    </section>
  `;
  document.body.append(root);

  const menu = root.querySelector("[data-menu]") as HTMLElement;
  const options = root.querySelector("[data-options-panel]") as HTMLElement;
  const end = root.querySelector("[data-end]") as HTMLElement;
  const tuneSlot = root.querySelector("[data-tune-slot]") as HTMLElement;
  tunePanel.hidden = false;
  tuneSlot.append(tunePanel);
  root.querySelector("[data-play]")!.addEventListener("click", onPlay);
  root.querySelector("[data-options-play]")!.addEventListener("click", onPlay);
  root.querySelector("[data-restart]")!.addEventListener("click", onRestart);
  root.querySelector("[data-options]")!.addEventListener("click", () => {
    menu.hidden = true;
    options.hidden = false;
    end.hidden = true;
  });
  root.querySelector("[data-options-back]")!.addEventListener("click", () => {
    menu.hidden = false;
    options.hidden = true;
    end.hidden = true;
  });
  root.querySelector("[data-end-options]")!.addEventListener("click", () => {
    menu.hidden = true;
    options.hidden = false;
    end.hidden = true;
  });

  return {
    root,
    showMenu() {
      root.hidden = false;
      menu.hidden = false;
      options.hidden = true;
      end.hidden = true;
    },
    showOptions() {
      root.hidden = false;
      menu.hidden = true;
      options.hidden = false;
      end.hidden = true;
    },
    hide() {
      root.hidden = true;
    },
    showEnd(finalScore: number, bestCombo: number, bestRun: number) {
      root.hidden = false;
      menu.hidden = true;
      options.hidden = true;
      end.hidden = false;
      root.querySelector("[data-final-score]")!.textContent = formatScore(finalScore);
      root.querySelector("[data-final-combo]")!.textContent = formatScore(bestCombo);
      root.querySelector("[data-final-best]")!.textContent = formatScore(bestRun);
    },
  };
}

export function createTunePanel() {
  const panel = document.createElement("aside");
  panel.className = "tune-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Drift Preset</h2>
    <p>Only touch these once the default feel annoys you in a specific way. Permanent values live in <code>public/assets/cars/starter/tuning.json</code>.</p>
    <div data-tune-fields></div>
  `;
  document.body.append(panel);
  return panel;
}
