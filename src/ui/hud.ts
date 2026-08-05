import type { CarState, DriftState } from "../game/types";

export type EndlessHudStats = {
  stage: number;
  gatesPassed: number;
  distance: number;
  nextGateDistance: number;
  potential: number;
  objective: string;
  objectiveProgress: string;
  bestDelta: number;
  risk: "Low" | "Medium" | "High";
};

export type EndlessResults = {
  finalScore: number;
  bestCombo: number;
  stage: number;
  gatesPassed: number;
  distance: number;
  duration: number;
  failReason: "crash" | "clock" | "quit";
  objectivesCompleted: number;
  isPersonalBest: boolean;
  bestScore: number;
  nextTarget: string;
};

const formatScore = (value: number) => Math.round(value).toLocaleString("en-US");
const formatTime = (seconds: number) => `${seconds.toFixed(1)}s`;
const forwardSpeed = (car: CarState) =>
  car.velocity.x * Math.sin(car.heading) + car.velocity.z * Math.cos(car.heading);

export function createHud() {
  const root = document.createElement("div");
  root.className = "hud";
  root.innerHTML = `
    <div class="hud__strip">
      <span>Car <strong data-car-name>Lite Coupe</strong></span>
      <span><em data-time-label>Time</em> <strong data-time>90.0s</strong></span>
      <span>Surface <strong data-surface>Track</strong></span>
      <span>Grip <strong data-grip>100%</strong></span>
      <span>Heat <strong data-heat>0%</strong></span>
      <span>Load <strong data-load>50F/50R</strong></span>
      <span>Angle <strong data-angle>0 deg</strong></span>
      <span>Rear Slip <strong data-rear-slip>0 deg</strong></span>
    </div>
    <div class="drift-score">
      <div class="drift-score__label">Banked</div>
      <div class="drift-score__total" data-total-score>0</div>
      <div class="drift-score__combo">
        <span>Live</span>
        <b data-combo-score>+0</b>
      </div>
      <div class="drift-score__status">
        <strong data-multiplier>x1.0</strong>
        <span data-tier>Tier 1 Initiate</span>
        <span data-chain>Ready</span>
      </div>
      <div class="drift-score__callout" data-callout hidden>Drift</div>
    </div>
    <section class="endless-hud" data-endless-panel hidden>
      <div class="endless-hud__topline">
        <span>Stage <strong data-endless-stage>1</strong></span>
        <span>Gates <strong data-endless-gates>0</strong></span>
        <span>Distance <strong data-endless-distance>0 m</strong></span>
        <span>Next gate <strong data-endless-next-gate>--</strong></span>
      </div>
      <div class="endless-hud__objective">
        <span>Objective</span>
        <strong data-endless-objective>Find your flow</strong>
        <em data-endless-progress>0%</em>
      </div>
      <div class="endless-hud__risk" data-endless-risk>
        <span>Potential <strong data-endless-potential>+0</strong></span>
        <span>Best <strong data-endless-delta>Even</strong></span>
        <span>Risk <strong data-endless-risk-label>Low</strong></span>
      </div>
    </section>
    <div class="speedometer">
      <div class="speedometer__gear" data-gear>1</div>
      <div class="speedometer__readout"><span data-speed>0</span><small>mph</small></div>
      <div class="speedometer__rpm-text"><strong data-rpm>850</strong> rpm</div>
      <div class="speedometer__tach"><span data-rpm-bar></span></div>
    </div>
    <div class="hud__hint" data-hint>R restart</div>
  `;
  document.body.append(root);

  let mode: "online-lobby" | "drift-attack" | "endless" | "free-drive" = "drift-attack";

  return {
    root,
    update(car: CarState, drift: DriftState) {
      root.querySelector("[data-speed]")!.textContent = Math.round(car.speed * 2.237).toString();
      root.querySelector("[data-gear]")!.textContent =
        car.reverseEngageTimer > 0.48 || forwardSpeed(car) < -0.5 ? "R" : car.gear.toString();
      root.querySelector("[data-rpm]")!.textContent = Math.round(car.rpm).toString();
      (root.querySelector("[data-rpm-bar]") as HTMLElement).style.transform = `scaleX(${Math.min(1, car.rpm / 6900)})`;
      root.querySelector("[data-surface]")!.textContent = drift.onTrack ? "Track" : "Off";
      root.querySelector("[data-grip]")!.textContent = `${Math.round(car.gripAmount * 100)}%`;
      root.querySelector("[data-heat]")!.textContent = `${Math.round(car.tireHeat * 100)}%`;
      root.querySelector("[data-load]")!.textContent =
        `${Math.round(car.weightForward * 100)}F/${Math.round((1 - car.weightForward) * 100)}R`;
      root.querySelector("[data-angle]")!.textContent = `${Math.round(car.slipAngle)} deg`;
      root.querySelector("[data-rear-slip]")!.textContent = `${Math.round(Math.abs(car.rearSlipAngle))} deg`;
      root.querySelector("[data-total-score]")!.textContent = formatScore(drift.totalScore);
      root.querySelector("[data-combo-score]")!.textContent = `+${formatScore(drift.comboScore)}`;
      root.querySelector("[data-multiplier]")!.textContent = `x${drift.multiplier.toFixed(1)}`;
      root.querySelector("[data-tier]")!.textContent = `Tier ${drift.tier + 1} ${drift.tierName}`;
      root.querySelector("[data-chain]")!.textContent = drift.active ? `${formatTime(drift.driftTime)} chain` : "Ready";

      const callout = root.querySelector("[data-callout]") as HTMLElement;
      callout.textContent = drift.callout;
      callout.hidden = drift.calloutTimer <= 0;
    },
    updateTimer(secondsRemaining: number) {
      root.querySelector("[data-time-label]")!.textContent = mode === "endless" ? "Clock" : "Time";
      root.querySelector("[data-time]")!.textContent = Number.isFinite(secondsRemaining)
        ? `${Math.max(0, secondsRemaining).toFixed(1)}s`
        : "Free";
      root.classList.toggle("is-clock-critical", mode === "endless" && secondsRemaining <= 10);
    },
    setCarName(name: string) {
      root.querySelector("[data-car-name]")!.textContent = name;
    },
    setMode(nextMode: "online-lobby" | "drift-attack" | "endless" | "free-drive") {
      mode = nextMode;
      root.classList.toggle("is-free-drive", mode === "free-drive");
      root.classList.toggle("is-online-lobby", mode === "online-lobby");
      root.classList.toggle("is-endless", mode === "endless");
      (root.querySelector("[data-endless-panel]") as HTMLElement).hidden = mode !== "endless";
      root.querySelector("[data-hint]")!.textContent =
        mode === "online-lobby"
          ? "Drive onto a trailer - E confirm - R reset - Esc garage"
          : mode === "endless"
            ? "Pass gates for time - heavy crashes end the run - R retry - Esc garage"
          : mode === "free-drive"
            ? "R reset zone - C next zone - Esc garage"
            : "R restart";
    },
    setEndlessStats(stats: EndlessHudStats) {
      root.querySelector("[data-endless-stage]")!.textContent = stats.stage.toString();
      root.querySelector("[data-endless-gates]")!.textContent = stats.gatesPassed.toString();
      root.querySelector("[data-endless-distance]")!.textContent = `${Math.round(stats.distance).toLocaleString("en-US")} m`;
      root.querySelector("[data-endless-next-gate]")!.textContent = Number.isFinite(stats.nextGateDistance)
        ? `${Math.max(0, Math.round(stats.nextGateDistance))} m`
        : "--";
      root.querySelector("[data-endless-potential]")!.textContent = `+${formatScore(stats.potential)}`;
      root.querySelector("[data-endless-objective]")!.textContent = stats.objective;
      root.querySelector("[data-endless-progress]")!.textContent = stats.objectiveProgress;
      root.querySelector("[data-endless-delta]")!.textContent = stats.bestDelta === 0
        ? "Even"
        : `${stats.bestDelta > 0 ? "+" : ""}${formatScore(stats.bestDelta)}`;
      root.querySelector("[data-endless-risk-label]")!.textContent = stats.risk;
      (root.querySelector("[data-endless-risk]") as HTMLElement).dataset.risk = stats.risk.toLowerCase();
    },
    setPracticeZone(label: string) {
      root.querySelector("[data-time-label]")!.textContent = "Zone";
      root.querySelector("[data-time]")!.textContent = label;
    },
    setOnlineStatus(label: string) {
      root.querySelector("[data-time-label]")!.textContent = "Online";
      root.querySelector("[data-time]")!.textContent = label;
    },
  };
}

