import "./style.css";
import { Clock } from "three";
import {
  applyTuningPreset,
  carTuningPaths,
  getCarLabel,
  loadCarCustomization,
  loadCustomization,
  saveCustomization,
  type CarCustomization,
  type ModeId,
} from "./game/customization";
import { loadJson, loadManifest } from "./game/content/manifest";
import { bindInput, readInput } from "./game/input/inputMap";
import { createCarState, keepCarNearTrack, resetCar, updateCar } from "./game/simulation/car";
import { createDriftState, finishDriftRun, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { getDriftZone, isInRunoff, isOnTrack } from "./game/simulation/trackSurface";
import type { CarTuning } from "./game/types";
import { createCamera, updateChaseCamera } from "./render/app/camera";
import { createRenderer } from "./render/app/createRenderer";
import { createScene } from "./render/app/createScene";
import { createGarageView } from "./render/garage/garageView";
import { createCarView } from "./render/objects/carView";
import { createTireSmoke } from "./render/objects/tireSmoke";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTrackView } from "./render/objects/trackView";
import { createGarageUi } from "./ui/garageUi";
import { createHud, createResultsOverlay } from "./ui/hud";
import { createAttachmentTuner } from "./ui/attachmentTuner";
import { isImportedCar } from "./render/objects/importedCars";
import { createEngineSound } from "./audio/engineSound";
import { createTrackColliders, updateTrackCollision } from "./game/simulation/trackCollision";
import type { Cone } from "./game/simulation/trackCollision";
import type { Mesh } from "three";

type AppState = "garage" | "event" | "results";

