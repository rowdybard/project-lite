import "./style.css";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Material, Object3D, Timer, type Texture } from "three";
import {
  applyTuningPreset,
  carTuningPaths,
  getCarLabel,
  isPlayableMode,
  loadCarCustomization,
  loadCustomization,
  paintColors,
  saveCustomization,
  type CarCustomization,
  type ModeId,
} from "./game/customization";
import { loadJson, loadManifest } from "./game/content/manifest";
import { bindInput, readInput, getCameraOrbit, resetInputState } from "./game/input/inputMap";
import { createCarState, resolveTrackSafetyBoundary, resetCar, updateCar } from "./game/simulation/car";
import { createFixedStepRunner } from "./game/simulation/fixedStep";
import {
  mountHandlingHarnessReport,
  runFleetTransmissionHarness,
  runHandlingHarness,
} from "./game/simulation/handlingHarness";
import { mountCollisionHarnessReport, runCollisionHarness } from "./game/simulation/collisionHarness";
import { createDriftState, finishDriftRun, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { applyStandardDriftTransmission } from "./game/simulation/driftTransmission";
import { getDriftZone, isInRunoff, isOnTrack } from "./game/simulation/trackSurface";
import { applyVehicleGeometryTuning } from "./game/simulation/vehicleGeometry";
import type { CarState, CarTuning, TrackConfig } from "./game/types";
import { createCamera, resetChaseCamera, updateChaseCamera } from "./render/app/camera";
import { createRenderer, isMobileDevice } from "./render/app/createRenderer";
import { createPerformanceMonitor } from "./render/app/performanceMonitor";
import { createScene, updateSceneLighting } from "./render/app/createScene";
import { createArenaLightRig, type ArenaLightRig } from "./render/arena/lightRig";
import { bakeArenaEnvironment } from "./render/arena/environmentBake";
import { createPostPipeline, type PostPipeline } from "./render/post/postPipeline";
import { createCarView } from "./render/objects/carView";
import { createTireSmoke, saveTireSmokePresetName, clearTireSmokePresetName, resolveTireSmokePreset } from "./render/objects/tireSmokeGpu";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTrackView, applyTrackMood, updateCornerMarkerFlex, type TrackViewResult } from "./render/objects/trackView";
import { createGarageUi } from "./ui/garageUi";
import { createMainMenu } from "./ui/mainMenu";
import { createLoadingOverlay } from "./ui/loadingOverlay";
import { createFullscreenToggle } from "./ui/fullscreenToggle";
import { createHud, createResultsOverlay } from "./ui/hud";
import { createVfxEditor } from "./ui/vfxEditor";
import { createGarageView } from "./render/garage/garageView";
import { createEngineSound } from "./audio/engineSound";
import { resolveTrackCollisions, type Cone } from "./game/simulation/trackCollision";
import { captureCarPose } from "./game/simulation/collisionSolver";
import type { CollisionWorld } from "./game/simulation/collisionWorld";
import { createCollisionWorld } from "./game/simulation/collisionWorld";
import { loadPlayerProfile, savePlayerProfile, type PlayerProfile } from "./net/profile";
import { createDisabledDevSystems } from "./devSystems/disabledDevSystems";
import type { DevSystems, DevSystemsHost } from "./devSystems/types";

type AppState = "garage" | "event" | "results";
const eventCarScale = 1.55;

// P0-12: Collision debug visualization — supports oriented boxes, circles, profiles
const profileColors: Record<string, number> = {
  wall: 0xff4444,
  guardrail: 0xff8800,
  concrete: 0x888888,
  "soft-barrier": 0x44ff44,
  post: 0xffff44,
  vehicle: 0x4488ff,
  cone: 0xff44ff,
  boundary: 0x44ffff,
};

function visualizeColliders(
  scene: { add: (obj: Object3D) => void },
  world: CollisionWorld,
): Group {
  const group = new Group();
  const materials = new Map<string, MeshBasicMaterial>();
  const boxGeo = new BoxGeometry(1, 0.4, 1);
  const circleGeo = new CylinderGeometry(1, 1, 0.4, 24);

  for (const collider of world.colliders) {
    const color = profileColors[collider.profile] ?? 0xff4444;
    let mat = materials.get(collider.profile);
    if (!mat) {
      mat = new MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.6 });
      materials.set(collider.profile, mat);
    }

    if (collider.shape === "box") {
      const mesh = new Mesh(boxGeo, mat);
      mesh.position.set(collider.x, 0.4, collider.z);
      mesh.rotation.y = collider.angle;
      mesh.scale.set(collider.halfLength * 2, 1, collider.halfWidth * 2);
      group.add(mesh);
    } else {
      const mesh = new Mesh(circleGeo, mat);
      mesh.position.set(collider.x, 0.4, collider.z);
      mesh.scale.set(collider.radius, 1, collider.radius);
      group.add(mesh);
    }
  }

  scene.add(group);
  return group;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
  import.meta.hot.dispose(() => window.location.reload());
}

