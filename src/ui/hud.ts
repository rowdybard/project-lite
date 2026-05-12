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
      <span>Car <strong>240SX</strong></span>
      <span>Mode <strong>Free drift</strong></span>
      <span>Surface <strong data-surface>Track</strong></span>
      <span>Grip <strong data-grip>100%</strong></span>
      <span>Heat <strong data-heat>0%</strong></span>
      <span>Load <strong data-load>50F/50R</strong></span>
      <span>Angle <strong data-angle>0 deg</strong></span>
      <span>Drift <strong data-total-drift>0.0s</strong></span>
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
    <div class="hud__hint">WASD/Arrows drive - Space/Shift/E handbrake - R reset - T tune</div>
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
      root.querySelector("[data-total-drift]")!.textContent = formatTime(drift.totalDriftTime);
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
