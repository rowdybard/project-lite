import "./style.css";
import { Group, Mesh, Timer, Vector3, type Texture } from "three";
import {
  applyTuningPreset,
  carTuningPaths,
  getCarLabel,
  isPlayableMode,
  loadCarCustomization,
  loadCustomization,
  saveCustomization,
  type CarCustomization,
  type ModeId,
} from "./game/customization";
import { loadJson, loadManifest } from "./game/content/manifest";
import { bindInput, readInput, getCameraOrbit, resetInputState } from "./game/input/inputMap";
import { createCarState, keepCarNearTrack, resetCar, updateCar } from "./game/simulation/car";
import { createFixedStepRunner } from "./game/simulation/fixedStep";
import {
  mountHandlingHarnessReport,
  runFleetTransmissionHarness,
  runHandlingHarness,
} from "./game/simulation/handlingHarness";
import { createDriftState, finishDriftRun, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { applyStandardDriftTransmission } from "./game/simulation/driftTransmission";
import { getDriftZone, isInRunoff, isOnTrack } from "./game/simulation/trackSurface";
import { applyVehicleGeometryTuning } from "./game/simulation/vehicleGeometry";
import type { CarState, CarTuning, InputState, TrackConfig } from "./game/types";
import { createCamera, resetChaseCamera, updateChaseCamera } from "./render/app/camera";
import { createRenderer } from "./render/app/createRenderer";
import { createPerformanceMonitor } from "./render/app/performanceMonitor";
import { createScene, updateSceneLighting } from "./render/app/createScene";
import { createArenaLightRig, type ArenaLightRig } from "./render/arena/lightRig";
import { bakeArenaEnvironment } from "./render/arena/environmentBake";
import { createPostPipeline, type PostPipeline } from "./render/post/postPipeline";
import { createGarageView } from "./render/garage/garageView";
import { createCarView } from "./render/objects/carView";
import { createTireSmoke } from "./render/objects/tireSmokeGpu";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTrackView, updateCornerMarkerFlex, type TrackViewResult } from "./render/objects/trackView";
import { createOnlineGhosts } from "./render/objects/onlineGhosts";
import { createQueueSlab } from "./render/objects/queueSlab";
import { createGarageUi } from "./ui/garageUi";
import { createEndlessResultsOverlay, createHud, createResultsOverlay } from "./ui/hud";
import { createOnlineHud, type OnlineHudPlayer } from "./ui/onlineHud";
import { createOnlineMatchUi } from "./ui/onlineMatchUi";
import { createAttachmentTuner } from "./ui/attachmentTuner";
import { createVfxEditor } from "./ui/vfxEditor";
import { isImportedCar } from "./render/objects/importedCars";
import { createEngineSound } from "./audio/engineSound";
import { createTrackColliders, updateTrackCollision } from "./game/simulation/trackCollision";
import type { Cone } from "./game/simulation/trackCollision";
import { createOnlineClient, type OnlineClient } from "./net/onlineClient";
import { loadPlayerProfile, savePlayerProfile, type PlayerProfile } from "./net/profile";
import {
  dailySeedForTimestamp,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type OnlinePlayerState,
  type OnlineRoomState,
} from "./net/protocol";
import { createMapEditor } from "./game/editor/mapEditor";
import { createEndlessTrack } from "./game/endless/endlessTrack";
import { createEndlessState } from "./game/endless/endlessState";
import { PHYSICS_VERSION, REPLAY_FIXED_STEP_SECONDS } from "./game/endless/physicsVersion";
import { createReplayInputSampler, deserializeReplay, type ReplayData } from "./game/endless/replay";
import {
  commitEndlessRun,
  loadEndlessRecords,
  recordEndlessRunStart,
  type EndlessRunSummary,
} from "./game/endless/records";
import { createEndlessTrackView } from "./render/endless/endlessTrackView";
import { createReplayCarView } from "./render/endless/replayCarView";
import { createLeaderboardClient } from "./net/leaderboard";
import { createLeaderboardUi } from "./ui/leaderboardUi";
import { createReplayOverlay } from "./ui/replayOverlay";

type AppState = "garage" | "event" | "results" | "replay";
const eventCarScale = 1.55;

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
  import.meta.hot.dispose(() => window.location.reload());
}

