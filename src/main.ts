import "./style.css";
import { Clock, Mesh, Vector3 } from "three";
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
import { createDriftState, finishDriftRun, resetDrift, updateDriftScore } from "./game/simulation/drift";
import { getDriftZone, isInRunoff, isOnTrack } from "./game/simulation/trackSurface";
import { applyVehicleGeometryTuning } from "./game/simulation/vehicleGeometry";
import type { CarTuning } from "./game/types";
import type { TrackConfig } from "./game/types";
import { createCamera, updateChaseCamera } from "./render/app/camera";
import { createRenderer } from "./render/app/createRenderer";
import { createScene } from "./render/app/createScene";
import { createGarageView } from "./render/garage/garageView";
import { createCarView } from "./render/objects/carView";
import { createTireSmoke } from "./render/objects/tireSmoke";
import { createTireTracks } from "./render/objects/tireTracks";
import { createTrackView } from "./render/objects/trackView";
import { createOnlineGhosts } from "./render/objects/onlineGhosts";
import { createQueueSlab } from "./render/objects/queueSlab";
import { createGarageUi } from "./ui/garageUi";
import { createHud, createResultsOverlay } from "./ui/hud";
import { createOnlineHud, type OnlineHudPlayer } from "./ui/onlineHud";
import { createOnlineMatchUi } from "./ui/onlineMatchUi";
import { createAttachmentTuner } from "./ui/attachmentTuner";
import { isImportedCar } from "./render/objects/importedCars";
import { createEngineSound } from "./audio/engineSound";
import { createTrackColliders, updateTrackCollision } from "./game/simulation/trackCollision";
import type { Cone } from "./game/simulation/trackCollision";
import { createOnlineClient, type OnlineClient } from "./net/onlineClient";
import { loadPlayerProfile, savePlayerProfile, type PlayerProfile } from "./net/profile";
import type { OnlinePlayerState, OnlineRoomState } from "./net/protocol";
import { createMapEditor } from "./game/editor/mapEditor";

