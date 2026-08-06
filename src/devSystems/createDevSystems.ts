import { Vector3 } from "three";

import { applyTuningPreset, loadCarCustomization, type CarCustomization, type DevModeId } from "../game/customization";
import { createCarState, resetCar, updateCar } from "../game/simulation/car";
import { captureCarPose } from "../game/simulation/collisionSolver";
import { createEndlessTrack } from "../game/endless/endlessTrack";
import { createObstacleManager } from "../game/endless/endlessObstacles";
import { createEndlessState } from "../game/endless/endlessState";
import { PHYSICS_VERSION, REPLAY_FIXED_STEP_SECONDS } from "../game/endless/physicsVersion";
import { createReplayInputSampler, deserializeReplay, type ReplayData } from "../game/endless/replay";
import {
  commitEndlessRun,
  loadEndlessRecords,
  recordEndlessRunStart,
  type EndlessRunSummary,
} from "../game/endless/records";
import { createEndlessTrackView } from "../render/endless/endlessTrackView";
import { createObstacleCarView } from "../render/endless/obstacleCarView";
import { createReplayCarView } from "../render/endless/replayCarView";
import { createLeaderboardClient } from "../net/leaderboard";
import { createLeaderboardUi } from "../ui/leaderboardUi";
import { createReplayOverlay } from "../ui/replayOverlay";
import { createOnlineGhosts } from "../render/objects/onlineGhosts";
import { createQueueSlab } from "../render/objects/queueSlab";
import { createOnlineHud, type OnlineHudPlayer } from "../ui/onlineHud";
import { createOnlineMatchUi } from "../ui/onlineMatchUi";
import { createOnlineClient, type OnlineClient } from "../net/onlineClient";
import {
  dailySeedForTimestamp,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type OnlinePlayerState,
  type OnlineRoomState,
} from "../net/protocol";
import { getDriftZone, isInRunoff, isOnTrack } from "../game/simulation/trackSurface";
import { resetChaseCamera } from "../render/app/camera";
import { isImportedCar } from "../render/objects/importedCars";
import { createEndlessResultsOverlay } from "../ui/hud";
import type { CarState, CarTuning, InputState, TrackConfig } from "../game/types";
import type { DevSystems, DevSystemsHost, DevStartResult, DevFrameResult } from "./types";

const eventCarScale = 1.55;