async function boot() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = '<canvas id="game"></canvas>';

  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus());
  canvas.focus();

  const renderer = createRenderer(canvas);
  const gameScene = createScene();
  const gameCamera = createCamera();
  const clock = new Clock();

  const manifest = await loadManifest();
  const carEntry = manifest.cars[manifest.activeCar];
  const track = manifest.tracks[manifest.activeTrack];
  const tuningCache = new Map<string, CarTuning>();
  async function loadCarTuning(carId: string): Promise<CarTuning> {
    const cached = tuningCache.get(carId);
    if (cached) return cached;
    const path = carTuningPaths[carId] ?? carEntry.tuning;
    const tuning = await loadJson<CarTuning>(path);
    tuningCache.set(carId, tuning);
    return tuning;
  }
  let customization: CarCustomization = loadCustomization();
  let baseTuning = await loadCarTuning(customization.selectedCar);
  let activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);

  const trackView = await createTrackView(gameScene, track);
  const colliders = createTrackColliders(track);
  const coneMeshes = trackView.coneMeshes;
  const carView = createCarView(carEntry.scale ?? 1);
  carView.applyCustomization(customization);
  const tireTracks = createTireTracks();
  const tireSmoke = createTireSmoke();
  gameScene.add(tireTracks.root, tireSmoke.root, carView.root);

  const car = createCarState(track);
  const drift = createDriftState();
  const hud = createHud();
  const setHudCarName = () => {
    hud.setCarName(getCarLabel(customization.selectedCar) ?? carEntry.name);
  };
  setHudCarName();
  hud.root.hidden = true;

  const garageView = createGarageView(canvas, renderer, customization);
  const attachmentTuner = createAttachmentTuner((att) => {
    carView.applyAttachments(att);
    garageView.carView.applyAttachments(att);
  });
  if (isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
  const runLength = 90;
  let appState: AppState = "garage";
  let activeMode: ModeId = customization.selectedMode;
  let sessionTime = runLength;
  let cameraShake = 0;
  let runoffTime = 0;

  const resetEvent = () => {
    resetCar(car, track);
    resetDrift(drift);
    tireTracks.reset();
    tireSmoke.reset();
    sessionTime = activeMode === "drift-attack" ? runLength : Infinity;
    cameraShake = 0;
    runoffTime = 0;
    carView.applyCustomization(customization);
  };

  const showGarage = () => {
    appState = "garage";
    results.hide();
    hud.root.hidden = true;
    garageUi.show();
    garageView.applyCustomization(customization);
    if (isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
    else attachmentTuner.hide();
  };

  const startEvent = async () => {
    if (customization.selectedMode === "drag-race" || customization.selectedMode === "lap-race") return;
    activeMode = customization.selectedMode;
    baseTuning = await loadCarTuning(customization.selectedCar);
    activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
    appState = "event";
    results.hide();
    hud.root.hidden = false;
    garageUi.hide();
    attachmentTuner.hide();
    resetEvent();
    setHudCarName();
    hud.setMode(activeMode === "free-drive" ? "free-drive" : "drift-attack");
    canvas.focus();
  };

  const finishRun = () => {
    const finalScore = finishDriftRun(drift);
    appState = "results";
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    hud.root.hidden = true;
    results.show(finalScore, drift.bestCombo, drift.bestRun);
  };

  const garageUi = createGarageUi(customization, {
    onCustomizationChange(slot, value) {
      if (slot === "selectedCar") {
        // Load saved per-car customization for the new car
        const saved = loadCarCustomization(value);
        customization = { ...customization, ...saved, selectedCar: value };
        loadCarTuning(value).then((t) => { baseTuning = t; });
      } else {
        customization = { ...customization, [slot]: value };
      }
      saveCustomization(customization);
      garageUi.update(customization);
      garageView.applyCustomization(customization);
      carView.applyCustomization(customization);
      if (isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
      else attachmentTuner.hide();
    },
    onModeChange(mode) {
      customization = { ...customization, selectedMode: mode };
      saveCustomization(customization);
      garageUi.update(customization);
    },
    onStart: startEvent,
  });

  const results = createResultsOverlay(startEvent, showGarage);
  hud.root.hidden = true;

  const onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    gameCamera.aspect = aspect;
    gameCamera.updateProjectionMatrix();
    garageView.setAspect(aspect);
  };
  window.addEventListener("resize", onResize);
  onResize();

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    document.body.classList.add("context-lost");
  });

  const engineSound = createEngineSound();

  bindInput();

  function syncConeMeshes(meshes: Mesh[], cones: Cone[]) {
    for (let i = 0; i < meshes.length && i < cones.length; i++) {
      const cone = cones[i];
      const mesh = meshes[i];
      mesh.position.x = cone.x;
      mesh.position.z = cone.z;
      if (cone.knocked) {
        mesh.rotation.x += cone.spin * 0.016;
        mesh.rotation.z += cone.spin * 0.012;
      }
    }
  }

  function updateEvent(dt: number) {
    const input = readInput();

    if (input.reset) resetEvent();

    if (activeMode === "drift-attack") {
      sessionTime -= dt;
      if (sessionTime <= 0) {
        sessionTime = 0;
        finishRun();
        return;
      }
    }

    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < substeps; i++) {
      updateCar(car, input, activeTuning, dt / substeps, isOnTrack(car.position, track));
    }

    const onTrack = isOnTrack(car.position, track);
    const inRunoff = isInRunoff(car.position, track);
    if (onTrack) runoffTime = 0;
    else if (inRunoff) runoffTime += dt;
    else runoffTime = 999;

    const scoringSurface = onTrack || (inRunoff && runoffTime <= 1.15);
    const impact = keepCarNearTrack(car, track);
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (impact > 0) cameraShake = Math.max(cameraShake, impact * 0.75);

    if (activeMode === "drift-attack") {
      updateDriftScore(drift, car, dt, scoringSurface, getDriftZone(car.position, track));
    }

    updateTrackCollision(car, colliders, dt);
    syncConeMeshes(coneMeshes, colliders.cones);
    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    engineSound.update(car, activeTuning);
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    updateChaseCamera(gameCamera, car, dt, cameraShake);
    hud.update(car, drift);
    hud.updateTimer(sessionTime);
    hud.root.hidden = false;
    renderer.render(gameScene, gameCamera);
  }

  let prevAppState: AppState = appState;
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    if (appState !== prevAppState) {
      if (appState === "event") engineSound.resume();
      else engineSound.suspend();
      prevAppState = appState;
    }

    if (appState === "garage") {
      garageView.update(dt);
      garageView.render();
    } else if (appState === "event") {
      updateEvent(dt);
    } else {
      renderer.render(gameScene, gameCamera);
    }

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