type AppState = "garage" | "event" | "results";
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
  const gameScene = createScene();
  const gameCamera = createCamera();
  const clock = new Clock();

  const manifest = await loadManifest();
  const carEntry = manifest.cars[manifest.activeCar];
  const driftTrack = manifest.tracks[manifest.activeTrack];
  const practiceTrack = manifest.tracks["practice-grounds"] ?? driftTrack;
  const onlineLobbyTrack = manifest.tracks["online-lobby"] ?? practiceTrack;
  const tuningCache = new Map<string, CarTuning>();
  async function loadCarTuning(carId: string): Promise<CarTuning> {
    const cached = tuningCache.get(carId);
    if (cached) return cached;
    const path = carTuningPaths[carId] ?? carEntry.tuning;
    const tuning = applyVehicleGeometryTuning(await loadJson<CarTuning>(path));
    tuningCache.set(carId, tuning);
    return tuning;
  }
  let customization: CarCustomization = loadCustomization();
  let playerProfile: PlayerProfile = loadPlayerProfile();
  let baseTuning = await loadCarTuning(customization.selectedCar);
  let activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);

  let activeTrack: TrackConfig = driftTrack;
  let trackView = await createTrackView(gameScene, activeTrack);
  let colliders = createTrackColliders(activeTrack);
  let coneMeshes = trackView.coneMeshes;
  const carView = createCarView((carEntry.scale ?? 1) * eventCarScale);
  carView.applyCustomization(customization);
  const tireTracks = createTireTracks();
  const tireSmoke = createTireSmoke();
  const onlineGhosts = createOnlineGhosts();
  const queueSlab = createQueueSlab();
  onlineGhosts.setTrack(activeTrack);
  gameScene.add(tireTracks.root, tireSmoke.root, carView.root, onlineGhosts.root, queueSlab.root);

  const car = createCarState(activeTrack);
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
  const attachmentTunerEnabled = new URLSearchParams(window.location.search).has("kitTuner");
  if (attachmentTunerEnabled && isImportedCar(customization.selectedCar)) attachmentTuner.show(customization.selectedCar);
  let appState: AppState = "garage";
  let activeMode: ModeId = customization.selectedMode;
  let sessionTime = runLength;
  let cameraShake = 0;
  let runoffTime = 0;
  let practiceZoneIndex = 0;

  const getTrackForMode = (mode: ModeId) => {
    if (mode === "online-lobby") return onlineLobbyTrack;
    if (mode === "map-editor") return onlineLobbyTrack;
    if (mode === "free-drive") return practiceTrack;
    return driftTrack;
  };

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
    gameScene.remove(trackView.root);
    disposeSceneRoot(trackView.root);
    activeTrack = nextTrack;
    trackView = await createTrackView(gameScene, activeTrack);
    colliders = createTrackColliders(activeTrack);
    coneMeshes = trackView.coneMeshes;
    onlineGhosts.setTrack(activeTrack);
    practiceZoneIndex = 0;
  };

  const reloadActiveTrack = async () => {
    gameScene.remove(trackView.root);
    disposeSceneRoot(trackView.root);
    trackView = await createTrackView(gameScene, activeTrack);
    colliders = createTrackColliders(activeTrack);
    coneMeshes = trackView.coneMeshes;
    onlineGhosts.setTrack(activeTrack);
  };

  const mapEditor = createMapEditor(canvas, gameCamera, gameScene, { onReloadTrack: reloadActiveTrack });

  const resetEvent = () => {
    resetCar(car, activeTrack, getPracticeSpawn());
    resetDrift(drift);
    tireTracks.reset();
    tireSmoke.reset();
    sessionTime = activeMode === "drift-attack" ? runLength : Infinity;
    cameraShake = 0;
    runoffTime = 0;
    carView.applyCustomization(customization);
  };

  const showGarage = () => {
    startEventPending = false;
    portalLaunchPending = false;
    resetInputState();
    appState = "garage";
    results.hide();
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
    carView.root.visible = true;
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
      await switchTrack(getTrackForMode(activeMode));
      baseTuning = await loadCarTuning(customization.selectedCar);
      activeTuning = applyTuningPreset(baseTuning, customization.tuningPreset);
      appState = "event";
      results.hide();
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
        hud.setMode(activeMode === "online-lobby" ? "online-lobby" : activeMode === "free-drive" ? "free-drive" : "drift-attack");
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
    results.show(local ? local.score + local.combo : finishDriftRun(drift), drift.bestCombo, drift.bestRun);
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
      onlineQueueOpen = true;
      const roomCode = onlineClient.connect(playerProfile, customization);
      setActiveQueuePad(roomCode);
      onlineMatchUi.show(roomCode);
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

  function updateEvent(dt: number) {
    const input = readInput();

    if (activeMode === "map-editor") {
      if (input.menu) {
        showGarage();
        return;
      }
      mapEditor.update(dt);
      renderer.render(gameScene, gameCamera);
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
      engineSound.update(car, activeTuning);
      cameraShake = Math.max(0, cameraShake - dt * 1.7);
      updateChaseCamera(gameCamera, car, dt, cameraShake, getCameraOrbit());
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
      renderer.render(gameScene, gameCamera);
      return;
    }

    if (activeMode === "drift-attack") {
      sessionTime = onlineMatchActive && onlineRoom?.matchEndsAt
        ? Math.max(0, (onlineRoom.matchEndsAt - Date.now()) / 1000)
        : sessionTime - dt;
      if (sessionTime <= 0 && !onlineMatchActive) {
        sessionTime = 0;
        finishRun();
        return;
      }
    }

    const substeps = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < substeps; i++) {
      updateCar(car, input, activeTuning, dt / substeps, isOnTrack(car.position, activeTrack));
    }

    const onTrack = isOnTrack(car.position, activeTrack);
    const inRunoff = isInRunoff(car.position, activeTrack);
    if (onTrack) runoffTime = 0;
    else if (inRunoff) runoffTime += dt;
    else runoffTime = 999;

    const scoringSurface = onTrack || (inRunoff && runoffTime <= 1.15);
    const impact = keepCarNearTrack(car, activeTrack);
    if (!onTrack && car.speed > 8) cameraShake = Math.max(cameraShake, Math.min(0.45, car.speed * 0.008));
    if (impact > 0) cameraShake = Math.max(cameraShake, impact * 0.75);

    if (activeMode === "drift-attack") {
      updateDriftScore(drift, car, dt, scoringSurface, getDriftZone(car.position, activeTrack));
    }

    if (onlineMatchActive) {
      onlineInputDebt += dt;
      if (onlineInputDebt >= 1 / 20) {
        onlineInputDebt = 0;
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
        });
      }
    }

    updateTrackCollision(car, colliders, dt, activeTuning);
    syncConeMeshes(coneMeshes, colliders.cones);
    if (onlineMatchActive && onlineRoom) onlineGhosts.setRemotePlayers(onlineRoom.players, onlinePlayerId);
    onlineGhosts.root.visible = activeMode === "online-lobby" || onlineMatchActive;
    onlineGhosts.update(dt);

    const nearbyPortal = getNearbyPortal();
    if (nearbyPortal && input.confirm) launchModeFromPortal(nearbyPortal.mode);

    tireTracks.update(car, onTrack);
    tireSmoke.update(car, onTrack, dt);
    carView.sync(car);
    engineSound.update(car, activeTuning);
    cameraShake = Math.max(0, cameraShake - dt * 1.7);
    updateChaseCamera(gameCamera, car, dt, cameraShake, getCameraOrbit());
    hud.update(car, drift);
    hud.updateTimer(sessionTime);
    if (activeMode === "free-drive") {
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