export function createDevSystems(host: DevSystemsHost): DevSystems {
  let disposed = false;

  // --- Online systems ---
  const onlineGhosts = createOnlineGhosts();
  const queueSlab = createQueueSlab();
  const onlineHud = createOnlineHud();
  const leaderboardClient = createLeaderboardClient();
  const endlessRecords = loadEndlessRecords();

  let onlineRoom: OnlineRoomState | null = null;
  let onlinePlayerId: string | null = null;
  let onlineMatchActive = false;
  let onlineInputSeq = 0;
  let onlineInputDebt = 0;
  let onlineQueueOpen = false;
  let activeQueuePad: { roomCode: string; x: number; z: number; heading: number } | null = null;

  // --- Endless systems ---
  let endlessTrack: ReturnType<typeof createEndlessTrack> | null = null;
  let endlessObstacles: ReturnType<typeof createObstacleManager> | null = null;
  let endlessObstacleView: ReturnType<typeof createObstacleCarView> | null = null;
  let endlessRun: ReturnType<typeof createEndlessState> | null = null;
  let endlessTrackView: ReturnType<typeof createEndlessTrackView> | null = null;
  let activeEndlessBoard: LeaderboardBoard = "daily";
  let activeEndlessSeed = 1;
  let pendingEndlessLaunch: { board: LeaderboardBoard; seed: number } | null = null;

  // --- Replay systems ---
  const replayCarView = createReplayCarView(eventCarScale);
  replayCarView.root.visible = false;
  host.scene.add(onlineGhosts.root, queueSlab.root, replayCarView.root);

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

  // --- Endless track stub ---
  const endlessTrackStub: TrackConfig = {
    id: "endless",
    name: "Endless Drift",
    start: { x: 0, z: 0, heading: 0 },
    checkpoints: [],
    roadPath: [],
    roadWidth: 22,
    boundaryMargin: 0,
  };

  // --- Endless results overlay ---
  const endlessResults = createEndlessResultsOverlay({
    onRetry: () => launchEndless("all-time"),
    onDailyRetry: () => void launchDailyEndless(),
    onGarage: () => host.showMainMenu(),
  });

  // --- Leaderboard UI ---
  const leaderboardUi = createLeaderboardUi<ReplayData>(leaderboardClient, {
    onWatch: (entry, replay) => { void startReplay(entry, replay); },
    onClose: () => host.canvas.focus(),
  });

  // --- Replay overlay ---
  const replayOverlay = createReplayOverlay(() => exitReplay());

  // --- Map editor (conditional) ---
  type MapEditor = Awaited<ReturnType<typeof import("../game/editor/mapEditor").createMapEditor>>;
  let mapEditor: MapEditor | null = null;
  const mapEditorEnabled = __DEV_SYSTEMS__ && new URLSearchParams(window.location.search).get("devMapEditor") === "1";
  if (mapEditorEnabled) {
    void import("../game/editor/mapEditor").then(({ createMapEditor }) => {
      if (disposed) return;
      mapEditor = createMapEditor(host.canvas, host.camera as never, host.scene, { onReloadTrack: host.reloadActiveTrack });
    });
  }

  // --- Attachment tuner (conditional, dev only) ---
  type AttachmentTuner = Awaited<ReturnType<typeof import("../ui/attachmentTuner").createAttachmentTuner>>;
  let attachmentTuner: AttachmentTuner | null = null;
  const attachmentTunerEnabled = __DEV_SYSTEMS__ && new URLSearchParams(window.location.search).has("kitTuner");
  if (attachmentTunerEnabled) {
    void import("../ui/attachmentTuner").then(({ createAttachmentTuner }) => {
      if (disposed) return;
      attachmentTuner = createAttachmentTuner(() => { /* applied via host */ });
      if (isImportedCar(host.customization.selectedCar)) attachmentTuner?.show(host.customization.selectedCar);
    });
  }

  // --- Queue pad helpers ---
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
    const car = host.car;
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
    const portal = host.activeTrack.portals?.find((p) => p.mode === "drift-attack") ?? null;
    const car = host.car;
    if (!portal) {
      resetCar(car, host.activeTrack);
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

  // --- Endless helpers ---
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
    const customization = { ...host.customization, selectedMode: "endless" as const };
    host.saveCustomization(customization);
    host.updateGarageUi();
    void startMode("endless");
  }

  async function launchDailyEndless() {
    try {
      const daily = await leaderboardClient.fetchDailySeed();
      launchEndless("daily", daily.seed);
    } catch {
      launchEndless("daily", localDailySeed());
    }
  }

  // --- Online client ---
  let onlineClient: OnlineClient;
  const onlineMatchUi = createOnlineMatchUi({
    onConnect(roomCode) {
      onlineQueueOpen = true;
      onlineRoom = null;
      onlinePlayerId = null;
      onlineGhosts.clearRemotePlayers();
      const joinedCode = onlineClient.connect(host.playerProfile, host.customization, roomCode);
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

  const beginOnlineDriftMatch = async () => {
    const customization = { ...host.customization, selectedMode: "online-lobby" as const };
    host.saveCustomization(customization);
    host.resetPublicInput();
    await host.switchTrack(host.activeTrack);
    host.setGarageActive(false);
    host.results.hide();
    host.hud.root.hidden = false;
    host.hud.setMode("drift-attack");
    onlineMatchActive = true;
    onlineInputDebt = 0;
    onlineMatchUi.hideQueue();
    clearActiveQueuePad();
    host.canvas.focus();
  };

  const finishOnlineRun = (room: OnlineRoomState) => {
    onlineMatchActive = false;
    onlineQueueOpen = false;
    onlineRoom = room;
    const local = room.players.find((player) => player.id === onlinePlayerId);
    host.results.show(
      local ? local.score : host.finishDriftRun(),
      host.drift.bestCombo,
      host.drift.bestRun,
    );
    onlineMatchUi.updateRoom(room);
    onlineMatchUi.hideQueue();
    clearActiveQueuePad();
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
    returnCarToQueuePortal();
  };

  onlineClient = createOnlineClient({
    onJoined(playerId, room) {
      onlinePlayerId = playerId;
      onlineRoom = room;
      if (!activeQueuePad || activeQueuePad.roomCode !== room.roomCode) setActiveQueuePad(room.roomCode);
      onlineMatchUi.setLocalPlayer(playerId);
      onlineMatchUi.updateRoom(room);
      if (onlineQueueOpen) {
        lockLocalCarToQueue(room);
        onlineGhosts.setRemotePlayers(stagedOnlinePlayers(room), onlinePlayerId);
      }
    },
    onRoom(room) {
      onlineRoom = room;
      if (onlineQueueOpen && (!activeQueuePad || activeQueuePad.roomCode !== room.roomCode)) {
        setActiveQueuePad(room.roomCode);
      }
      onlineMatchUi.updateRoom(room);
      if (onlineMatchActive) onlineGhosts.setRemotePlayers(room.players, onlinePlayerId);
      else if (onlineQueueOpen) {
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

  // --- Screen projector for online labels ---
  const screenProjector = new Vector3();
  function projectOnlineLabel(position: { x: number; z: number }, distance: number) {
    screenProjector.set(position.x, 3.2, position.z).project(host.camera);
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

  // --- Reset dev mode state ---
  function resetDevModeState() {
    const car = host.car;
    const customization = host.customization;
    if (customization.selectedMode === "endless") {
      endlessTrack = createEndlessTrack(activeEndlessSeed);
      endlessObstacles = createObstacleManager(activeEndlessSeed);
      endlessRun = createEndlessState(activeEndlessSeed, {
        carId: customization.selectedCar,
        tuningPreset: customization.tuningPreset,
      });
      endlessTrackView?.dispose();
      endlessTrackView = createEndlessTrackView(host.scene);
      endlessObstacleView?.root.parent?.remove(endlessObstacleView.root);
      endlessObstacleView = createObstacleCarView(host.scene);
      endlessObstacleView.reset();
      endlessTrackView.update(endlessTrack.state, car.position);
      host.setSessionTime(endlessRun.state.clock);
      recordEndlessRunStart(endlessRecords);
    } else {
      endlessTrack = null;
      endlessObstacles = null;
      endlessRun = null;
      host.setSessionTime(customization.selectedMode === "drift-attack" ? 90 : Infinity);
    }
  }

  // --- Finish endless run ---
  const finishEndlessRun = () => {
    if (!endlessRun) return;
    const finalScore = host.finishDriftRun();
    const car = host.car;
    const drift = host.drift;
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
      carId: host.customization.selectedCar,
      tuningPreset: host.customization.tuningPreset,
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

    host.hud.root.hidden = true;
    host.results.hide();
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
    void leaderboardClient.submitRun(replay, activeEndlessBoard, host.playerProfile.name).then(
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

  // --- Replay ---
  async function startReplay(entry: LeaderboardEntry, data: ReplayData): Promise<boolean> {
    if (disposed) return false;
    const decoded = deserializeReplay(data);
    const tuning = applyTuningPreset(await host.loadCarTuning(data.carId), data.tuningPreset);
    await host.switchTrack(endlessTrackStub);
    endlessTrackView?.dispose();
    const track = createEndlessTrack(data.seed);
    const replayCar = createCarState(endlessTrackStub);
    const replayCustomization: CarCustomization = {
      ...host.customization,
      ...loadCarCustomization(data.carId),
      selectedCar: data.carId,
      selectedMode: "endless",
      tuningPreset: data.tuningPreset,
    };
    replayCarView.applyCustomization(replayCustomization);
    await replayCarView.whenReady();
    endlessTrackView = createEndlessTrackView(host.scene);
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
    host.setGarageActive(false);
    host.resetPublicInput();
    host.fixedStepRunner.reset();
    host.tireEffects.reset();
    host.carView.root.visible = false;
    replayCarView.root.visible = true;
    onlineGhosts.root.visible = false;
    host.hud.root.hidden = true;
    host.results.hide();
    endlessResults.hide();
    leaderboardUi.hide();
    replayOverlay.show(entry, data.version !== PHYSICS_VERSION);
    resetChaseCamera(host.camera as never, replayCar);
    host.canvas.focus();
    return true;
  }

  function exitReplay(): boolean {
    if (!replaySession) return false;
    replaySession = null;
    replayOverlay.hide();
    replayCarView.root.visible = false;
    endlessTrackView?.dispose();
    endlessTrackView = null;
    host.showMainMenu();
    return true;
  }

  // --- Update replay ---
  function updateReplay(dt: number): DevFrameResult {
    const session = replaySession;
    if (!session) {
      exitReplay();
      return { handled: true, rendered: false };
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
        const replayPreviousPose = captureCarPose(session.car);
        updateCar(session.car, replayInput, session.tuning, REPLAY_FIXED_STEP_SECONDS, onTrack, host.handlingProfile);
        session.track.resolveGuardrail(session.car, replayPreviousPose, session.tuning);
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
    host.tireEffects.update(session.car, onTrack, dt);
    replayCarView.sync(session.car);
    host.updateEngineSound();
    host.updateChaseCamera(dt, 0, false);
    host.applyFocusLighting();
    replayOverlay.update(session.elapsed, session.data.duration);
    host.setLastFixedStats(Math.round(Math.min(0.1, dt) / REPLAY_FIXED_STEP_SECONDS), Math.max(0, dt - 0.1));
    host.renderGameScene(dt);
    return { handled: true, rendered: true };
  }

  // --- Update event (dev modes) ---
  function updateDevEvent(dt: number, input: InputState): DevFrameResult {
    const car = host.car;
    const activeMode = host.customization.selectedMode;
    const drift = host.drift;

    // Map editor mode
    if (activeMode === "map-editor") {
      host.fixedStepRunner.reset();
      host.setLastFixedStats(0, 0);
      if (input.menu) {
        host.showGarage();
        return { handled: true, rendered: false };
      }
      mapEditor?.update(dt);
      host.renderGameScene(dt);
      return { handled: true, rendered: true };
    }

    // Queue staging
    const queueStaging = activeMode === "online-lobby" && onlineQueueOpen && !onlineMatchActive;
    if (input.reset && !queueStaging) {
      resetDevModeState();
    }
    if (input.menu) {
      if (queueStaging) leaveOnlineQueue();
      else host.showGarage();
      return { handled: true, rendered: false };
    }

    if (queueStaging) {
      host.fixedStepRunner.reset();
      host.setLastFixedStats(0, 0);
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
      host.tireEffects.reset();
      host.carView.sync(car);
      host.updateCornerMarkerFlex(dt);
      host.updateWindUniforms(dt);
      host.updateEngineSound();
      host.setCameraShake(Math.max(0, host.getCameraShakeValue() - dt * 1.7));
      host.updateChaseCamera(dt, host.getCameraShakeValue(), true);
      host.applyFocusLighting();
      host.hud.update(car, drift);
      host.hud.updateTimer(Infinity);
      host.hud.setOnlineStatus(onlineRoom ? `Queue Pad ${onlineRoom.roomCode}` : "Opening Queue Pad");
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
          ? `Pad ${onlineRoom.roomCode}: Press E to ready - Esc Leaves`
          : activeQueuePad
            ? `Opening private queue pad ${activeQueuePad.roomCode}`
            : "Joining Drift Attack queue",
      });
      host.hud.root.hidden = false;
      host.renderGameScene(dt);
      return { handled: true, rendered: true };
    }

    // Drift attack with online match — time from online match
    if (activeMode === "drift-attack" && onlineMatchActive && onlineRoom?.matchEndsAt) {
      host.setSessionTime(Math.max(0, (onlineRoom.matchEndsAt - Date.now()) / 1000));
    }

    const runningEndless = activeMode === "endless" && endlessTrack !== null && endlessRun !== null;
    let frameImpact = 0;
    let scoringSurface = runningEndless && endlessTrack
      ? endlessTrack.isOnTrack(car.position)
      : isOnTrack(car.position, host.activeTrack);
    let runoffTime = 0;

    const fixedStats = host.fixedStepRunner.advance(dt, (stepDt) => {
      if (runningEndless && (!endlessRun || !endlessTrack || !endlessRun.state.alive)) return;
      if (host.playerRouteProbeEnabled && activeMode === "drift-attack") host.addPlayerRouteProbeTime(stepDt);
      const endlessUpdate = runningEndless && endlessTrack ? endlessTrack.update(car.position) : null;
      if (runningEndless && endlessRun && endlessUpdate) {
        endlessRun.recordStep(input, car, stepDt);
        for (const gate of endlessUpdate.passedGates) endlessRun.onGatePassed(gate.distance);
      }
      const gearBeforeStep = car.gear;
      const surfaceBeforeStep = runningEndless && endlessTrack
        ? endlessTrack.isOnTrack(car.position)
        : isOnTrack(car.position, host.activeTrack);
      const previousPose = captureCarPose(car);
      updateCar(car, input, host.activeTuning, stepDt, surfaceBeforeStep, host.handlingProfile);

      if (host.playerRouteProbeEnabled && activeMode === "drift-attack" && car.gear !== gearBeforeStep) {
        host.recordPlayerRouteProbeShift(gearBeforeStep, car.gear);
      }

      const stepOnTrack = runningEndless && endlessTrack
        ? endlessTrack.isOnTrack(car.position)
        : isOnTrack(car.position, host.activeTrack);
      const stepInRunoff = runningEndless && endlessTrack
        ? endlessTrack.isInRunoff(car.position)
        : isInRunoff(car.position, host.activeTrack);
      if (stepOnTrack) runoffTime = 0;
      else if (stepInRunoff) runoffTime += stepDt;
      else runoffTime = 999;
      scoringSurface = stepOnTrack || (stepInRunoff && runoffTime <= 1.15);

      let stepImpact = 0;
      if (runningEndless && endlessTrack) {
        const guardrailResult = endlessTrack.resolveGuardrail(car, previousPose, host.activeTuning);
        const obstacleResult = endlessObstacles
          ? endlessObstacles.resolveCollisions(car, previousPose, host.activeTuning)
          : { severity: 0, contactCount: 0, colliderIds: [] };
        stepImpact = Math.max(guardrailResult.severity, obstacleResult.severity);
      }
      frameImpact = Math.max(frameImpact, stepImpact);

      if (activeMode === "drift-attack" || runningEndless) {
        const driftZone = runningEndless && endlessTrack
          ? Math.floor(endlessTrack.getProgress(car.position) / 80)
          : getDriftZone(car.position, host.activeTrack);
        host.updateDriftScore(stepDt, scoringSurface, driftZone, stepImpact);
        if (host.playerRouteProbeEnabled) host.setPlayerRouteProbeScore(drift.totalScore + drift.comboScore);
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
    host.setLastFixedStats(fixedStats.steps, fixedStats.droppedSeconds);

    if (runningEndless && endlessRun) {
      host.setSessionTime(endlessRun.state.clock);
      for (const event of endlessRun.consumeEvents()) {
        if (event.type === "objective-complete") {
          host.setDriftCallout("Objective complete", 1.4);
        } else if (event.type === "gate") {
          host.setDriftCallout(`Gate ${event.gatesPassed} +${event.clockAdded}s`, 1.35);
        } else if (event.type === "stage" && event.majorMilestone) {
          host.setDriftCallout(`Milestone - Stage ${event.stage}`, 1.7);
        }
      }
      if (!endlessRun.state.alive) {
        finishEndlessRun();
        return { handled: true, rendered: false };
      }
    }

    const onTrack = runningEndless && endlessTrack
      ? endlessTrack.isOnTrack(car.position)
      : isOnTrack(car.position, host.activeTrack);
    let cameraShake = host.getCameraShakeValue();
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (frameImpact > 0) cameraShake = Math.max(cameraShake, frameImpact * 0.75);
    host.setCameraShake(cameraShake);

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

    host.syncConeMeshes(dt);
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

    const nearGarage = host.getNearbyGarage();
    if (nearGarage && input.confirm) {
      host.showOptionsMenu();
      return { handled: true, rendered: false };
    }

    host.tireEffects.update(car, onTrack, dt);
    host.carView.sync(car);
    host.updateCornerMarkerFlex(dt);
    host.updateWindUniforms(dt);
    host.updateEngineSound();
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    host.setCameraShake(cameraShake);
    host.updateChaseCamera(dt, cameraShake, !runningEndless);
    host.applyFocusLighting();
    host.hud.update(car, drift);
    host.hud.updateTimer(host.getSessionTime());

    if (runningEndless && endlessRun) {
      const objective = endlessRun.state.objective;
      const progress = objective.unit === "score"
        ? `${Math.round(objective.value).toLocaleString("en-US")} / ${Math.round(objective.target).toLocaleString("en-US")}`
        : objective.unit === "meters"
          ? `${Math.round(objective.value)} / ${Math.round(objective.target)} m`
          : objective.unit === "seconds"
            ? `${objective.value.toFixed(1)} / ${objective.target.toFixed(1)}s`
            : `${Math.floor(objective.value)} / ${Math.floor(objective.target)}`;
      host.hud.setEndlessStats({
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
    } else if (activeMode === "online-lobby") {
      host.hud.setOnlineStatus("Cruise Lobby");
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
    host.hud.root.hidden = false;
    host.renderGameScene(dt);
    return { handled: true, rendered: true };
  }

  // --- DevSystems implementation ---
  function handlesMode(mode: Parameters<DevSystems["handlesMode"]>[0]): mode is DevModeId {
    return mode === "online-lobby" || mode === "endless" || mode === "map-editor";
  }

  async function startMode(mode: DevModeId): Promise<DevStartResult> {
    if (disposed) return { handled: true, started: false, error: new Error("Dev systems disposed") };
    try {
      if (mode === "endless") {
        const launch = await resolveEndlessLaunch();
        activeEndlessBoard = launch.board;
        activeEndlessSeed = launch.seed;
      }
      host.resetPublicInput();
      resetDevModeState();
      host.carView.sync(host.car);
      host.carView.root.visible = true;
      host.tireEffects.reset();

      if (mode === "map-editor") {
        host.hud.root.hidden = true;
        onlineHud.hide();
        onlineMatchUi.hideAll();
        host.carView.root.visible = false;
        host.tireEffects.root.visible = false;
        mapEditor?.show(host.activeTrack);
      } else {
        mapEditor?.hide();
        host.carView.root.visible = true;
        host.hud.root.hidden = false;
        host.hud.setMode(
          mode === "online-lobby"
            ? "online-lobby"
            : mode === "endless"
              ? "endless"
              : "drift-attack",
        );
      }
      if (mode !== "online-lobby") clearActiveQueuePad();
      return { handled: true, started: true };
    } catch (error) {
      return { handled: true, started: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  function resetActiveMode(): boolean {
    if (disposed) return false;
    const mode = host.customization.selectedMode;
    if (!handlesMode(mode)) return false;
    resetDevModeState();
    return true;
  }

  function update(dt: number, input: InputState): DevFrameResult {
    if (disposed) return { handled: false, rendered: false };
    if (replaySession) return updateReplay(dt);
    const mode = host.customization.selectedMode;
    if (!handlesMode(mode)) return { handled: false, rendered: false };
    return updateDevEvent(dt, input);
  }

  function openLeaderboard(): boolean {
    if (disposed) return false;
    leaderboardUi.show();
    return true;
  }

  function closeLeaderboard(): boolean {
    if (disposed) return false;
    leaderboardUi.hide();
    return true;
  }

  function onTrackCommitted(track: TrackConfig): void {
    onlineGhosts.setTrack(track);
  }

  function suspend(): void { /* pause dev systems when tab hidden */ }
  function resume(): void { /* resume dev systems when tab visible */ }

  function disposeSafe(obj: { dispose?: () => void; root?: unknown } | null | undefined) {
    if (obj && typeof obj.dispose === "function") obj.dispose();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    disposeSafe(onlineHud);
    disposeSafe(onlineMatchUi);
    disposeSafe(leaderboardUi);
    disposeSafe(replayOverlay);
    disposeSafe(endlessResults);
    disposeSafe(attachmentTuner);
    disposeSafe(mapEditor);

    disposeSafe(onlineGhosts);
    queueSlab.dispose();
    disposeSafe(replayCarView);
    endlessTrackView?.dispose();
    endlessObstacleView?.root.parent?.remove(endlessObstacleView.root);
    disposeSafe(endlessObstacleView);

    onlineClient.disconnect();

    onlineGhosts.root.parent?.remove(onlineGhosts.root);
    queueSlab.root.parent?.remove(queueSlab.root);
    replayCarView.root.parent?.remove(replayCarView.root);
  }

  return {
    enabled: true,
    handlesMode,
    startMode,
    resetActiveMode,
    update,
    startReplay: (payload: unknown) => {
      // The enabled implementation narrows the unknown payload using its own
      // replay types. The public boundary only sees `unknown`.
      const entry = payload as LeaderboardEntry;
      const data = (payload as { data?: ReplayData }).data ?? (payload as unknown as ReplayData);
      return startReplay(entry, data);
    },
    exitReplay,
    openLeaderboard,
    closeLeaderboard,
    onTrackCommitted,
    suspend,
    resume,
    dispose,
  };
}
