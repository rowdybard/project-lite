import "./style.css";
import { Clock } from "three";
import { createCamera, updateChaseCamera } from "./render/app/camera";
import { createRenderer } from "./render/app/createRenderer";
import { createScene } from "./render/app/createScene";
import { createTrackView } from "./render/objects/trackView";
import { createCarView } from "./render/objects/carView";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTireSmoke } from "./render/objects/tireSmoke";
import { loadGltf } from "./render/loaders/loadGltf";
import { bindInput, readInput } from "./game/input/inputMap";
import { loadJson, loadManifest } from "./game/content/manifest";
import { createCarState, keepCarNearTrack, resetCar, updateCar } from "./game/simulation/car";
import { createDriftState, finishDriftRun, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { getDriftZone, isOnTrack } from "./game/simulation/trackSurface";
import { createHud, createSessionOverlay, createTunePanel } from "./ui/hud";
import { hydrateTuningPanel } from "./ui/tuningPanel";
import type { CarTuning } from "./game/types";

async function boot() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = '<canvas id="game"></canvas>';

  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus());
  canvas.focus();
  const renderer = createRenderer(canvas);
  const scene = createScene();
  const camera = createCamera();
  const clock = new Clock();

  const manifest = await loadManifest();
  const carEntry = manifest.cars[manifest.activeCar];
  const track = manifest.tracks[manifest.activeTrack];
  const tuning = await loadJson<CarTuning>(carEntry.tuning);

  await createTrackView(scene, track);
  const carModel = await loadGltf(carEntry.model);
  const carView = createCarView(carModel, carEntry.scale ?? 1);
  const tireTracks = createTireTracks();
  const tireSmoke = createTireSmoke();
  scene.add(tireTracks.root);
  scene.add(tireSmoke.root);
  scene.add(carView.root);

  const car = createCarState(track);
  const drift = createDriftState();
  const hud = createHud();
  const runLength = 90;
  let sessionState: "menu" | "running" | "ended" = "menu";
  let sessionTime = runLength;
  let cameraShake = 0;
  const tunePanel = createTunePanel();
  hydrateTuningPanel(tunePanel, tuning);
  bindInput();

  const resetRun = () => {
    resetCar(car, track);
    resetDrift(drift);
    tireTracks.reset();
    tireSmoke.reset();
    sessionTime = runLength;
    cameraShake = 0;
  };

  const startRun = () => {
    resetRun();
    sessionState = "running";
    overlay.hide();
    canvas.focus();
  };

  const finishRun = () => {
    const finalScore = finishDriftRun(drift);
    sessionState = "ended";
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    overlay.showEnd(finalScore, drift.bestCombo, drift.bestRun);
  };

  const overlay = createSessionOverlay(startRun, startRun);
  overlay.showMenu();

  const onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    document.body.classList.add("context-lost");
  });

  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const input = readInput();

    if (input.debug) tunePanel.hidden = !tunePanel.hidden;
    if (input.reset) {
      if (sessionState === "running") {
        startRun();
      } else {
        resetRun();
        sessionState = "menu";
        overlay.showMenu();
      }
    }

    const isRunning = sessionState === "running";
    if (isRunning) {
      sessionTime -= dt;
      if (sessionTime <= 0) {
        sessionTime = 0;
        finishRun();
      }
    }

    const driveInput = isRunning ? input : { ...input, throttle: 0, brake: 1, steer: 0, handbrake: false };
    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < substeps; i++) {
      updateCar(car, driveInput, tuning, dt / substeps, isOnTrack(car.position, track));
    }
    const onTrack = isOnTrack(car.position, track);
    const impact = keepCarNearTrack(car, track);
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (impact > 0) cameraShake = Math.max(cameraShake, impact * 0.75);
    if (isRunning) updateDriftScore(drift, car, dt, onTrack, getDriftZone(car.position, track));
    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    updateChaseCamera(camera, car, dt, cameraShake);
    hud.update(car, drift);
    hud.updateTimer(sessionTime);
    renderer.render(scene, camera);

    requestAnimationFrame(frame);
  }

  frame();
}

boot().catch((error) => {
  console.error(error);
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <main class="boot-error">
      <h1>Prototype failed to boot</h1>
      <pre>${error instanceof Error ? error.message : String(error)}</pre>
    </main>
  `;
});