async function boot() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = '<canvas id="game"></canvas>';

  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus());
  canvas.focus();

  const renderer = createRenderer(canvas);
  const performanceMonitor = createPerformanceMonitor(renderer);
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
  const onlineLobbyTrack = manifest.tracks["online-lobby"] ?? practiceTrack;
  const endlessTrackStub: TrackConfig = {
    id: "endless",
    name: "Endless Drift",
    start: { x: 0, z: 0, heading: 0 },
    checkpoints: [],
    roadPath: [],
    roadWidth: 22,
    boundaryMargin: 0,
  };
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
  const leaderboardClient = createLeaderboardClient();
  const endlessRecords = loadEndlessRecords();
  let baseTuning = await loadCarTuning(customization.selectedCar);
  let activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
  const query = new URLSearchParams(window.location.search);
  const playerRouteProbeEnabled = query.has("playerRouteProbe");
  if (query.has("handlingHarness")) {
    const fleetIds = [...new Set([manifest.activeCar, ...Object.keys(carTuningPaths)])];
    const fleet = await Promise.all(
      fleetIds.map(async (id) => ({ id, tuning: applyTuningPreset(await loadCarTuning(id), "balanced") })),
    );
    const report = {
      ...runHandlingHarness(activeTuning, driftTrack),
      fleetTransmission: runFleetTransmissionHarness(fleet, driftTrack),
    };
    (window as Window & { __projectLiteHandlingReport?: typeof report }).__projectLiteHandlingReport = report;
    mountHandlingHarnessReport(report);
  }

  let activeTrack: TrackConfig = driftTrack;
  let trackView: TrackViewResult = await createTrackView(gameScene, activeTrack);
  let endlessTrackView: ReturnType<typeof createEndlessTrackView> | null = null;
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
  let colliders = createTrackColliders(activeTrack);
  let coneMeshes = trackView.coneMeshes;
  let cornerMarkers = trackView.cornerMarkers;
  const carView = createCarView((carEntry.scale ?? 1) * eventCarScale);
  carView.applyCustomization(customization);
  const replayCarView = createReplayCarView((carEntry.scale ?? 1) * eventCarScale);
  replayCarView.root.visible = false;
  const tireTracks = createTireTracks();
  const tireSmoke = createTireSmoke();
  const onlineGhosts = createOnlineGhosts();
  const queueSlab = createQueueSlab();
  onlineGhosts.setTrack(activeTrack);
  gameScene.add(tireTracks.root, tireSmoke.root, carView.root, replayCarView.root, onlineGhosts.root, queueSlab.root);

  const car = createCarState(activeTrack);
  const playerRouteProbe = {
    enabled: playerRouteProbeEnabled,
    elapsed: 0,
    previousGear: car.gear,
    shiftEvents: [] as Array<{ from: number; to: number; mph: number; rpm: number; rpmFraction: number }>,
    score: 0,
  };
  (window as Window & { __projectLiteRouteProbe?: typeof playerRouteProbe }).__projectLiteRouteProbe = playerRouteProbe;
  const drift = createDriftState();
  const hud = createHud();
  const onlineHud = createOnlineHud();
  let onlineRoom: OnlineRoomState | null = null;
  let onlinePlayerId: string | null = null;
  let onlineMatchActive = false;
  let onlineInputSeq = 0;
  let onlineInputDebt = 0;
  let onlineQueueOpen = false;
  let activeQueuePad: { roomCode: string; x: number; z: number; heading: number } | null = null;
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
  const runLength = 90;
  const fixedStepRunner = createFixedStepRunner(1 / 120, 0.1);
  const handlingProfile = query.get("handling") === "classic" ? "classic" : "polished";
  let lastFixedSteps = 0;
  let lastDroppedSeconds = 0;
  let sessionEndsAt = performance.now() + runLength * 1000;
  const attachmentTunerEnabled = new URLSearchParams(window.location.search).has("kitTuner");
  if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
  let appState: AppState = "garage";
  let activeMode: ModeId = customization.selectedMode;
  let endlessTrack: ReturnType<typeof createEndlessTrack> | null = null;
  let endlessRun: ReturnType<typeof createEndlessState> | null = null;
  let activeEndlessBoard: LeaderboardBoard = "daily";
  let activeEndlessSeed = 1;
  let pendingEndlessLaunch: { board: LeaderboardBoard; seed: number } | null = null;
  let replaySession: {
    entry: LeaderboardEntry;
    data: ReplayData;
    decoded: ReturnType<typeof deserializeReplay>;
    sampler: ReturnType<typeof createReplayInputSampler>;
    car: CarState;
    track: ReturnType<typeof createEndlessTrack>;
    tuning: CarTuning;
    elapsed: number;
    accumulator: number;
    checkpointCursor: number;
    finished: boolean;
  } | null = null;
  let sessionTime = runLength;
  let cameraShake = 0;
  let runoffTime = 0;
  let practiceZoneIndex = 0;

  const getTrackForMode = (mode: ModeId) => {
    if (mode === "online-lobby") return onlineLobbyTrack;
    if (mode === "map-editor") return onlineLobbyTrack;
    if (mode === "endless") return endlessTrackStub;
    if (mode === "free-drive") return practiceTrack;
    return driftTrack;
  };

  const randomEndlessSeed = () => {
    const value = crypto.getRandomValues(new Uint32Array(1))[0];
    return value || 1;
  };

  const localDailySeed = () => dailySeedForTimestamp(Date.now()).seed;

  async function resolveEndlessLaunch() {
    if (pendingEndlessLaunch) {
      const launch = pendingEndlessLaunch;
      pendingEndlessLaunch = null;
      return launch;
    }
    try {
      const daily = await leaderboardClient.fetchDailySeed();
      return { board: "daily" as const, seed: daily.seed >>> 0 || 1 };
    } catch {
      return { board: "daily" as const, seed: localDailySeed() };
    }
  }

  function launchEndless(board: LeaderboardBoard, seed?: number) {
    pendingEndlessLaunch = { board, seed: (seed ?? randomEndlessSeed()) >>> 0 || 1 };
    customization = { ...customization, selectedMode: "endless" };
    saveCustomization(customization);
    garageUi.update(customization);
    void startEvent();
  }

  async function launchDailyEndless() {
    try {
      const daily = await leaderboardClient.fetchDailySeed();
      launchEndless("daily", daily.seed);
    } catch {
      launchEndless("daily", localDailySeed());
    }
  }

  const getPracticeSpawn = () => {
    if (activeMode !== "free-drive") return activeTrack.start;
    return activeTrack.practiceZones?.[practiceZoneIndex] ?? activeTrack.start;
  };

  const getQueuePortal = () => activeTrack.portals?.find((portal) => portal.mode === "drift-attack") ?? null;

  function hashRoomCode(roomCode: string) {
    let hash = 0;
    for (const char of roomCode) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
    return hash;
  }

  function getQueuePadForRoom(roomCode: string) {
    const hash = hashRoomCode(roomCode);
    const slot = hash % 12;
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    return {
      roomCode,
      x: -480 + col * 320,
      z: 430 - row * 170,
      heading: ((hash >> 8) % 2) * Math.PI,
    };
  }

  function setActiveQueuePad(roomCode: string) {
    activeQueuePad = getQueuePadForRoom(roomCode);
    queueSlab.setRoom(roomCode, activeQueuePad);
    parkLocalCarOnQueuePad();
  }

  function clearActiveQueuePad() {
    activeQueuePad = null;
    queueSlab.hide();
  }

  function transformQueueLocal(localX: number, localZ: number) {
    if (!activeQueuePad) return null;
    const cos = Math.cos(activeQueuePad.heading);
    const sin = Math.sin(activeQueuePad.heading);
    return {
      x: activeQueuePad.x + cos * localX + sin * localZ,
      z: activeQueuePad.z - sin * localX + cos * localZ,
    };
  }

  function getQueuePose(index: number, count: number) {
    if (!activeQueuePad) return null;
    const safeCount = Math.max(1, count);
    const radius = safeCount <= 1 ? 0 : 10.2;
    const angle = -Math.PI / 2 + (index / safeCount) * Math.PI * 2;
    const position = transformQueueLocal(Math.cos(angle) * radius, Math.sin(angle) * radius);
    if (!position) return null;
    return {
      x: position.x,
      z: position.z,
      heading: Math.atan2(activeQueuePad.x - position.x, activeQueuePad.z - position.z),
      speed: 0,
    };
  }

  function applyQueuePose(pose: { x: number; z: number; heading: number; speed: number }) {
    car.position.x = pose.x;
    car.position.z = pose.z;
    car.heading = pose.heading;
    car.velocity.x = 0;
    car.velocity.z = 0;
    car.speed = pose.speed;
    car.yawVelocity = 0;
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    car.frontWheelAngle = 0;
  }

  function parkLocalCarOnQueuePad() {
    const pose = getQueuePose(0, 1);
    if (pose) applyQueuePose(pose);
  }

  function stagedOnlinePlayers(room: OnlineRoomState): OnlinePlayerState[] {
    return room.players.map((player, index) => {
      const pose = getQueuePose(index, room.players.length);
      return pose ? { ...player, pose } : player;
    });
  }

  function lockLocalCarToQueue(room: OnlineRoomState) {
    const index = room.players.findIndex((player) => player.id === onlinePlayerId);
    if (index < 0) return;
    const pose = getQueuePose(index, room.players.length);
    if (!pose) return;
    applyQueuePose(pose);
  }

  function returnCarToQueuePortal() {
    const portal = getQueuePortal();
    if (!portal) {
      resetCar(car, activeTrack);
      return;
    }
    const heading = portal.heading ?? 0;
    car.position.x = portal.x - Math.sin(heading) * 18;
    car.position.z = portal.z - Math.cos(heading) * 18;
    car.heading = heading;
    car.velocity.x = 0;
    car.velocity.z = 0;
    car.speed = 0;
    car.yawVelocity = 0;
  }

  let startEventPending = false;
  let startEventRequestedAt = 0;

  const disposeSceneRoot = (root: object & { traverse: (callback: (child: object) => void) => void }) => {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  };

  const switchTrack = async (nextTrack: TrackConfig) => {
    if (activeTrack.id === nextTrack.id) return;
    endlessTrackView?.dispose();
    endlessTrackView = null;
    gameScene.remove(trackView.root);
    disposeSceneRoot(trackView.root);
    activeTrack = nextTrack;
    if (activeTrack.id === "endless") {
      const root = new Group();
      gameScene.add(root);
      trackView = { root, coneMeshes: [], cornerMarkers: [] };
    } else {
      trackView = await createTrackView(gameScene, activeTrack);
    }
    setupArenaLighting();
    colliders = createTrackColliders(activeTrack);
    coneMeshes = trackView.coneMeshes;
    cornerMarkers = trackView.cornerMarkers;
    onlineGhosts.setTrack(activeTrack);
    practiceZoneIndex = 0;
  };

  const reloadActiveTrack = async () => {
    if (activeTrack.id === "endless") return;
    gameScene.remove(trackView.root);
    disposeSceneRoot(trackView.root);
    trackView = await createTrackView(gameScene, activeTrack);
    setupArenaLighting();
    colliders = createTrackColliders(activeTrack);
    coneMeshes = trackView.coneMeshes;
    cornerMarkers = trackView.cornerMarkers;
    onlineGhosts.setTrack(activeTrack);
  };

  const mapEditor = createMapEditor(canvas, gameCamera, gameScene, { onReloadTrack: reloadActiveTrack });

  const resetEvent = () => {
    resetCar(car, activeTrack, getPracticeSpawn());
    resetDrift(drift);
    if (activeMode === "endless") {
      endlessTrack = createEndlessTrack(activeEndlessSeed);
      endlessRun = createEndlessState(activeEndlessSeed, {
        carId: customization.selectedCar,
        tuningPreset: customization.tuningPreset,
      });
      endlessTrackView?.dispose();
      endlessTrackView = createEndlessTrackView(gameScene);
      endlessTrackView.update(endlessTrack.state, car.position);
      sessionTime = endlessRun.state.clock;
      recordEndlessRunStart(endlessRecords);
    } else {
      endlessTrack = null;
      endlessRun = null;
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
    replayCarView.root.visible = false;
    resetChaseCamera(gameCamera, car);
  };

  const showGarage = () => {
    startEventPending = false;
    portalLaunchPending = false;
    resetInputState();
    appState = "garage";
    results.hide();
    endlessResults.hide();
    leaderboardUi.hide();
    replayOverlay.hide();
    endlessTrackView?.dispose();
    endlessTrackView = null;
    endlessTrack = null;
    endlessRun = null;
    replaySession = null;
    hud.root.hidden = true;
    onlineHud.hide();
    mapEditor.hide();
    onlineMatchUi.hideAll();
    onlineClient.disconnect();
    onlineRoom = null;
    onlinePlayerId = null;
    onlineMatchActive = false;
    onlineQueueOpen = false;
    onlineInputDebt = 0;
    onlineGhosts.clearRemotePlayers();
    clearActiveQueuePad();
    fixedStepRunner.reset();
    carView.root.visible = true;
    replayCarView.root.visible = false;
    tireTracks.root.visible = true;
    tireSmoke.root.visible = true;
    garageUi.update(customization);
    garageUi.show();
    garageView.applyCustomization(customization);
    if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
    else attachmentTuner.hide();
  };

  const startEvent = async () => {
    const now = performance.now();
    if (startEventPending && now - startEventRequestedAt < 2500) return;
    startEventPending = true;
    startEventRequestedAt = now;
    if (!isPlayableMode(customization.selectedMode)) {
      customization = { ...customization, selectedMode: "drift-attack" };
      saveCustomization(customization);
      garageUi.update(customization);
    }
    resetInputState();
    activeMode = customization.selectedMode;
    try {
      if (activeMode === "endless") {
        const launch = await resolveEndlessLaunch();
        activeEndlessBoard = launch.board;
        activeEndlessSeed = launch.seed;
      }
      await switchTrack(getTrackForMode(activeMode));
      baseTuning = await loadCarTuning(customization.selectedCar);
      activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
      appState = "event";
      results.hide();
      endlessResults.hide();
      leaderboardUi.hide();
      replayOverlay.hide();
      garageUi.hide();
      attachmentTuner.hide();
      resetEvent();
      if (activeMode !== "online-lobby") clearActiveQueuePad();
      setHudCarName();
      if (activeMode === "map-editor") {
        hud.root.hidden = true;
        onlineHud.hide();
        onlineMatchUi.hideAll();
        carView.root.visible = false;
        tireTracks.root.visible = false;
        tireSmoke.root.visible = false;
        onlineGhosts.root.visible = false;
        mapEditor.show(activeTrack);
      } else {
        mapEditor.hide();
        carView.root.visible = true;
        tireTracks.root.visible = true;
        tireSmoke.root.visible = true;
        hud.root.hidden = false;
        hud.setMode(
          activeMode === "online-lobby"
            ? "online-lobby"
            : activeMode === "free-drive"
              ? "free-drive"
              : activeMode === "endless"
                ? "endless"
                : "drift-attack",
        );
      }
      canvas.focus();
    } catch (error) {
      console.error("Could not start event", error);
      appState = "garage";
      hud.root.hidden = true;
      garageUi.show();
    } finally {
      startEventPending = false;
    }
  };

  const beginOnlineDriftMatch = async () => {
    if (startEventPending) return;
    startEventPending = true;
    activeMode = "drift-attack";
    customization = { ...customization, selectedMode: "online-lobby" };
    saveCustomization(customization);
    resetInputState();
    try {
      await switchTrack(driftTrack);
      baseTuning = await loadCarTuning(customization.selectedCar);
      activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
      appState = "event";
      onlineMatchActive = true;
      onlineInputDebt = 0;
      results.hide();
      hud.root.hidden = false;
      garageUi.hide();
      attachmentTuner.hide();
      mapEditor.hide();
      carView.root.visible = true;
      tireTracks.root.visible = true;
      tireSmoke.root.visible = true;
      onlineMatchUi.hideQueue();
      clearActiveQueuePad();
      resetEvent();
      setHudCarName();
      hud.setMode("drift-attack");
      canvas.focus();
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
    onlineHud.hide();
    results.show(finalScore, drift.bestCombo, drift.bestRun);
  };

  const finishEndlessRun = () => {
    if (appState !== "event" || activeMode !== "endless" || !endlessRun) return;
    const finalScore = finishDriftRun(drift);
    endlessRun.syncTelemetry({
      car,
      drift,
      trackProgress: endlessTrack?.state.progressDistance ?? endlessRun.state.distance,
      nextGateDistance: endlessTrack?.state.nextGateDistance ?? Infinity,
      onTrack: endlessTrack?.isOnTrack(car.position) ?? false,
    });
    endlessRun.captureCheckpoint(car, true);
    const runState = endlessRun.state;
    const failReason = runState.failReason ?? "clock";
    const replay = endlessRun.finish({
      carId: customization.selectedCar,
      tuningPreset: customization.tuningPreset,
      finalScore,
      gatesPassed: runState.gatesPassed,
      distance: runState.distance,
      duration: runState.duration,
    });
    const summary: EndlessRunSummary = {
      score: finalScore,
      bestCombo: Math.max(drift.bestCombo, runState.bestCombo),
      stage: runState.stage,
      distance: runState.distance,
      gatesPassed: runState.gatesPassed,
      duration: runState.duration,
      objectivesCompleted: runState.objectivesCompleted,
      failReason,
      seed: runState.seed,
      board: activeEndlessBoard,
      createdAt: Date.now(),
    };
    const record = commitEndlessRun(endlessRecords, summary);

    appState = "results";
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    hud.root.hidden = true;
    onlineHud.hide();
    results.hide();
    endlessResults.show({
      finalScore,
      bestCombo: summary.bestCombo,
      stage: summary.stage,
      gatesPassed: summary.gatesPassed,
      distance: summary.distance,
      duration: summary.duration,
      failReason,
      objectivesCompleted: summary.objectivesCompleted,
      isPersonalBest: record.isPersonalBest,
      bestScore: record.bestScore,
      nextTarget: record.nextTarget,
    });

    if (finalScore <= 0) {
      endlessResults.setSubmission("Build a scoring drift to post this run.");
      return;
    }
    void leaderboardClient.submitRun(replay, activeEndlessBoard, playerProfile.name).then(
      (response) => {
        const rank = response.rank ? ` Rank #${response.rank}.` : "";
        endlessResults.setSubmission(`${response.message}${rank}`);
      },
      (error: unknown) => {
        endlessResults.setSubmission(
          error instanceof Error ? `Run saved locally. ${error.message}` : "Run saved locally; upload failed.",
          true,
        );
      },
    );
  };

  const finishOnlineRun = (room: OnlineRoomState) => {
    onlineMatchActive = false;
    onlineQueueOpen = false;
    onlineRoom = room;
    appState = "results";
    car.throttleAxis = 0;
    car.brakeAxis = 0;
    hud.root.hidden = true;
    onlineHud.hide();
    onlineMatchUi.updateRoom(room);
    onlineMatchUi.hideQueue();
    clearActiveQueuePad();
    const local = room.players.find((player) => player.id === onlinePlayerId);
    results.show(local ? local.score : finishDriftRun(drift), drift.bestCombo, drift.bestRun);
  };

  let portalLaunchPending = false;
  const leaveOnlineQueue = () => {
    onlineClient.disconnect();
    onlineRoom = null;
    onlinePlayerId = null;
    onlineMatchActive = false;
    onlineQueueOpen = false;
    onlineInputDebt = 0;
    onlineMatchUi.hideAll();
    onlineGhosts.clearRemotePlayers();
    clearActiveQueuePad();
    if (activeMode === "online-lobby") returnCarToQueuePortal();
  };

  const launchModeFromPortal = (mode: "drift-attack" | "free-drive") => {
    if (portalLaunchPending || startEventPending) return;
    if (mode === "drift-attack" && activeMode === "online-lobby") {
      if (onlineQueueOpen) {
        onlineMatchUi.show(onlineRoom?.roomCode ?? activeQueuePad?.roomCode);
        return;
      }
      onlineMatchUi.showModal();
      return;
    }
    portalLaunchPending = true;
    customization = { ...customization, selectedMode: mode };
    saveCustomization(customization);
    garageUi.update(customization);
    void startEvent().finally(() => {
      portalLaunchPending = false;
    });
  };

  let onlineClient: OnlineClient;
  const onlineMatchUi = createOnlineMatchUi({
    onConnect(roomCode) {
      onlineQueueOpen = true;
      onlineRoom = null;
      onlinePlayerId = null;
      onlineGhosts.clearRemotePlayers();
      const joinedCode = onlineClient.connect(playerProfile, customization, roomCode);
      setActiveQueuePad(joinedCode);
      onlineMatchUi.show(joinedCode);
    },
    onReady(ready) {
      onlineClient.setReady(ready);
    },
    onLeave() {
      leaveOnlineQueue();
    },
    onShowQueue() {
      onlineQueueOpen = true;
      onlineRoom = null;
      onlinePlayerId = null;
      onlineGhosts.clearRemotePlayers();
      onlineMatchUi.show();
    },
  });

  onlineClient = createOnlineClient({
    onJoined(playerId, room) {
      onlinePlayerId = playerId;
      onlineRoom = room;
      if (!activeQueuePad || activeQueuePad.roomCode !== room.roomCode) setActiveQueuePad(room.roomCode);
      onlineMatchUi.setLocalPlayer(playerId);
      onlineMatchUi.updateRoom(room);
      if (activeMode === "online-lobby" && onlineQueueOpen) {
        lockLocalCarToQueue(room);
        onlineGhosts.setRemotePlayers(stagedOnlinePlayers(room), onlinePlayerId);
      }
    },
    onRoom(room) {
      onlineRoom = room;
      if (activeMode === "online-lobby" && onlineQueueOpen && (!activeQueuePad || activeQueuePad.roomCode !== room.roomCode)) {
        setActiveQueuePad(room.roomCode);
      }
      onlineMatchUi.updateRoom(room);
      if (onlineMatchActive) onlineGhosts.setRemotePlayers(room.players, onlinePlayerId);
      else if (activeMode === "online-lobby" && onlineQueueOpen) {
        lockLocalCarToQueue(room);
        onlineGhosts.setRemotePlayers(stagedOnlinePlayers(room), onlinePlayerId);
      }
    },
    onMatchStart(room) {
      onlineRoom = room;
      onlineMatchUi.updateRoom(room);
      void beginOnlineDriftMatch();
    },
    onMatchEnd(room) {
      finishOnlineRun(room);
    },
    onError(message) {
      onlineMatchUi.setStatus(message);
    },
    onStatus(message) {
      onlineMatchUi.setStatus(message);
    },
  });

  const vfxEditor = createVfxEditor();
  const replayOverlay = createReplayOverlay(() => exitReplay());
  const leaderboardUi = createLeaderboardUi<ReplayData>(leaderboardClient, {
    onWatch: (entry, replay) => startReplay(entry, replay),
    onClose: () => canvas.focus(),
  });
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
      garageView.applyCustomization(customization);
      carView.applyCustomization(customization);
      if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
      else attachmentTuner.hide();
    },
    onModeChange(mode) {
      startEventPending = false;
      const nextMode = isPlayableMode(mode) ? mode : "drift-attack";
      customization = { ...customization, selectedMode: nextMode };
      saveCustomization(customization);
      garageUi.update(customization);
    },
    onProfileChange(profile) {
      playerProfile = { name: profile.name.trim().slice(0, 18) || "Driver" };
      savePlayerProfile(playerProfile);
      garageUi.update(customization, playerProfile);
    },
    onStart: startEvent,
    onOpenVfxLab: () => vfxEditor.show(),
    onOpenLeaderboard: () => leaderboardUi.show(),
  });

  const results = createResultsOverlay(startEvent, showGarage);
  const endlessResults = createEndlessResultsOverlay({
    onRetry: () => launchEndless("all-time"),
    onDailyRetry: () => void launchDailyEndless(),
    onLeaderboard: () => leaderboardUi.show(activeEndlessBoard),
    onGarage: showGarage,
  });
  hud.root.hidden = true;

  const onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.15));
    renderer.setSize(window.innerWidth, window.innerHeight);
    postPipeline?.setSize(window.innerWidth, window.innerHeight);
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

  function getNearbyPortal() {
    if (activeMode !== "online-lobby" || !activeTrack.portals) return null;
    return activeTrack.portals.find((portal) => {
      return Math.hypot(car.position.x - portal.x, car.position.z - portal.z) <= portal.radius;
    }) ?? null;
  }

  const screenProjector = new Vector3();
  function projectOnlineLabel(position: { x: number; z: number }, distance: number) {
    screenProjector.set(position.x, 3.2, position.z).project(gameCamera);
    const visible =
      screenProjector.z > -1 &&
      screenProjector.z < 1 &&
      screenProjector.x > -1.12 &&
      screenProjector.x < 1.12 &&
      screenProjector.y > -1.08 &&
      screenProjector.y < 1.08;
    return {
      x: (screenProjector.x * 0.5 + 0.5) * window.innerWidth,
      y: (-screenProjector.y * 0.5 + 0.5) * window.innerHeight,
      visible,
      scale: Math.max(0.72, Math.min(1, 1.08 - distance / 260)),
    };
  }

  const applyFocusLighting = () => {
    if (arenaRig) arenaRig.update(car.position);
    else updateSceneLighting(gameScene, car.position);
  };

  async function startReplay(entry: LeaderboardEntry, data: ReplayData) {
    const decoded = deserializeReplay(data);
    const tuning = applyTuningPreset(await loadCarTuning(data.carId), data.tuningPreset);
    await switchTrack(endlessTrackStub);
    endlessTrackView?.dispose();
    const track = createEndlessTrack(data.seed);
    const replayCar = createCarState(endlessTrackStub);
    const replayCustomization: CarCustomization = {
      ...customization,
      ...loadCarCustomization(data.carId),
      selectedCar: data.carId,
      selectedMode: "endless",
      tuningPreset: data.tuningPreset,
    };
    replayCarView.applyCustomization(replayCustomization);
    await replayCarView.whenReady();
    endlessTrackView = createEndlessTrackView(gameScene);
    endlessTrackView.update(track.state, replayCar.position);
    replaySession = {
      entry,
      data,
      decoded,
      sampler: createReplayInputSampler(decoded.inputs),
      car: replayCar,
      track,
      tuning,
      elapsed: 0,
      accumulator: 0,
      checkpointCursor: 0,
      finished: false,
    };
    endlessTrack = null;
    endlessRun = null;
    activeMode = "endless";
    appState = "replay";
    resetInputState();
    fixedStepRunner.reset();
    tireTracks.reset();
    tireSmoke.reset();
    carView.root.visible = false;
    replayCarView.root.visible = true;
    onlineGhosts.root.visible = false;
    hud.root.hidden = true;
    onlineHud.hide();
    results.hide();
    endlessResults.hide();
    leaderboardUi.hide();
    replayOverlay.show(entry, data.version !== PHYSICS_VERSION);
    resetChaseCamera(gameCamera, replayCar);
    canvas.focus();
  }

  function exitReplay() {
    if (appState !== "replay") return;
    replaySession = null;
    replayOverlay.hide();
    replayCarView.root.visible = false;
    endlessTrackView?.dispose();
    endlessTrackView = null;
    showGarage();
    leaderboardUi.show();
  }

  function updateReplay(dt: number) {
    const session = replaySession;
    if (!session) {
      exitReplay();
      return;
    }
    const liveInput = readInput();
    if (liveInput.menu) {
      exitReplay();
      return;
    }

    if (!session.finished) {
      session.accumulator = Math.min(0.1, session.accumulator + Math.max(0, dt));
      while (session.accumulator + 1e-9 >= REPLAY_FIXED_STEP_SECONDS && session.elapsed < session.data.duration) {
        const recorded = session.sampler.sample(session.elapsed);
        const replayInput: InputState = {
          throttle: recorded.throttle,
          brake: recorded.brake,
          steer: recorded.steer,
          handbrake: recorded.handbrake,
          reset: false,
          confirm: false,
          zoneNext: false,
          debug: false,
          menu: false,
        };
        session.track.update(session.car.position);
        const onTrack = session.track.isOnTrack(session.car.position);
        updateCar(session.car, replayInput, session.tuning, REPLAY_FIXED_STEP_SECONDS, onTrack, handlingProfile);
        updateTrackCollision(session.car, session.track.getColliders(), REPLAY_FIXED_STEP_SECONDS, session.tuning);
        session.elapsed = Math.min(session.data.duration, session.elapsed + REPLAY_FIXED_STEP_SECONDS);
        session.accumulator -= REPLAY_FIXED_STEP_SECONDS;

        while (
          session.checkpointCursor < session.decoded.checkpoints.length &&
          session.decoded.checkpoints[session.checkpointCursor].t <= session.elapsed + 1e-6
        ) {
          const checkpoint = session.decoded.checkpoints[session.checkpointCursor++];
          const error = Math.hypot(session.car.position.x - checkpoint.x, session.car.position.z - checkpoint.z);
          if (error > 2) {
            session.car.position.x = checkpoint.x;
            session.car.position.z = checkpoint.z;
            session.car.heading = checkpoint.heading;
            session.car.speed = checkpoint.speed;
            session.car.velocity.x = Math.sin(checkpoint.heading) * checkpoint.speed;
            session.car.velocity.z = Math.cos(checkpoint.heading) * checkpoint.speed;
            session.car.yawVelocity = 0;
          }
        }
      }
      if (session.elapsed >= session.data.duration - 1e-6) {
        session.finished = true;
        replayOverlay.setFinished();
      }
    }

    const onTrack = session.track.isOnTrack(session.car.position);
    endlessTrackView?.update(session.track.state, session.car.position);
    tireTracks.update(session.car, onTrack);
    tireSmoke.update(session.car, onTrack, dt);
    replayCarView.sync(session.car);
    engineSound.update(session.car, session.tuning);
    updateChaseCamera(gameCamera, session.car, dt, 0, getCameraOrbit(), session.track.state.barriers);
    updateSceneLighting(gameScene, session.car.position);
    replayOverlay.update(session.elapsed, session.data.duration);
    lastFixedSteps = Math.round(Math.min(0.1, dt) / REPLAY_FIXED_STEP_SECONDS);
    lastDroppedSeconds = Math.max(0, dt - 0.1);
    renderGameScene(dt);
  }

  function updateEvent(dt: number) {
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

    if (activeMode === "map-editor") {
      fixedStepRunner.reset();
      lastFixedSteps = 0;
      lastDroppedSeconds = 0;
      if (input.menu) {
        showGarage();
        return;
      }
      mapEditor.update(dt);
      renderGameScene(dt);
      return;
    }

    if (input.zoneNext && activeMode === "free-drive" && activeTrack.practiceZones?.length) {
      practiceZoneIndex = (practiceZoneIndex + 1) % activeTrack.practiceZones.length;
      resetEvent();
    }
    const queueStaging = activeMode === "online-lobby" && onlineQueueOpen && !onlineMatchActive;
    if (input.reset && !queueStaging) resetEvent();
    if (input.menu) {
      if (queueStaging) leaveOnlineQueue();
      else showGarage();
      return;
    }

    if (queueStaging) {
      fixedStepRunner.reset();
      lastFixedSteps = 0;
      lastDroppedSeconds = 0;
      if (input.confirm && onlineRoom) {
        const local = onlineRoom.players.find((player) => player.id === onlinePlayerId);
        onlineClient.setReady(!local?.ready);
      }

      if (onlineRoom) {
        lockLocalCarToQueue(onlineRoom);
        onlineGhosts.setRemotePlayers(stagedOnlinePlayers(onlineRoom), onlinePlayerId);
      } else if (activeQueuePad) {
        parkLocalCarOnQueuePad();
      }

      onlineGhosts.root.visible = true;
      onlineGhosts.update(dt);
      tireSmoke.reset();
      carView.sync(car);
      updateCornerMarkerFlex(cornerMarkers, car, dt);
      engineSound.update(car, activeTuning);
      cameraShake = Math.max(0, cameraShake - dt * 1.7);
      updateChaseCamera(gameCamera, car, dt, cameraShake, getCameraOrbit(), colliders.barriers);
      applyFocusLighting();
      hud.update(car, drift);
      hud.updateTimer(Infinity);
      hud.setOnlineStatus(onlineRoom ? `Queue Pad ${onlineRoom.roomCode}` : "Opening Queue Pad");
      const ghostPlayers = onlineGhosts.getPlayers();
      const onlinePlayers: OnlineHudPlayer[] = [
        {
          id: "local-player",
          name: "You",
          color: 0xf1c75b,
          position: { ...car.position },
          speedMph: 0,
          local: true,
          distance: 0,
        },
        ...ghostPlayers.map((player) => {
          const distance = Math.hypot(player.position.x - car.position.x, player.position.z - car.position.z);
          return {
            ...player,
            distance,
            screen: projectOnlineLabel(player.position, distance),
          };
        }),
      ];
      onlineHud.update({
        players: onlinePlayers,
        localPosition: car.position,
        portalLabel: onlineRoom
          ? `Pad ${onlineRoom.roomCode}: Press E to ready - Esc leaves`
          : activeQueuePad
            ? `Opening private queue pad ${activeQueuePad.roomCode}`
            : "Joining Drift Attack queue",
      });
      hud.root.hidden = false;
      renderGameScene(dt);
      return;
    }

    if (activeMode === "drift-attack") {
      sessionTime = onlineMatchActive && onlineRoom?.matchEndsAt
        ? Math.max(0, (onlineRoom.matchEndsAt - Date.now()) / 1000)
        : Math.max(0, (sessionEndsAt - performance.now()) / 1000);
      if (sessionTime <= 0 && !onlineMatchActive) {
        sessionTime = 0;
        finishRun();
        return;
      }
    }

    const runningEndless = activeMode === "endless" && endlessTrack !== null && endlessRun !== null;
    let frameImpact = 0;
    let scoringSurface = runningEndless && endlessTrack
      ? endlessTrack.isOnTrack(car.position)
      : isOnTrack(car.position, activeTrack);
    const fixedStats = fixedStepRunner.advance(dt, (stepDt) => {
      if (runningEndless && (!endlessRun || !endlessTrack || !endlessRun.state.alive)) return;
      if (playerRouteProbeEnabled && activeMode === "drift-attack") playerRouteProbe.elapsed += stepDt;
      const endlessUpdate = runningEndless && endlessTrack ? endlessTrack.update(car.position) : null;
      if (runningEndless && endlessRun && endlessUpdate) {
        endlessRun.recordStep(input, car, stepDt);
        for (const gate of endlessUpdate.passedGates) endlessRun.onGatePassed(gate.distance);
      }
      const gearBeforeStep = car.gear;
      const surfaceBeforeStep = runningEndless && endlessTrack
        ? endlessTrack.isOnTrack(car.position)
        : isOnTrack(car.position, activeTrack);
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

      const stepOnTrack = runningEndless && endlessTrack
        ? endlessTrack.isOnTrack(car.position)
        : isOnTrack(car.position, activeTrack);
      const stepInRunoff = runningEndless && endlessTrack
        ? endlessTrack.isInRunoff(car.position)
        : isInRunoff(car.position, activeTrack);
      if (stepOnTrack) runoffTime = 0;
      else if (stepInRunoff) runoffTime += stepDt;
      else runoffTime = 999;
      scoringSurface = stepOnTrack || (stepInRunoff && runoffTime <= 1.15);

      const boundaryImpact = runningEndless ? 0 : keepCarNearTrack(car, activeTrack);
      const collisionImpact = updateTrackCollision(
        car,
        runningEndless && endlessTrack ? endlessTrack.getColliders() : colliders,
        stepDt,
        activeTuning,
      );
      const stepImpact = Math.max(boundaryImpact, collisionImpact);
      frameImpact = Math.max(frameImpact, stepImpact);

      if (activeMode === "drift-attack" || runningEndless) {
        const driftZone = runningEndless && endlessTrack
          ? Math.floor(endlessTrack.getProgress(car.position) / 80)
          : getDriftZone(car.position, activeTrack);
        updateDriftScore(drift, car, stepDt, scoringSurface, driftZone, stepImpact);
        if (playerRouteProbeEnabled) playerRouteProbe.score = drift.totalScore + drift.comboScore;
      }
      if (runningEndless && endlessRun && endlessTrack) {
        endlessRun.syncTelemetry({
          car,
          drift,
          trackProgress: endlessTrack.state.progressDistance,
          nextGateDistance: endlessTrack.getNextGateDistance(car.position),
          onTrack: scoringSurface,
        }, stepDt);
        endlessRun.update(stepDt);
        endlessRun.onCrash(stepImpact);
      }
      if (onlineMatchActive) onlineInputDebt += stepDt;
    });
    lastFixedSteps = fixedStats.steps;
    lastDroppedSeconds = fixedStats.droppedSeconds;

    if (runningEndless && endlessRun) {
      sessionTime = endlessRun.state.clock;
      for (const event of endlessRun.consumeEvents()) {
        if (event.type === "objective-complete") {
          drift.callout = "Objective complete";
          drift.calloutTimer = 1.4;
        } else if (event.type === "gate") {
          drift.callout = `Gate ${event.gatesPassed} +${event.clockAdded}s`;
          drift.calloutTimer = 1.35;
        } else if (event.type === "stage" && event.majorMilestone) {
          drift.callout = `Milestone - Stage ${event.stage}`;
          drift.calloutTimer = 1.7;
        }
      }
      if (!endlessRun.state.alive) {
        finishEndlessRun();
        return;
      }
    }

    const onTrack = runningEndless && endlessTrack
      ? endlessTrack.isOnTrack(car.position)
      : isOnTrack(car.position, activeTrack);
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (frameImpact > 0) cameraShake = Math.max(cameraShake, frameImpact * 0.75);

    if (onlineMatchActive) {
      if (onlineInputDebt >= 1 / 20) {
        onlineInputDebt %= 1 / 20;
        onlineClient.sendInput({
          seq: ++onlineInputSeq,
          steer: input.steer,
          throttle: input.throttle,
          brake: input.brake,
          handbrake: input.handbrake,
          reset: input.reset,
          pose: {
            x: car.position.x,
            z: car.position.z,
            heading: car.heading,
            speed: car.speed,
          },
          speedMph: car.speed * 2.237,
          angle: car.slipAngle,
          rearSlip: car.rearSlipAngle,
          driftAmount: car.driftAmount,
          onTrack: scoringSurface,
          score: drift.totalScore + drift.comboScore,
          combo: drift.comboScore,
          multiplier: drift.multiplier,
        });
      }
    }

    syncConeMeshes(coneMeshes, colliders.cones);
    if (runningEndless && endlessTrack) endlessTrackView?.update(endlessTrack.state, car.position);
    if (onlineMatchActive && onlineRoom) onlineGhosts.setRemotePlayers(onlineRoom.players, onlinePlayerId);
    onlineGhosts.root.visible = activeMode === "online-lobby" || onlineMatchActive;
    onlineGhosts.update(dt);

    const nearbyPortal = getNearbyPortal();
    if (nearbyPortal && input.confirm) launchModeFromPortal(nearbyPortal.mode);

    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    updateCornerMarkerFlex(cornerMarkers, car, dt);
    engineSound.update(car, activeTuning);
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    updateChaseCamera(
      gameCamera,
      car,
      dt,
      cameraShake,
      getCameraOrbit(),
      runningEndless && endlessTrack ? endlessTrack.state.barriers : colliders.barriers,
    );
    applyFocusLighting();
    hud.update(car, drift);
    hud.updateTimer(sessionTime);
    if (runningEndless && endlessRun) {
      const objective = endlessRun.state.objective;
      const progress = objective.unit === "score"
        ? `${Math.round(objective.value).toLocaleString("en-US")} / ${Math.round(objective.target).toLocaleString("en-US")}`
        : objective.unit === "meters"
          ? `${Math.round(objective.value)} / ${Math.round(objective.target)} m`
          : objective.unit === "seconds"
            ? `${objective.value.toFixed(1)} / ${objective.target.toFixed(1)}s`
            : `${Math.floor(objective.value)} / ${Math.floor(objective.target)}`;
      hud.setEndlessStats({
        stage: endlessRun.state.stage,
        gatesPassed: endlessRun.state.gatesPassed,
        distance: endlessRun.state.distance,
        nextGateDistance: endlessRun.state.nextGateDistance,
        potential: endlessRun.state.potentialBonus,
        objective: objective.label,
        objectiveProgress: objective.completed ? "Complete" : progress,
        bestDelta: Math.round(endlessRun.state.totalScore - endlessRecords.bestScore),
        risk: endlessRun.state.riskLevel === "safe"
          ? "Low"
          : endlessRun.state.riskLevel === "building"
            ? "Medium"
            : "High",
      });
      onlineHud.hide();
    } else if (activeMode === "free-drive") {
      hud.setPracticeZone(activeTrack.practiceZones?.[practiceZoneIndex]?.label ?? "Practice");
      onlineHud.hide();
    } else if (activeMode === "online-lobby") {
      hud.setOnlineStatus(nearbyPortal ? `${nearbyPortal.label} Hauler` : "Cruise Lobby");
      const ghostPlayers = onlineGhosts.getPlayers();
      const onlinePlayers: OnlineHudPlayer[] = [
        {
          id: "local-player",
          name: "You",
          color: 0xf1c75b,
          position: { ...car.position },
          speedMph: car.speed * 2.237,
          local: true,
          distance: 0,
        },
        ...ghostPlayers.map((player) => {
          const distance = Math.hypot(player.position.x - car.position.x, player.position.z - car.position.z);
          return {
            ...player,
            distance,
            screen: projectOnlineLabel(player.position, distance),
          };
        }),
      ];
      onlineHud.update({
        players: onlinePlayers,
        localPosition: car.position,
        portalLabel: nearbyPortal
          ? nearbyPortal.mode === "drift-attack"
            ? "Press E to open a private Drift Attack queue pad"
            : `Press E to confirm travel to ${nearbyPortal.label}`
          : null,
      });
    } else {
      onlineHud.hide();
    }
    hud.root.hidden = false;
    renderGameScene(dt);
  }

  let prevAppState: AppState = appState;
  function frame(timestamp?: number) {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.25);

    if (appState !== prevAppState) {
      if (appState === "event" || appState === "replay") engineSound.resume();
      else engineSound.suspend();
      prevAppState = appState;
    }

    if (appState === "garage") {
      lastFixedSteps = 0;
      lastDroppedSeconds = 0;
      garageView.update(dt);
      garageView.render();
    } else if (appState === "event") {
      updateEvent(dt);
    } else if (appState === "replay") {
      updateReplay(dt);
    } else {
      renderGameScene(dt);
    }

    performanceMonitor.update(dt, lastFixedSteps, lastDroppedSeconds);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
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