export function createEndlessResultsOverlay(callbacks: {
  onRetry: () => void;
  onDailyRetry: () => void;
  onGarage: () => void;
}) {
  const root = document.createElement("div");
  root.className = "session-overlay endless-results";
  root.hidden = true;
  root.innerHTML = `
    <section class="session-card session-card--endless">
      <p class="session-card__eyebrow" data-endless-end-reason>Run Complete</p>
      <div class="session-card__score-label">Final score</div>
      <h1 data-endless-final-score>0</h1>
      <p class="endless-results__pb" data-endless-pb></p>
      <div class="session-card__stats endless-results__stats">
        <span>Best combo <strong data-endless-final-combo>0</strong></span>
        <span>Highest stage <strong data-endless-final-stage>1</strong></span>
        <span>Distance <strong data-endless-final-distance>0 m</strong></span>
        <span>Gates <strong data-endless-final-gates>0</strong></span>
        <span>Survived <strong data-endless-final-duration>0.0s</strong></span>
        <span>Objectives <strong data-endless-final-objectives>0</strong></span>
      </div>
      <div class="endless-results__target">
        <span>Next target</span>
        <strong data-endless-next-target>Beat this score</strong>
      </div>
      <p class="endless-results__submission" data-endless-submission>Saving run...</p>
      <div class="session-card__actions endless-results__actions">
        <button data-endless-retry type="button">Run Again</button>
        <button data-endless-daily type="button">Daily Seed</button>
        <button class="session-card__secondary" data-endless-garage type="button">Garage</button>
      </div>
    </section>
  `;
  document.body.append(root);
  root.querySelector("[data-endless-retry]")!.addEventListener("click", callbacks.onRetry);
  root.querySelector("[data-endless-daily]")!.addEventListener("click", callbacks.onDailyRetry);
  root.querySelector("[data-endless-garage]")!.addEventListener("click", callbacks.onGarage);

  return {
    root,
    show(summary: EndlessResults) {
      root.hidden = false;
      root.querySelector("[data-endless-end-reason]")!.textContent = summary.failReason === "crash"
        ? "Run ended - heavy crash"
        : summary.failReason === "clock"
          ? "Run ended - clock expired"
          : "Run ended";
      root.querySelector("[data-endless-final-score]")!.textContent = formatScore(summary.finalScore);
      root.querySelector("[data-endless-final-combo]")!.textContent = formatScore(summary.bestCombo);
      root.querySelector("[data-endless-final-stage]")!.textContent = summary.stage.toString();
      root.querySelector("[data-endless-final-distance]")!.textContent = `${Math.round(summary.distance).toLocaleString("en-US")} m`;
      root.querySelector("[data-endless-final-gates]")!.textContent = summary.gatesPassed.toString();
      root.querySelector("[data-endless-final-duration]")!.textContent = formatTime(summary.duration);
      root.querySelector("[data-endless-final-objectives]")!.textContent = summary.objectivesCompleted.toString();
      root.querySelector("[data-endless-next-target]")!.textContent = summary.nextTarget;
      root.querySelector("[data-endless-pb]")!.textContent = summary.isPersonalBest
        ? "New personal best"
        : `Personal best ${formatScore(summary.bestScore)}`;
      root.querySelector("[data-endless-pb]")!.classList.toggle("is-pb", summary.isPersonalBest);
      root.querySelector("[data-endless-submission]")!.textContent = "Saving run...";
    },
    setSubmission(message: string, isError = false) {
      const status = root.querySelector("[data-endless-submission]") as HTMLElement;
      status.textContent = message;
      status.classList.toggle("is-error", isError);
    },
    hide() {
      root.hidden = true;
    },
  };
}

