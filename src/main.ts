import "./style.css";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Timer, Vector3, type Texture } from "three";
import {
  applyTuningPreset,
  carTuningPaths,
  getCarLabel,
  isPlayableMode,
  loadCarCustomization,
  loadCustomization,
  mapEditorEnabled,
  paintColors,
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
import { createRenderer, isMobileDevice } from "./render/app/createRenderer";
import { createPerformanceMonitor } from "./render/app/performanceMonitor";
import { createScene, updateSceneLighting } from "./render/app/createScene";
import { createArenaLightRig, type ArenaLightRig } from "./render/arena/lightRig";
import { bakeArenaEnvironment } from "./render/arena/environmentBake";
import { createPostPipeline, type PostPipeline } from "./render/post/postPipeline";
import { createCarView } from "./render/objects/carView";
import { createTireSmoke, saveTireSmokePresetName, clearTireSmokePresetName, resolveTireSmokePreset, type ApplyPresetResult } from "./render/objects/tireSmokeGpu";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTrackView, updateCornerMarkerFlex, type TrackViewResult } from "./render/objects/trackView";
import { createOnlineGhosts } from "./render/objects/onlineGhosts";
import { createQueueSlab } from "./render/objects/queueSlab";
import { createGarageUi } from "./ui/garageUi";
import { createMainMenu } from "./ui/mainMenu";
import { createLoadingOverlay } from "./ui/loadingOverlay";
import { createFullscreenToggle } from "./ui/fullscreenToggle";
import { createEndlessResultsOverlay, createHud, createResultsOverlay } from "./ui/hud";
import { createOnlineHud, type OnlineHudPlayer } from "./ui/onlineHud";
import { createOnlineMatchUi } from "./ui/onlineMatchUi";
import { createVfxEditor } from "./ui/vfxEditor";
import { isImportedCar } from "./render/objects/importedCars";
import { createGarageView } from "./render/garage/garageView";
import { createEngineSound } from "./audio/engineSound";
import { createTrackColliders, updateTrackCollision, type Barrier } from "./game/simulation/trackCollision";
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
import { createEndlessTrack } from "./game/endless/endlessTrack";
import { createObstacleManager } from "./game/endless/endlessObstacles";
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
import { createObstacleCarView } from "./render/endless/obstacleCarView";
import { createReplayCarView } from "./render/endless/replayCarView";
import { createLeaderboardClient } from "./net/leaderboard";
import { createLeaderboardUi } from "./ui/leaderboardUi";
import { createReplayOverlay } from "./ui/replayOverlay";

type AppState = "garage" | "event" | "results" | "replay";
const eventCarScale = 1.55;

