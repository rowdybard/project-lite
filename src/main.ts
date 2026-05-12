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
import { createDriftState, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { getDriftZone, isOnTrack } from "./game/simulation/trackSurface";
import { createHud, createTunePanel } from "./ui/hud";
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
  const tunePanel = createTunePanel();
  hydrateTuningPanel(tunePanel, tuning);
  bindInput();

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
      resetCar(car, track);
      resetDrift(drift);
      tireTracks.reset();
      tireSmoke.reset();
    }

    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < substeps; i++) {
      updateCar(car, input, tuning, dt / substeps, isOnTrack(car.position, track));
    }
    const onTrack = isOnTrack(car.position, track);
    keepCarNearTrack(car, track);
    updateDriftScore(drift, car, dt, onTrack, getDriftZone(car.position, track));
    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    updateChaseCamera(camera, car, dt);
    hud.update(car, drift);
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