export function createResultsOverlay(onRestart: () => void, onGarage: () => void) {
  const root = document.createElement("div");
  root.className = "session-overlay";
  root.hidden = true;
  root.innerHTML = `
    <section class="session-card session-card--end">
      <p class="session-card__eyebrow">Run Complete</p>
      <div class="session-card__score-label">Final score</div>
      <h1 data-final-score>0</h1>
      <div class="session-card__stats">
        <span>Best combo <strong data-final-combo>0</strong></span>
        <span>Best run <strong data-final-best>0</strong></span>
      </div>
      <div class="session-card__actions">
        <button data-restart type="button">Restart</button>
        <button class="session-card__secondary" data-garage type="button">Garage</button>
      </div>
    </section>
  `;
  document.body.append(root);
  root.querySelector("[data-restart]")!.addEventListener("click", onRestart);
  root.querySelector("[data-garage]")!.addEventListener("click", onGarage);

  return {
    root,
    show(finalScore: number, bestCombo: number, bestRun: number) {
      root.hidden = false;
      root.querySelector("[data-final-score]")!.textContent = formatScore(finalScore);
      root.querySelector("[data-final-combo]")!.textContent = formatScore(bestCombo);
      root.querySelector("[data-final-best]")!.textContent = formatScore(bestRun);
    },
    hide() {
      root.hidden = true;
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