function visualizeBarriers(scene: { add: (obj: Object3D) => void }, barriers: Barrier[]) {
  const geo = new BoxGeometry(1, 2, 1);
  const mat = new MeshBasicMaterial({ color: 0xff2222, wireframe: true, transparent: true, opacity: 0.7 });
  for (const b of barriers) {
    const mesh = new Mesh(geo, mat);
    mesh.position.set(b.x, 1, b.z);
    mesh.rotation.y = b.angle;
    mesh.scale.set(b.halfLength * 2, 1, b.halfWidth * 2);
    scene.add(mesh);
  }
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
    (window as Window & { __driftAttackHandlingReport?: typeof report }).__driftAttackHandlingReport = report;
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
  // Load saved tire smoke preset if one was set in the VFX lab
  void resolveTireSmokePreset().then((preset) => {
    if (preset) void tireSmoke.applyPreset(preset);
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
  (window as Window & { __driftAttackRouteProbe?: typeof playerRouteProbe }).__driftAttackRouteProbe = playerRouteProbe;
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

  // Dormant systems: only instantiated when explicitly enabled via dev flags.
  // In production builds, __DEV_SYSTEMS__ is false so these are never created.
  const attachmentTunerEnabled = __DEV_SYSTEMS__ && new URLSearchParams(window.location.search).has("kitTuner");
  type AttachmentTuner = Awaited<ReturnType<typeof import("./ui/attachmentTuner").createAttachmentTuner>>;
  let attachmentTuner: AttachmentTuner | null = null;
  if (attachmentTunerEnabled) {
    const { createAttachmentTuner } = await import("./ui/attachmentTuner");
    attachmentTuner = createAttachmentTuner((att) => {
      carView.applyAttachments(att);
    });
    if (isImportedCar(customization.selectedCar)) attachmentTuner?.show(customization.selectedCar);
  }
  const runLength = 90;
  const fixedStepRunner = createFixedStepRunner(1 / 120, 0.1);
  const handlingProfile = query.get("handling") === "classic" ? "classic" : "polished";
  let lastFixedSteps = 0;
  let lastDroppedSeconds = 0;
  let sessionEndsAt = performance.now() + runLength * 1000;
  let appState: AppState = "garage";
  let vfxLabOpen = false;
  let activeMode: ModeId = customization.selectedMode;
  let endlessTrack: ReturnType<typeof createEndlessTrack> | null = null;
  let endlessObstacles: ReturnType<typeof createObstacleManager> | null = null;
  let endlessObstacleView: ReturnType<typeof createObstacleCarView> | null = null;
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

  // --- Atomic track transition controller ---
  // Only one transition may commit at a time. Each request gets a monotonic
  // generation ID. The candidate is built without mutating activeTrack, trackView,
  // colliders, lighting, cone references, or corner-marker references. The current
  // valid track is retained until the candidate loads completely. A failed candidate
  // leaves the existing track intact. A superseded candidate is disposed without commit.
  let trackGeneration = 0;
  let trackTransition: Promise<void> = Promise.resolve();

  const disposeTrackView = (view: TrackViewResult) => {
    gameScene.remove(view.root);
    view.root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
  };

  const buildCandidate = async (track: TrackConfig): Promise<{
    view: TrackViewResult;
    endlessView: ReturnType<typeof createEndlessTrackView> | null;
  }> => {
    // Build without attaching to the active scene — createTrackView(null, ...) skips scene mutation
    if (track.id === "endless") {
      const root = new Group();
      return { view: { root, coneMeshes: [], cornerMarkers: [] }, endlessView: null };
    }
    const view = await createTrackView(null, track);
    return { view, endlessView: null };
  };

  const commitTrack = (track: TrackConfig, candidate: { view: TrackViewResult; endlessView: ReturnType<typeof createEndlessTrackView> | null }) => {
    // Dispose the old track view and endless view
    endlessTrackView?.dispose();
    endlessTrackView = null;
    disposeTrackView(trackView);

    // Commit the new track as one operation
    activeTrack = track;
    trackView = candidate.view;
    gameScene.add(trackView.root);

    // Rebuild lighting, colliders, and references
    if (track.id === "endless") {
      // Endless track view is created later in resetEvent
    }
    setupArenaLighting();
    colliders = createTrackColliders(activeTrack);
    if (new URLSearchParams(window.location.search).has("debugColliders")) {
      visualizeBarriers(gameScene, colliders.barriers);
    }
    coneMeshes = trackView.coneMeshes;
    cornerMarkers = trackView.cornerMarkers;
    onlineGhosts.setTrack(activeTrack);
    practiceZoneIndex = 0;
  };

  const switchTrack = async (nextTrack: TrackConfig): Promise<void> => {
    const gen = ++trackGeneration;
    // Serialize transitions — chain so only one builds at a time
    trackTransition = trackTransition.then(async () => {
      // A failed reload must not make a later same-track request return early.
      // We compare against the *actual* active track, not a stale ID.
      if (activeTrack.id === nextTrack.id && trackView.root.parent === gameScene) return;

      let candidate: { view: TrackViewResult; endlessView: ReturnType<typeof createEndlessTrackView> | null };
      try {
        candidate = await buildCandidate(nextTrack);
      } catch (error) {
        // Candidate failed — retain existing track and all associated state.
        // Propagate the error so callers can show retry/back UI.
        throw error;
      }

      // If superseded by a newer request, dispose the candidate without committing
      if (gen !== trackGeneration) {
        disposeTrackView(candidate.view);
        candidate.endlessView?.dispose();
        return;
      }

      commitTrack(nextTrack, candidate);
    });
    await trackTransition;
  };

  const reloadActiveTrack = async (): Promise<void> => {
    const gen = ++trackGeneration;
    const targetTrack = activeTrack;
    trackTransition = trackTransition.then(async () => {
      if (targetTrack.id === "endless") return;

      let candidate: { view: TrackViewResult; endlessView: ReturnType<typeof createEndlessTrackView> | null };
      try {
        candidate = await buildCandidate(targetTrack);
      } catch (error) {
        throw error;
      }

      if (gen !== trackGeneration) {
        disposeTrackView(candidate.view);
        candidate.endlessView?.dispose();
        return;
      }

      commitTrack(targetTrack, candidate);
    });
    await trackTransition;
  };

  // Map editor: only instantiated when enabled via dev flag
  type MapEditor = Awaited<ReturnType<typeof import("./game/editor/mapEditor").createMapEditor>>;
  let mapEditor: MapEditor | null = null;
  if (mapEditorEnabled) {
    const { createMapEditor } = await import("./game/editor/mapEditor");
    mapEditor = createMapEditor(canvas, gameCamera, gameScene, { onReloadTrack: reloadActiveTrack });
  }

  const resetEvent = () => {
    resetCar(car, activeTrack, getPracticeSpawn());
    resetDrift(drift);
    if (activeMode === "endless") {
      endlessTrack = createEndlessTrack(activeEndlessSeed);
      endlessObstacles = createObstacleManager(activeEndlessSeed);
      endlessRun = createEndlessState(activeEndlessSeed, {
        carId: customization.selectedCar,
        tuningPreset: customization.tuningPreset,
      });
      endlessTrackView?.dispose();
      endlessTrackView = createEndlessTrackView(gameScene);
      endlessObstacleView?.root.parent?.remove(endlessObstacleView.root);
      endlessObstacleView = createObstacleCarView(gameScene);
      endlessObstacleView.reset();
      endlessTrackView.update(endlessTrack.state, car.position);
      sessionTime = endlessRun.state.clock;
      recordEndlessRunStart(endlessRecords);
    } else {
      endlessTrack = null;
      endlessObstacles = null;
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
    endlessResults.hide();
    leaderboardUi.hide();
    replayOverlay.hide();
    endlessTrackView?.dispose();
    endlessTrackView = null;
    endlessTrack = null;
    endlessObstacles = null;
    if (endlessObstacleView) {
      endlessObstacleView.root.parent?.remove(endlessObstacleView.root);
      endlessObstacleView = null;
    }
    endlessRun = null;
    replaySession = null;
    hud.root.hidden = true;
    onlineHud.hide();
    mapEditor?.hide();
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
    customization = { ...customization, selectedMode: "free-drive" };
    saveCustomization(customization);
    garageUi.update(customization);
    garageUi.hide();
    garageView.applyCustomization(customization);
    mainMenu.show();
    // Do not enable mode buttons until Practice Grounds has loaded successfully
    mainMenu.setPlayEnabled(false);
    if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner?.show(customization.selectedCar);
    else attachmentTuner?.hide();
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
      onlineHud.hide();
      car.throttleAxis = 0;
      car.brakeAxis = 0;
    }
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
    resetInputState();
    activeMode = customization.selectedMode;
    mainMenu.setPlayEnabled(false);
    loadingOverlay.show(modeLabel(activeMode));
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
      garageView.setActive(false);
      results.hide();
      endlessResults.hide();
      leaderboardUi.hide();
      replayOverlay.hide();
      garageUi.hide();
      mainMenu.hide();
      attachmentTuner?.hide();
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
        mapEditor?.show(activeTrack);
      } else {
        mapEditor?.hide();
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
          appState = "garage";
          hud.root.hidden = true;
          garageUi.hide();
          mainMenu.show();
          mainMenu.setPlayEnabled(true);
        },
      );
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
      attachmentTuner?.hide();
      mapEditor?.hide();
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

  const vfxEditor = createVfxEditor({
    onClose: () => {
      // Re-enable garage rendering and input when VFX Lab closes
      if (appState === "garage") {
        garageView.setActive(true);
        vfxLabOpen = false;
      }
    },
    onApplyTireSmoke: (preset) => {
      // Save the preset name only when apply actually succeeds
      void tireSmoke.applyPreset(preset).then((result: ApplyPresetResult) => {
        if (result.applied) {
          saveTireSmokePresetName(preset.name);
          vfxEditor.setTireSmokeStatus(`"${preset.name}" applied as tire smoke.`);
        } else {
          vfxEditor.setTireSmokeStatus(`Could not apply "${preset.name}": ${result.reason}`);
        }
      });
    },
    onClearTireSmoke: () => {
      clearTireSmokePresetName();
      tireSmoke.clearPreset();
      vfxEditor.setTireSmokeStatus("Tire smoke reset to default.");
    },
  });
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
      carView.applyCustomization(customization);
      garageView.applyCustomization(customization);
      syncPaintTint(customization.paint);
      if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner?.show(customization.selectedCar);
      else attachmentTuner?.hide();
      // Show loading indicator while imported car loads
      garageUi.setLoading(carView.isLoading());
      void carView.whenReady().then(() => {
        garageUi.setLoading(false);
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
  const endlessResults = createEndlessResultsOverlay({
    onRetry: () => launchEndless("all-time"),
    onDailyRetry: () => void launchDailyEndless(),
    onGarage: showMainMenu,
  });
  hud.root.hidden = true;

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

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    stopMainLoop();
    resetInputState();
    engineSound.suspend();
    // Show a real DOM overlay (not just a CSS pseudo-element)
    const overlay = document.createElement("div");
    overlay.className = "context-lost-overlay";
    overlay.innerHTML = `
      <div class="context-lost-overlay__card">
        <h1>Drift Attack lost its graphics context</h1>
        <p>The browser reclaimed the GPU. This can happen when the device runs low on memory or after sleep/wake.</p>
        <button type="button" data-reload>Reload</button>
      </div>
    `;
    document.body.append(overlay);
    overlay.querySelector<HTMLButtonElement>("[data-reload]")!.addEventListener("click", () => window.location.reload());
  });

  renderer.domElement.addEventListener("webglcontextrestored", () => {
    // The simplest reliable recovery is a full reload — Three.js internal state
    // (programs, geometries, textures) is too complex to rebuild piecemeal.
    window.location.reload();
  });

  // Pause expensive work (RAF + audio) when the tab is hidden.
  // Also pause Drift Attack timing so the player's 90-second run is not consumed.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      documentHidden = true;
      hiddenStartTime = performance.now();
      stopMainLoop();
      resetInputState();
      engineSound.suspend();
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
      if (appState === "event" || appState === "replay") engineSound.resume();
      startMainLoop();
    }
  });

  // Clear keyboard state on window blur (alt-tab, focus loss)
  window.addEventListener("blur", () => {
    resetInputState();
  });

  const engineSound = createEngineSound();

  bindInput();
  createFullscreenToggle();
  showMainMenu();

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

  function getNearbyGarage() {
    if (activeMode !== "free-drive" || activeTrack.id !== "practice-grounds") return false;
    const start = activeTrack.start;
    return Math.hypot(car.position.x - start.x, car.position.z - start.z) <= 16;
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
    garageView.setActive(false);
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
    showMainMenu();
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
      mapEditor?.update(dt);
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
      if (trackView.windUniforms) for (const w of trackView.windUniforms) w.value += dt;
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
      const guardrailImpact = runningEndless && endlessTrack
        ? endlessTrack.resolveGuardrail(car)
        : 0;
      const trackImpact = runningEndless
        ? 0
        : updateTrackCollision(car, colliders, stepDt, activeTuning);
      const obstacleImpact = runningEndless && endlessObstacles
        ? endlessObstacles.checkCollision(car)
        : 0;
      const stepImpact = Math.max(boundaryImpact, guardrailImpact, trackImpact, obstacleImpact);
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
    if (runningEndless && endlessTrack) {
      endlessTrackView?.update(endlessTrack.state, car.position);
      if (endlessObstacles && endlessObstacleView) {
        endlessObstacles.update(endlessTrack, car, dt);
        endlessObstacleView.update(endlessObstacles.obstacles);
      }
    }
    if (onlineMatchActive && onlineRoom) onlineGhosts.setRemotePlayers(onlineRoom.players, onlinePlayerId);
    onlineGhosts.root.visible = activeMode === "online-lobby" || onlineMatchActive;
    onlineGhosts.update(dt);

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
      hud.setPracticeZone(
        nearGarage
          ? "Garage — Press E"
          : activeTrack.practiceZones?.[practiceZoneIndex]?.label ?? "Practice",
      );
      onlineHud.hide();
    } else if (activeMode === "online-lobby") {
      hud.setOnlineStatus("Cruise Lobby");
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
        portalLabel: null,
      });
    } else {
      onlineHud.hide();
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
      if (appState === "event" || appState === "replay") engineSound.resume();
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
    } else if (appState === "replay") {
      updateReplay(dt);
    } else {
      renderGameScene(dt);
    }

    performanceMonitor.update(dt, lastFixedSteps, lastDroppedSeconds);

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
  // Idempotent: safe to call multiple times.
  function teardown() {
    if (disposed) return;
    disposed = true;
    stopMainLoop();
    resetInputState();
    // Audio
    engineSound.dispose?.();
    // UI overlays — remove from DOM (dispose if available, otherwise just remove root)
    disposeSafe(vfxEditor);
    disposeSafe(garageView);
    disposeSafe(garageUi);
    disposeSafe(loadingOverlay);
    disposeSafe(mainMenu);
    disposeSafe(results);
    disposeSafe(endlessResults);
    disposeSafe(leaderboardUi);
    disposeSafe(replayOverlay);
    disposeSafe(attachmentTuner ?? {});
    disposeSafe(onlineHud);
    disposeSafe(onlineMatchUi);
    disposeSafe(hud);
    // 3D systems
    carView.dispose();
    disposeSafe(replayCarView);
    tireTracks.dispose();
    tireSmoke.dispose();
    disposeSafe(onlineGhosts);
    endlessTrackView?.dispose();
    disposeSafe(endlessObstacleView ?? {});
    postPipeline?.dispose();
    disposeSafe(mapEditor ?? {});
    performanceMonitor.dispose();
    // Scene resources
    disposeTrackView(trackView);
    disposeSceneRoot(gameScene);
    arenaRig?.dispose();
    arenaEnv?.dispose();
    defaultSceneEnvironment?.dispose();
    // Renderer
    renderer.dispose();
  }

  // bfcache-safe: don't run destructive teardown for a page hide that will be persisted.
  // Instead reload cleanly on a persisted pageshow.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;  // bfcache — preserve the page
    teardown();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      // Returning from bfcache — reload cleanly since GPU state may be invalid
      window.location.reload();
    }
  });
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
  main.append(h1, pre, support);
  app.append(main);
});