async function boot() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <canvas id="game"></canvas>
    <div class="boot-overlay" data-boot-overlay>
      <div class="boot-overlay__mark">Drift Attack</div>
      <p>Loading</p>
      <span></span>
    </div>
  `;

  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const bootOverlay = document.querySelector<HTMLElement>("[data-boot-overlay]")!;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus());
  canvas.focus();

  const renderer = createRenderer(canvas);
  const performanceMonitor = createPerformanceMonitor(renderer);
  const collisionStatsEnabled = new URLSearchParams(window.location.search).has("collisionStats");
  let collisionStatsAccumulator = { samples: 0, totalMicros: 0, maxMicros: 0, lastSeverities: [] as number[] };
  const updateCollisionStats = (micros: number, severity: number) => {
    if (!collisionStatsEnabled) return;
    collisionStatsAccumulator.samples++;
    collisionStatsAccumulator.totalMicros += micros;
    if (micros > collisionStatsAccumulator.maxMicros) collisionStatsAccumulator.maxMicros = micros;
    collisionStatsAccumulator.lastSeverities.push(severity);
    if (collisionStatsAccumulator.lastSeverities.length > 60) collisionStatsAccumulator.lastSeverities.shift();
  };
  let collisionStatsOverlay: HTMLPreElement | null = null;
  const renderCollisionStats = () => {
    if (!collisionStatsEnabled) return;
    if (!collisionStatsOverlay) {
      collisionStatsOverlay = document.createElement("pre");
      collisionStatsOverlay.className = "collision-stats";
      collisionStatsOverlay.style.cssText = "position:fixed;bottom:8px;right:8px;color:#9fe7ff;font:11px/1.4 monospace;background:rgba(0,0,0,0.6);padding:6px 8px;border-radius:4px;pointer-events:none;z-index:9999;";
      document.body.append(collisionStatsOverlay);
    }
    const a = collisionStatsAccumulator;
    const mean = a.samples > 0 ? a.totalMicros / a.samples : 0;
    const recentMax = a.lastSeverities.length > 0 ? Math.max(...a.lastSeverities) : 0;
    collisionStatsOverlay.textContent = `COLLISION STATS\nsamples: ${a.samples}\nmean: ${mean.toFixed(2)}µs\nmax: ${a.maxMicros.toFixed(2)}µs\nrecent max severity: ${recentMax.toFixed(3)}`;
  };
  const gameScene = createScene();
  const defaultSceneEnvironment = gameScene.environment;
  const gameCamera = createCamera();
  const postPipeline: PostPipeline | null = new URLSearchParams(window.location.search).has("nopost")
    ? null
    : createPostPipeline(renderer, gameScene, gameCamera);
  const renderGameScene = (dt: number) => {
    if (postPipeline) postPipeline.render(dt);
    else renderer.render(gameScene, gameCamera);
  };
  const timer = new Timer();
  timer.connect(document);

  const manifest = await loadManifest();
  const carEntry = manifest.cars[manifest.activeCar];
  const driftTrack = manifest.tracks[manifest.activeTrack];
  const practiceTrack = manifest.tracks["practice-grounds"] ?? driftTrack;
  const tuningCache = new Map<string, CarTuning>();
  async function loadCarTuning(carId: string): Promise<CarTuning> {
    const cached = tuningCache.get(carId);
    if (cached) return cached;
    const path = carTuningPaths[carId] ?? carEntry.tuning;
    const tuning = applyStandardDriftTransmission(applyVehicleGeometryTuning(await loadJson<CarTuning>(path)));
    tuningCache.set(carId, tuning);
    return tuning;
  }
  let customization: CarCustomization = loadCustomization();
  let playerProfile: PlayerProfile = loadPlayerProfile();
  let baseTuning = await loadCarTuning(customization.selectedCar);
  let activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
  const query = new URLSearchParams(window.location.search);
  const playerRouteProbeEnabled = query.has("playerRouteProbe");
  // Dev systems runtime gate: requires both compile-time and runtime flags.
  // A public user cannot enable dev systems by adding ?devSystems=1 to a normal release URL.
  const devSystemsRuntimeEnabled = __DEV_SYSTEMS__ && query.get("devSystems") === "1";
  if (query.has("handlingHarness")) {
    const fleetIds = [...new Set([manifest.activeCar, ...Object.keys(carTuningPaths)])];
    const fleet = await Promise.all(
      fleetIds.map(async (id) => ({ id, tuning: applyTuningPreset(await loadCarTuning(id), "balanced") })),
    );
    const report = {
      ...runHandlingHarness(activeTuning, driftTrack),
      fleetTransmission: runFleetTransmissionHarness(fleet, driftTrack),
    };
    (window as Window & { __driftAttackHandlingReport?: typeof report }).__driftAttackHandlingReport = report;
    mountHandlingHarnessReport(report);
  }
  if (query.has("collisionHarness")) {
    const collisionReport = runCollisionHarness();
    (window as Window & { __driftAttackCollisionReport?: typeof collisionReport }).__driftAttackCollisionReport = collisionReport;
    mountCollisionHarnessReport(collisionReport);
  }

  let activeTrack: TrackConfig = driftTrack;
  let trackView: TrackViewResult = await createTrackView(gameScene, activeTrack);
  let arenaRig: ArenaLightRig | null = null;
  let arenaEnv: Texture | null = null;
  const setupArenaLighting = () => {
    arenaRig?.dispose();
    arenaRig = null;
    arenaEnv?.dispose();
    arenaEnv = null;
    if (trackView.arena) {
      arenaRig = createArenaLightRig(gameScene);
      arenaEnv = bakeArenaEnvironment(renderer);
      gameScene.environment = arenaEnv;
    } else {
      gameScene.environment = defaultSceneEnvironment;
    }
  };
  setupArenaLighting();
  let collisionWorld: CollisionWorld = trackView.collisionWorld ?? createCollisionWorld([]);
  let cones: Cone[] = trackView.cones ?? [];
  let coneMeshes = trackView.coneMeshes;
  let cornerMarkers = trackView.cornerMarkers;
  const carView = createCarView((carEntry.scale ?? 1) * eventCarScale);
  carView.applyCustomization(customization);
  const tireTracks = createTireTracks();
  const tireSmoke = createTireSmoke();
  // Load saved tire smoke preset if one was set in the VFX lab
  void resolveTireSmokePreset().then((preset) => {
    if (!preset) return;
    void tireSmoke.applyPreset(preset).then((result) => {
      if (!result.applied) {
        // Preset failed to apply on boot — clear the stale key
        clearTireSmokePresetName();
      }
    });
  });

  // Sync tire smoke tint to the current paint color.
  // Bright pink paint gets pink/white smoke; all other colors use default heat tint.
  const syncPaintTint = (paintId: string) => {
    if (paintId === "pink") {
      const hex = paintColors.pink ?? 0xff2d9b;
      tireSmoke.setPaintTint({
        r: ((hex >> 16) & 0xff) / 255,
        g: ((hex >> 8) & 0xff) / 255,
        b: (hex & 0xff) / 255,
      });
    } else {
      tireSmoke.setPaintTint(null);
    }
  };
  syncPaintTint(customization.paint);
  gameScene.add(tireTracks.root, tireSmoke.root, carView.root);

  const car = createCarState(activeTrack);
  const playerRouteProbe = {
    enabled: playerRouteProbeEnabled,
    elapsed: 0,
    previousGear: car.gear,
    shiftEvents: [] as Array<{ from: number; to: number; mph: number; rpm: number; rpmFraction: number }>,
    score: 0,
  };
  (window as Window & { __driftAttackRouteProbe?: typeof playerRouteProbe }).__driftAttackRouteProbe = playerRouteProbe;
  const drift = createDriftState();
  const hud = createHud();
  const setHudCarName = () => {
    hud.setCarName(getCarLabel(customization.selectedCar) ?? carEntry.name);
  };
  setHudCarName();
  hud.root.hidden = true;

  const garageView = createGarageView(canvas, renderer, customization);

  const runLength = 90;
  const fixedStepRunner = createFixedStepRunner(1 / 120, 0.1);
  const handlingProfile = query.get("handling") === "classic" ? "classic" : "polished";
  let lastFixedSteps = 0;
  let lastDroppedSeconds = 0;
  let sessionEndsAt = performance.now() + runLength * 1000;
  let appState: AppState = "garage";
  let vfxLabOpen = false;
  let activeMode: ModeId = customization.selectedMode;
  let sessionTime = runLength;
  let cameraShake = 0;
  let runoffTime = 0;
  let practiceZoneIndex = 0;

  const getTrackForMode = (mode: ModeId): TrackConfig => {
    if (mode === "free-drive") return practiceTrack;
    return driftTrack;
  };

  const getPracticeSpawn = () => {
    if (activeMode !== "free-drive") return activeTrack.start;
    return activeTrack.practiceZones?.[practiceZoneIndex] ?? activeTrack.start;
  };

  let startEventPending = false;
  let startEventRequestedAt = 0;

  // --- Atomic track transition controller ---
  // Uses a permanently settled queue tail so one failed job cannot poison
  // every future transition. Each caller gets its own real result promise.
  let trackGeneration = 0;
  let trackQueueTail: Promise<void> = Promise.resolve();

  function enqueueTrackTransition<T>(work: () => Promise<T>): Promise<T> {
    const run = trackQueueTail.then(work, work);
    // The queue tail must always settle successfully so one failed job
    // cannot poison every future transition.
    trackQueueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  type TrackCandidate = {
    track: TrackConfig;
    view: TrackViewResult;
  };

  async function buildTrackCandidate(track: TrackConfig): Promise<TrackCandidate> {
    const view = await createTrackView(null, track);
    return { track, view };
  }

  // Debug collider visualization — disposes previous on each transition
  let debugColliderGroup: Group | null = null;
  function updateDebugColliders() {
    if (debugColliderGroup) {
      gameScene.remove(debugColliderGroup);
      debugColliderGroup.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry?.dispose();
          (child.material as Material).dispose();
        }
      });
      debugColliderGroup = null;
    }
    if (new URLSearchParams(window.location.search).has("debugColliders")) {
      debugColliderGroup = visualizeColliders(gameScene, collisionWorld);
    }
  }

  function commitTrackCandidate(candidate: TrackCandidate) {
    // Preserve references to the old state until the candidate is ready
    const oldTrack = activeTrack;
    const oldView = trackView;

    // Add the candidate root
    gameScene.add(candidate.view.root);

    try {
      // Apply the candidate track's scene mood
      applyTrackMood(gameScene, candidate.track);

      // Install the candidate collision world and references
      activeTrack = candidate.track;
      trackView = candidate.view;
      collisionWorld = trackView.collisionWorld ?? createCollisionWorld([]);
      cones = trackView.cones ?? [];
      coneMeshes = trackView.coneMeshes;
      cornerMarkers = trackView.cornerMarkers;
      devSystems.onTrackCommitted(activeTrack);
      practiceZoneIndex = 0;

      // Rebuild lighting/environment
      setupArenaLighting();

      // Update debug colliders
      updateDebugColliders();
    } catch (error) {
      // Rollback: remove/dispose the candidate, restore old state
      gameScene.remove(candidate.view.root);
      applyTrackMood(gameScene, oldTrack);
      activeTrack = oldTrack;
      trackView = oldView;
      collisionWorld = oldView.collisionWorld ?? createCollisionWorld([]);
      cones = oldView.cones ?? [];
      coneMeshes = oldView.coneMeshes;
      cornerMarkers = oldView.cornerMarkers;
      throw error;
    }

    // Only now remove/dispose the old view
    gameScene.remove(oldView.root);
    oldView.dispose();
  }

  function switchTrack(nextTrack: TrackConfig): Promise<void> {
    const generation = ++trackGeneration;

    return enqueueTrackTransition(async () => {
      // This check intentionally runs inside the queue. Incrementing the
      // generation before enqueueing invalidates any older in-flight request.
      if (
        activeTrack.id === nextTrack.id &&
        trackView.root.parent === gameScene
      ) {
        return;
      }

      const candidate = await buildTrackCandidate(nextTrack);

      if (generation !== trackGeneration) {
        candidate.view.dispose();
        return;
      }

      commitTrackCandidate(candidate);
    });
  }

  function reloadActiveTrack(): Promise<void> {
    const generation = ++trackGeneration;
    const target = activeTrack;

    return enqueueTrackTransition(async () => {
      if (target.id === "endless") return;

      const candidate = await buildTrackCandidate(target);

      if (generation !== trackGeneration) {
        candidate.view.dispose();
        return;
      }

      commitTrackCandidate(candidate);
    });
  }

  // --- Dev systems facade ---
  // One dynamic-import boundary. The disabled facade is tiny and imports no
  // development runtime. The enabled implementation is only reached when both
  // the compile-time constant and the runtime query flag are set.
  // The host is created later (after results/garageUi/engineSound are defined).
  let devSystems: DevSystems = createDisabledDevSystems();

  const resetEvent = () => {
    if (devSystems.resetActiveMode()) {
      // Dev mode reset handled by dev systems
    } else {
      resetCar(car, activeTrack, getPracticeSpawn());
      resetDrift(drift);
      sessionTime = activeMode === "drift-attack" ? runLength : Infinity;
    }
    tireTracks.reset();
    tireSmoke.reset();
    sessionEndsAt = performance.now() + runLength * 1000;
    fixedStepRunner.reset();
    cameraShake = 0;
    playerRouteProbe.elapsed = 0;
    playerRouteProbe.previousGear = car.gear;
    playerRouteProbe.shiftEvents.length = 0;
    playerRouteProbe.score = 0;
    runoffTime = 0;
    carView.applyCustomization(customization);
    carView.root.visible = true;
    resetChaseCamera(gameCamera, car);
  };

  const mainMenu = createMainMenu({
    onLaunchMode: (mode) => {
      customization = { ...customization, selectedMode: mode };
      saveCustomization(customization);
      garageUi.update(customization);
      void startEvent();
    },
    onOptions: () => showOptionsMenu(),
  });
  const loadingOverlay = createLoadingOverlay();
  mainMenu.hide();

  const modeLabel = (mode: ModeId) =>
    mode === "drift-attack" ? "Loading Drift Attack" : "Opening Practice Grounds";

  const showMainMenu = () => {
    startEventPending = false;
    resetInputState();
    appState = "garage";
    garageView.setActive(true);
    results.hide();
    hud.root.hidden = true;
    fixedStepRunner.reset();
    carView.root.visible = true;
    tireTracks.root.visible = true;
    tireSmoke.root.visible = true;
    customization = { ...customization, selectedMode: "free-drive" };
    saveCustomization(customization);
    garageUi.update(customization);
    garageUi.hide();
    garageView.applyCustomization(customization);
    mainMenu.show();
    // Do not enable mode buttons until Practice Grounds has loaded successfully
    mainMenu.setPlayEnabled(false);
    void switchTrack(practiceTrack).then(() => {
      activeMode = "free-drive";
      practiceZoneIndex = 0;
      resetEvent();
      setHudCarName();
      bootOverlay.classList.add("is-ready");
      mainMenu.setPlayEnabled(true);
    }).catch((error) => {
      console.error("Practice Grounds failed to load:", error);
      loadingOverlay.showError(
        `Could not load Practice Grounds. ${error instanceof Error ? error.message : String(error)}`,
        () => void switchTrack(practiceTrack).then(() => {
          activeMode = "free-drive";
          practiceZoneIndex = 0;
          resetEvent();
          setHudCarName();
          bootOverlay.classList.add("is-ready");
          mainMenu.setPlayEnabled(true);
          loadingOverlay.hide();
        }).catch(() => window.location.reload()),
        () => window.location.reload(),
      );
    });
  };

  const showOptionsMenu = () => {
    if (appState === "event") {
      resetInputState();
      appState = "garage";
      hud.root.hidden = true;
      car.throttleAxis = 0;
      car.brakeAxis = 0;
    }
    vfxLabOpen = false;
    garageView.setActive(true);
    mainMenu.hide();
    garageUi.show();
  };

  const showGarage = showMainMenu;

  const startEvent = async () => {
    const now = performance.now();
    if (startEventPending && now - startEventRequestedAt < 2500) return;
    startEventPending = true;
    startEventRequestedAt = now;
    if (!isPlayableMode(customization.selectedMode)) {
      customization = { ...customization, selectedMode: "free-drive" };
      saveCustomization(customization);
      garageUi.update(customization);
    }
    // Normalize stale dev modes when dev systems are disabled at runtime
    // (e.g. production build without ?devSystems=1, but localStorage has "endless")
    if (!devSystems.handlesMode(customization.selectedMode) && customization.selectedMode !== "drift-attack" && customization.selectedMode !== "free-drive") {
      customization = { ...customization, selectedMode: "free-drive" };
      saveCustomization(customization);
      garageUi.update(customization);
    }
    resetInputState();
    activeMode = customization.selectedMode;
    mainMenu.setPlayEnabled(false);
    loadingOverlay.show(modeLabel(activeMode));
    try {
      // Dev mode start routing — dev systems handle online-lobby/endless/map-editor
      if (devSystems.handlesMode(activeMode)) {
        await switchTrack(getTrackForMode(activeMode));
        baseTuning = await loadCarTuning(customization.selectedCar);
        activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
        const carResult = await carView.whenReady();
        if (!carResult.ok && carResult.carId === customization.selectedCar) {
          throw new Error(
            `Could not load ${getCarLabel(customization.selectedCar)}: ` +
            carResult.error.message,
          );
        }
        appState = "event";
        garageView.setActive(false);
        results.hide();
        garageUi.hide();
        mainMenu.hide();
        const devResult = await devSystems.startMode(activeMode);
        if (devResult.handled && !devResult.started) {
          throw devResult.error;
        }
        setHudCarName();
        loadingOverlay.hide();
        canvas.focus();
        return;
      }
      // Public mode handling — drift-attack and free-drive only
      await switchTrack(getTrackForMode(activeMode));
      baseTuning = await loadCarTuning(customization.selectedCar);
      activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);

      // Wait for the selected car to be ready before entering gameplay
      const carResult = await carView.whenReady();
      if (!carResult.ok && carResult.carId === customization.selectedCar) {
        // Imported model failed and no fallback was installed yet
        throw new Error(
          `Could not load ${getCarLabel(customization.selectedCar)}: ` +
          carResult.error.message,
        );
      }

      appState = "event";
      garageView.setActive(false);
      results.hide();
      garageUi.hide();
      mainMenu.hide();
      resetEvent();
      setHudCarName();
      carView.root.visible = true;
      tireTracks.root.visible = true;
      tireSmoke.root.visible = true;
      hud.root.hidden = false;
      hud.setMode(activeMode === "free-drive" ? "free-drive" : "drift-attack");
      loadingOverlay.hide();
      canvas.focus();
    } catch (error) {
      console.error("Could not start event", error);
      // Show retry/back instead of silently returning to menu
      loadingOverlay.showError(
        `Could not load ${modeLabel(activeMode)}. ${error instanceof Error ? error.message : String(error)}`,
        () => { startEventPending = false; void startEvent(); },
        () => {
          startEventPending = false;
          loadingOverlay.hide();
          showMainMenu();
        },
      );
    } finally {
      startEventPending = false;
    }
  };

  const finishRun = () => {
    const finalScore = finishDriftRun(drift);
    appState = "results";
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    hud.root.hidden = true;
    results.show(finalScore, drift.bestCombo, drift.bestRun);
  };

  const vfxEditor = createVfxEditor({
    onClose: () => {
      // Re-enable garage rendering and input when VFX Lab closes
      if (appState === "garage") {
        garageView.setActive(true);
        vfxLabOpen = false;
      }
    },
    onApplyTireSmoke: async (preset) => {
      // Save the preset name only when apply actually succeeds
      const result = await tireSmoke.applyPreset(preset);
      if (result.applied) {
        const saveResult = saveTireSmokePresetName(preset.name);
        if (saveResult.saved) {
          vfxEditor.setTireSmokeStatus(`"${preset.name}" applied as tire smoke.`);
        } else {
          vfxEditor.setTireSmokeStatus(`"${preset.name}" applied, but browser storage was unavailable: ${saveResult.reason}`);
        }
      } else if (result.reason !== "superseded") {
        vfxEditor.setTireSmokeStatus(`Could not apply "${preset.name}": ${result.reason}`);
      }
      return result;
    },
    onClearTireSmoke: () => {
      clearTireSmokePresetName();
      tireSmoke.clearPreset();
      vfxEditor.setTireSmokeStatus("Tire smoke reset to default.");
    },
  });
  let garageVehicleRequest = 0;
  const garageUi = createGarageUi(customization, playerProfile, {
    onCustomizationChange(slot, value) {
      startEventPending = false;
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
      carView.applyCustomization(customization);
      garageView.applyCustomization(customization);
      // Only sync paint tint when paint or selectedCar can change it
      if (slot === "paint" || slot === "selectedCar") {
        syncPaintTint(customization.paint);
      }
      // Show loading indicator while imported car loads
      const requestId = ++garageVehicleRequest;
      const requestedCar = customization.selectedCar;
      const loadState = carView.getLoadState();
      garageUi.setVehicleState({ loading: loadState.loading, error: null });
      void carView.whenReady().then((result) => {
        if (requestId !== garageVehicleRequest) return;
        if (customization.selectedCar !== requestedCar) return;
        if (!result.ok && result.carId === requestedCar) {
          garageUi.setVehicleState({ loading: false, error: result.error.message });
        } else {
          garageUi.setVehicleState({ loading: false, error: null });
        }
      });
    },
    onProfileChange(profile) {
      playerProfile = { name: profile.name.trim().slice(0, 18) || "Driver" };
      savePlayerProfile(playerProfile);
      garageUi.update(customization, playerProfile);
    },
    onStart: startEvent,
    onOpenVfxLab: () => {
      garageView.setActive(false);
      vfxLabOpen = true;
      vfxEditor.show();
    },
    onBack: () => showMainMenu(),
  });

  const results = createResultsOverlay(startEvent, showMainMenu);
  hud.root.hidden = true;

  // Tire effects adapter for dev systems host
  const tireEffects = {
    reset: () => { tireTracks.reset(); tireSmoke.reset(); },
    update: (carState: CarState, onTrack: boolean, dt: number) => {
      tireTracks.update(carState, onTrack);
      tireSmoke.update(carState, onTrack, dt);
    },
    root: tireTracks.root,
  };

  // --- Helpers shared with dev systems host ---
  function syncConeMeshes(meshes: readonly Mesh[], cones: readonly Cone[]) {
    const count = Math.min(meshes.length, cones.length);
    for (let i = 0; i < count; i += 1) {
      const mesh = meshes[i];
      const cone = cones[i];
      mesh.position.x = cone.x;
      mesh.position.z = cone.z;
      if (cone.knocked) {
        mesh.rotation.x = Math.min(
          Math.PI * 0.5,
          Math.abs(cone.spin),
        );
        mesh.rotation.z = cone.spin;
        mesh.rotation.y += cone.angularVelocity;
      }
    }
  }

  function getNearbyGarage() {
    if (activeMode !== "free-drive" || activeTrack.id !== "practice-grounds") return false;
    const start = activeTrack.start;
    return Math.hypot(car.position.x - start.x, car.position.z - start.z) <= 16;
  }

  const applyFocusLighting = () => {
    if (arenaRig) arenaRig.update(car.position);
    else updateSceneLighting(gameScene, car.position);
  };

  // --- Now that all public systems are defined, create the dev systems facade ---
  const devSystemsHost: DevSystemsHost = {
    scene: gameScene,
    camera: gameCamera,
    renderer,
    car,
    canvas,
    get customization() { return customization; },
    get activeTuning() { return activeTuning; },
    get activeTrack() { return activeTrack; },
    get drift() { return drift; },
    get playerProfile() { return playerProfile; },
    get hud() { return hud; },
    get results() { return results; },
    get tireEffects() { return tireEffects; },
    get carView() { return carView; },
    get fixedStepRunner() { return fixedStepRunner; },
    get collisionWorld() { return collisionWorld; },
    get handlingProfile() { return handlingProfile; },
    get playerRouteProbeEnabled() { return playerRouteProbeEnabled; },
    get playerRouteProbeElapsed() { return playerRouteProbe.elapsed; },
    switchTrack,
    reloadActiveTrack,
    loadCarTuning,
    renderGameScene,
    showMainMenu: () => showMainMenu(),
    showGarage: () => showGarage(),
    showOptionsMenu: () => showOptionsMenu(),
    resetPublicInput: resetInputState,
    setPublicCarVisible(visible) { carView.root.visible = visible; },
    setGarageActive(active) { garageView.setActive(active); },
    reportError(title, error) { console.error(title, error); },
    saveCustomization,
    updateGarageUi: () => garageUi.update(customization),
    updateChaseCamera: (dt, shake, useObstructions) => updateChaseCamera(gameCamera, car, dt, shake, getCameraOrbit(), useObstructions ? collisionWorld.cameraObstructions : []),
    resetChaseCamera: () => resetChaseCamera(gameCamera, car),
    applyFocusLighting,
    updateEngineSound: () => engineSound.update(car, activeTuning),
    resumeEngineSound: () => engineSound.resume(),
    suspendEngineSound: () => engineSound.suspend(),
    updateCornerMarkerFlex: (dt) => updateCornerMarkerFlex(cornerMarkers, car, dt),
    updateWindUniforms: (dt) => { if (trackView.windUniforms) for (const w of trackView.windUniforms) w.value += dt; },
    syncConeMeshes: () => syncConeMeshes(coneMeshes, cones),
    getCameraOrbit,
    getNearbyGarage,
    setSessionTime: (t) => { sessionTime = t; },
    getSessionTime: () => sessionTime,
    setCameraShake: (s) => { cameraShake = s; },
    getCameraShakeValue: () => cameraShake,
    setLastFixedStats: (steps, dropped) => { lastFixedSteps = steps; lastDroppedSeconds = dropped; },
    resetDrift: () => resetDrift(drift),
    finishDriftRun: () => finishDriftRun(drift),
    updateDriftScore: (dt, scoringSurface, driftZone, impact) => updateDriftScore(drift, car, dt, scoringSurface, driftZone, impact),
    setDriftCallout: (text, timer) => { drift.callout = text; drift.calloutTimer = timer; },
    addPlayerRouteProbeTime: (dt) => { playerRouteProbe.elapsed += dt; },
    recordPlayerRouteProbeShift: (from, to) => {
      playerRouteProbe.shiftEvents.push({
        from, to,
        mph: car.speed * 2.237,
        rpm: car.rpm,
        rpmFraction: car.rpm / activeTuning.redlineRpm,
      });
    },
    setPlayerRouteProbeScore: (score) => { playerRouteProbe.score = score; },
    resetPlayerRouteProbe: () => {
      playerRouteProbe.elapsed = 0;
      playerRouteProbe.previousGear = car.gear;
      playerRouteProbe.shiftEvents.length = 0;
      playerRouteProbe.score = 0;
    },
  };

  devSystems = devSystemsRuntimeEnabled
    ? await import("./devSystems/createDevSystems").then(({ createDevSystems }) => createDevSystems(devSystemsHost))
    : createDisabledDevSystems();

  // --- Named event handlers (removable during teardown) ---
  const onResize = () => {
    const mobileCap = isMobileDevice() ? 1.0 : 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobileCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
    postPipeline?.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    gameCamera.aspect = aspect;
    gameCamera.updateProjectionMatrix();
    garageView.setAspect(aspect);
  };
  window.addEventListener("resize", onResize);
  onResize();

  // --- Single-loop RAF controller ---
  // The application owns exactly one main RAF. Explicit state prevents
  // visibility/context-loss/teardown from creating competing RAF chains.
  let rafId: number | null = null;
  let disposed = false;
  let documentHidden = false;
  let contextLost = false;
  let hiddenStartTime = 0;
  let contextLostOverlay: HTMLElement | null = null;

  function startMainLoop() {
    if (rafId !== null) return;  // Already scheduled
    if (disposed || documentHidden || contextLost) return;
    rafId = requestAnimationFrame(frame);
  }

  function stopMainLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    stopMainLoop();
    resetInputState();
    engineSound.suspend();
    // Only one overlay — don't append another if one already exists
    if (contextLostOverlay) return;
    contextLostOverlay = document.createElement("div");
    contextLostOverlay.className = "context-lost-overlay";
    const card = document.createElement("div");
    card.className = "context-lost-overlay__card";
    const h1 = document.createElement("h1");
    h1.textContent = "Drift Attack lost its graphics context";
    const p = document.createElement("p");
    p.textContent = "The browser reclaimed the GPU. This can happen when the device runs low on memory or after sleep/wake.";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload";
    button.addEventListener("click", () => window.location.reload());
    card.append(h1, p, button);
    contextLostOverlay.append(card);
    document.body.append(contextLostOverlay);
  };

  const onContextRestored = () => {
    // The simplest reliable recovery is a full reload — Three.js internal state
    // (programs, geometries, textures) is too complex to rebuild piecemeal.
    window.location.reload();
  };

  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

  // Pause expensive work (RAF + audio) when the tab is hidden.
  // Also pause Drift Attack timing so the player's 90-second run is not consumed.
  const onVisibilityChange = () => {
    if (document.hidden) {
      documentHidden = true;
      hiddenStartTime = performance.now();
      stopMainLoop();
      resetInputState();
      engineSound.suspend();
      devSystems.suspend();
    } else {
      // A visibility event must not restart rendering while context is lost or after teardown
      if (disposed || contextLost) return;
      documentHidden = false;
      // Move sessionEndsAt forward by the hidden duration
      if (hiddenStartTime > 0) {
        const hiddenDuration = performance.now() - hiddenStartTime;
        sessionEndsAt += hiddenDuration;
        hiddenStartTime = 0;
      }
      // Reset the Three.js timer cleanly on resume
      timer.update(performance.now());
      timer.getDelta();  // Reset delta to avoid a huge jump
      if (appState === "event") engineSound.resume();
      devSystems.resume();
      startMainLoop();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Clear keyboard state on window blur (alt-tab, focus loss)
  const onWindowBlur = () => {
    resetInputState();
  };
  window.addEventListener("blur", onWindowBlur);

  const engineSound = createEngineSound();

  const unbindInput = bindInput();
  const fullscreenToggle = createFullscreenToggle();
  showMainMenu();

  function updateEvent(dt: number) {
    // Dev modes (online-lobby, endless, map-editor) are fully delegated to dev systems.
    if (devSystems.handlesMode(activeMode)) {
      const result = devSystems.update(dt, readInput());
      if (result.handled) return;
      // If dev systems declined, fall through to public mode handling
    }

    const liveInput = readInput();
    const probeTime = playerRouteProbe.elapsed;
    const probeSlideTime = Math.max(0, probeTime - 5.5);
    const input = playerRouteProbeEnabled && activeMode === "drift-attack"
      ? {
          ...liveInput,
          throttle: probeTime < 5.5 ? 1 : 0.82,
          brake: 0,
          steer: probeTime < 5.5 ? 0 : Math.sin(probeSlideTime * 1.35) * 0.62,
          handbrake: probeSlideTime > 0 && probeSlideTime % 4.65 < 0.14,
          reset: false,
          confirm: false,
          menu: false,
        }
      : liveInput;

    if (input.zoneNext && activeMode === "free-drive" && activeTrack.practiceZones?.length) {
      practiceZoneIndex = (practiceZoneIndex + 1) % activeTrack.practiceZones.length;
      resetEvent();
    }
    if (input.reset) resetEvent();
    if (input.menu) {
      showGarage();
      return;
    }

    if (activeMode === "drift-attack") {
      sessionTime = Math.max(0, (sessionEndsAt - performance.now()) / 1000);
      if (sessionTime <= 0) {
        sessionTime = 0;
        finishRun();
        return;
      }
    }

    let frameImpact = 0;
    let scoringSurface = isOnTrack(car.position, activeTrack);
    const fixedStats = fixedStepRunner.advance(dt, (stepDt) => {
      if (playerRouteProbeEnabled && activeMode === "drift-attack") playerRouteProbe.elapsed += stepDt;
      const gearBeforeStep = car.gear;
      const surfaceBeforeStep = isOnTrack(car.position, activeTrack);
      const previousPose = captureCarPose(car);
      updateCar(car, input, activeTuning, stepDt, surfaceBeforeStep, handlingProfile);

      if (playerRouteProbeEnabled && activeMode === "drift-attack" && car.gear !== gearBeforeStep) {
        playerRouteProbe.shiftEvents.push({
          from: gearBeforeStep,
          to: car.gear,
          mph: car.speed * 2.237,
          rpm: car.rpm,
          rpmFraction: car.rpm / activeTuning.redlineRpm,
        });
      }
      playerRouteProbe.previousGear = car.gear;

      const stepOnTrack = isOnTrack(car.position, activeTrack);
      const stepInRunoff = isInRunoff(car.position, activeTrack);
      if (stepOnTrack) runoffTime = 0;
      else if (stepInRunoff) runoffTime += stepDt;
      else runoffTime = 999;
      scoringSurface = stepOnTrack || (stepInRunoff && runoffTime <= 1.15);

      let stepImpact = 0;
      const collisionStart = collisionStatsEnabled ? performance.now() : 0;
      const trackResult = resolveTrackCollisions(car, previousPose, collisionWorld, cones, stepDt, activeTuning);
      const boundaryResult = resolveTrackSafetyBoundary(car, previousPose, activeTrack, activeTuning);
      stepImpact = Math.max(trackResult.severity, boundaryResult.severity);
      if (collisionStatsEnabled) {
        updateCollisionStats((performance.now() - collisionStart) * 1000, stepImpact);
      }
      frameImpact = Math.max(frameImpact, stepImpact);

      if (activeMode === "drift-attack") {
        const driftZone = getDriftZone(car.position, activeTrack);
        updateDriftScore(drift, car, stepDt, scoringSurface, driftZone, stepImpact);
        if (playerRouteProbeEnabled) playerRouteProbe.score = drift.totalScore + drift.comboScore;
      }
    });
    lastFixedSteps = fixedStats.steps;
    lastDroppedSeconds = fixedStats.droppedSeconds;

    const onTrack = isOnTrack(car.position, activeTrack);
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (frameImpact > 0) cameraShake = Math.max(cameraShake, frameImpact * 0.75);

    syncConeMeshes(coneMeshes, cones);

    const nearGarage = getNearbyGarage();
    if (nearGarage && input.confirm) {
      showOptionsMenu();
      return;
    }

    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    updateCornerMarkerFlex(cornerMarkers, car, dt);
    if (trackView.windUniforms) for (const w of trackView.windUniforms) w.value += dt;
    engineSound.update(car, activeTuning);
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    updateChaseCamera(gameCamera, car, dt, cameraShake, getCameraOrbit(), collisionWorld.cameraObstructions);
    applyFocusLighting();
    hud.update(car, drift);
    hud.updateTimer(sessionTime);
    if (activeMode === "free-drive") {
      hud.setPracticeZone(
        nearGarage
          ? "Garage — Press E"
          : activeTrack.practiceZones?.[practiceZoneIndex]?.label ?? "Practice",
      );
    }
    hud.root.hidden = false;
    renderGameScene(dt);
  }

  let prevAppState: AppState = appState;
  function frame(timestamp?: number) {
    // Clear the RAF ID before deciding whether to schedule the next frame
    rafId = null;
    if (disposed || documentHidden || contextLost) return;

    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.25);

    if (appState !== prevAppState) {
      if (appState === "event") engineSound.resume();
      else engineSound.suspend();
      prevAppState = appState;
    }

    if (appState === "garage") {
      lastFixedSteps = 0;
      lastDroppedSeconds = 0;
      // Skip garage rendering while VFX Lab is open — it has its own renderer
      if (!vfxLabOpen) {
        garageView.update(dt);
        garageView.render();
      }
    } else if (appState === "event") {
      updateEvent(dt);
    } else {
      renderGameScene(dt);
    }

    performanceMonitor.update(dt, lastFixedSteps, lastDroppedSeconds);
    renderCollisionStats();

    // Schedule the next frame only if we're still running
    if (!disposed && !documentHidden && !contextLost) {
      rafId = requestAnimationFrame(frame);
    }
  }

  startMainLoop();

  // Helper: dispose any object that has a dispose method or a removable root
  function disposeSafe(obj: { dispose?: () => void; root?: HTMLElement | unknown }) {
    if (typeof obj?.dispose === "function") obj.dispose();
    else if (obj?.root instanceof HTMLElement) obj.root.remove();
  }

  // Real teardown path — disposes GPU resources and stops the RAF loop.
  // Idempotent: safe to call multiple times. Uses explicit owner disposal only.
  function teardown() {
    if (disposed) return;
    disposed = true;
    stopMainLoop();
    resetInputState();
    // Remove all global listeners
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
    renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
    unbindInput();
    fullscreenToggle.dispose();
    // Remove context-lost overlay if present
    contextLostOverlay?.remove();
    contextLostOverlay = null;
    // Audio
    engineSound.dispose();
    // UI overlays
    vfxEditor.dispose();
    garageView.dispose();
    garageUi.dispose();
    loadingOverlay.dispose();
    disposeSafe(mainMenu);
    disposeSafe(results);
    disposeSafe(hud);
    // 3D systems — explicit owner disposal, exactly once
    carView.dispose();
    tireTracks.dispose();
    tireSmoke.dispose();
    postPipeline?.dispose();
    performanceMonitor.dispose();
    // Dev systems — disposes all dev-only resources (online, endless, replay, etc.)
    devSystems.dispose();
    // Scene resources — explicit owner disposal only, no broad traversal
    trackView.dispose();
    gameScene.clear();
    arenaRig?.dispose();
    arenaEnv?.dispose();
    defaultSceneEnvironment?.dispose();
    // Renderer
    renderer.dispose();
  }

  // bfcache-safe: don't run destructive teardown for a page hide that will be persisted.
  // Instead reload cleanly on a persisted pageshow.
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) return;  // bfcache — preserve the page
    teardown();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      // Returning from bfcache — reload cleanly since GPU state may be invalid
      window.location.reload();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
}

boot().catch((error) => {
  console.error(error);
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = "";
  const main = document.createElement("main");
  main.className = "boot-error";
  const h1 = document.createElement("h1");
  h1.textContent = "Drift Attack failed to start";
  const pre = document.createElement("pre");
  pre.textContent = error instanceof Error ? error.message : String(error);
  const support = document.createElement("p");
  support.textContent = "If this persists, try a hard refresh (Ctrl+Shift+R) or clear site data.";

  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.textContent = "Reload";
  reloadButton.addEventListener("click", () => window.location.reload());

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Diagnostics";
  copyButton.addEventListener("click", () => {
    const diagnostics = [
      `URL: ${window.location.href}`,
      `UA: ${navigator.userAgent}`,
      `Time: ${new Date().toISOString()}`,
      `Error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    ].join("\n");
    try {
      void navigator.clipboard.writeText(diagnostics);
      copyButton.textContent = "Copied!";
    } catch {
      copyButton.textContent = "Copy failed — check console";
    }
  });

  main.append(h1, pre, support, reloadButton, copyButton);
  app.append(main);
});
