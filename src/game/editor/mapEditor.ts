import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
} from "three";
import type { TrackConfig } from "../types";
import {
  clearMapEdits,
  loadMapEdits,
  mapEditorAssetOptions,
  saveMapEdits,
  type MapEditAssetId,
  type MapEditStamp,
  type MapEditTool,
} from "./mapEdits";
import { createMapEditorUi } from "../../ui/mapEditorUi";
import { createMapEditStampObject } from "../../render/objects/mapEditObjects";

type MapEditorOptions = {
  onReloadTrack: () => void | Promise<void>;
};

const groundY = 0.13;

export function createMapEditor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, scene: Scene, options: MapEditorOptions) {
  const ui = createMapEditorUi({
    onTool(tool) {
      activeTool = tool;
      updateCursorMaterial();
    },
    onBrush(radius) {
      brushRadius = radius;
      cursor.scale.setScalar(radius);
      ui.setStatus(activeTool === "asset" ? `Asset scale ${(radius / 10).toFixed(1)}x` : `Brush ${radius}m`);
    },
    onAsset(asset) {
      activeAsset = asset;
      activeTool = "asset";
      ui.setTool("asset");
      updateCursorMaterial();
      ui.setStatus(`Placing ${mapEditorAssetOptions.find((option) => option.id === asset)?.label ?? asset} — R rotate, 0 reset`);
    },
    onUndo() {
      doUndo();
    },
    onRotateReset() {
      assetRotation = 0;
      ui.setStatus("Rotation reset to 0°");
    },
    async onSave() {
      if (!track) return;
      try {
        await saveMapEdits(track.id, stamps);
        liveLayer.clear();
        dirty = false;
        ui.setDirty(false, stamps.length);
        await options.onReloadTrack();
        ui.setStatus(`Saved — ${stamps.length} stamp${stamps.length === 1 ? "" : "s"} written to ${track.id}.json`);
      } catch (error) {
        ui.setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    onExport() {
      if (!track) return;
      const blob = new Blob([JSON.stringify({ trackId: track.id, edits: stamps }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${track.id}-map-edits.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      ui.setStatus(`Exported ${stamps.length} stamp${stamps.length === 1 ? "" : "s"} as JSON`);
    },
    async onClear() {
      if (!track) return;
      try {
        stamps = [];
        await clearMapEdits(track.id);
        liveLayer.clear();
        dirty = false;
        ui.setDirty(false, 0);
        await options.onReloadTrack();
        ui.setStatus("All map edits cleared");
      } catch (error) {
        ui.setStatus(error instanceof Error ? error.message : String(error));
      }
    },
  });

  const root = new Group();
  root.name = "map-editor-root";
  root.visible = false;
  scene.add(root);

  const liveLayer = new Group();
  root.add(liveLayer);

  const cursorRoad = new MeshBasicMaterial({ color: 0x68d8ff, transparent: true, opacity: 0.72, depthWrite: false });
  const cursorGrass = new MeshBasicMaterial({ color: 0xf1c75b, transparent: true, opacity: 0.72, depthWrite: false });
  const cursor = new Mesh(new RingGeometry(0.94, 1, 72), cursorGrass);
  cursor.rotation.x = -Math.PI / 2;
  cursor.position.y = groundY + 0.05;
  cursor.renderOrder = 30;
  root.add(cursor);

  const keys = new Set<string>();
  const pointer = new Vector2();
  const groundPoint = new Vector3();
  const direction = new Vector3();
  const right = new Vector3();
  let track: TrackConfig | null = null;
  let stamps: MapEditStamp[] = [];
  let active = false;
  let activeTool: MapEditTool = "grass";
  let activeAsset: MapEditAssetId = "asphalt-pad";
  let assetRotation = 0;
  let brushRadius = 10;
  let yaw = 0;
  let pitch = -0.72;
  let rotating = false;
  let painting = false;
  let dirty = false;
  let lastPaintX = Infinity;
  let lastPaintZ = Infinity;

  function doUndo() {
    if (stamps.length === 0) {
      ui.setStatus("Nothing to undo");
      return;
    }
    stamps.pop();
    const last = liveLayer.children[liveLayer.children.length - 1];
    if (last) liveLayer.remove(last);
    dirty = stamps.length > 0;
    ui.setDirty(dirty, stamps.length);
    ui.setStatus(`Undone — ${stamps.length} stamp${stamps.length === 1 ? "" : "s"} remaining`);
  }

  function updateCursorMaterial() {
    cursor.material = activeTool === "road" || activeTool === "asset" ? cursorRoad : cursorGrass;
    ui.setStatus(
      activeTool === "road"
        ? "Painting road"
        : activeTool === "asset"
          ? `Placing ${mapEditorAssetOptions.find((option) => option.id === activeAsset)?.label ?? activeAsset}. R rotates.`
          : "Removing road with real grass",
    );
  }

  function setCameraFromAngles() {
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(camera.position.clone().add(direction));
  }

  function updateGroundPoint(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    direction.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const t = Math.abs(direction.y) < 0.0001 ? 0 : (groundY - camera.position.y) / direction.y;
    if (t <= 0) return false;
    groundPoint.copy(camera.position).addScaledVector(direction, t);
    cursor.position.x = groundPoint.x;
    cursor.position.z = groundPoint.z;
    cursor.visible = true;
    return true;
  }

  function addStamp() {
    if (!track) return;
    if (Math.hypot(groundPoint.x - lastPaintX, groundPoint.z - lastPaintZ) < brushRadius * 0.42) return;
    const stamp: MapEditStamp = {
      id: `${Date.now().toString(36)}-${Math.round(Math.random() * 100000).toString(36)}`,
      tool: activeTool,
      asset: activeTool === "asset" ? activeAsset : undefined,
      x: Number(groundPoint.x.toFixed(2)),
      z: Number(groundPoint.z.toFixed(2)),
      radius: brushRadius,
      rotation: activeTool === "asset" ? Number(assetRotation.toFixed(3)) : undefined,
    };
    stamps.push(stamp);
    liveLayer.add(createMapEditStampObject(stamp));
    dirty = true;
    lastPaintX = groundPoint.x;
    lastPaintZ = groundPoint.z;
    ui.setDirty(true, stamps.length);
    const label = activeTool === "asset" ? (mapEditorAssetOptions.find((o) => o.id === activeAsset)?.label ?? activeAsset) : activeTool === "road" ? "Road" : "Erase";
    ui.setStatus(`${label} placed — ${stamps.length} stamp${stamps.length === 1 ? "" : "s"} · Ctrl+S to save`);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!active) return;
    keys.add(event.code);
    if (event.ctrlKey && event.code === "KeyZ") {
      doUndo();
      event.preventDefault();
      return;
    }
    if (event.ctrlKey && event.code === "KeyS") {
      document.querySelector<HTMLButtonElement>(".map-editor [data-save]")?.click();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyR" && !event.ctrlKey) {
      const step = event.shiftKey ? Math.PI / 36 : Math.PI / 12;
      assetRotation += step;
      ui.setStatus(`Rotation: ${Math.round(((assetRotation * 180) / Math.PI) % 360)}°  (Shift+R for fine, 0 to reset)`);
      event.preventDefault();
    }
    if (event.code === "Digit0") {
      assetRotation = 0;
      ui.setStatus("Rotation reset to 0°");
      event.preventDefault();
    }
    if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight"].includes(event.code)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
  }

  function onPointerDown(event: PointerEvent) {
    if (!active || event.target !== canvas) return;
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      rotating = true;
      event.preventDefault();
      return;
    }
    if (event.button === 0 && updateGroundPoint(event.clientX, event.clientY)) {
      painting = activeTool !== "asset";
      lastPaintX = Infinity;
      lastPaintZ = Infinity;
      addStamp();
      event.preventDefault();
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!active) return;
    if (rotating) {
      yaw -= event.movementX * 0.0042;
      pitch = Math.max(-1.42, Math.min(-0.08, pitch - event.movementY * 0.0036));
      setCameraFromAngles();
      event.preventDefault();
      return;
    }
    if (updateGroundPoint(event.clientX, event.clientY) && painting) addStamp();
  }

  function onPointerUp(event: PointerEvent) {
    if (!active) return;
    if (event.button === 0) painting = false;
    if (event.button === 2) rotating = false;
  }

  function onWheel(event: WheelEvent) {
    if (!active) return;
    brushRadius = Math.max(3, Math.min(26, brushRadius + Math.sign(event.deltaY)));
    cursor.scale.setScalar(brushRadius);
    ui.setBrush(brushRadius);
    event.preventDefault();
  }

  canvas.addEventListener("contextmenu", (event) => {
    if (active) event.preventDefault();
  });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    root,
    get active() {
      return active;
    },
    setTrack(nextTrack: TrackConfig) {
      track = nextTrack;
      stamps = [];
      liveLayer.clear();
      dirty = false;
      ui.show(`${nextTrack.name}`);
      ui.setStatus("Loading edits…");
      void loadMapEdits(nextTrack.id).then((loaded) => {
        if (track?.id !== nextTrack.id) return;
        stamps = loaded;
        dirty = false;
        ui.show(`${nextTrack.name}`);
        ui.setDirty(false, stamps.length);
        ui.setStatus("RMB look · WASD fly · Q/E up/down · LMB paint · R rotate · Shift+R fine · 0 reset");
      }).catch((error) => {
        ui.setStatus(error instanceof Error ? error.message : String(error));
      });
      const start = nextTrack.start;
      camera.position.set(start.x, 52, start.z + 72);
      yaw = start.heading + Math.PI;
      pitch = -0.68;
      setCameraFromAngles();
    },
    show(nextTrack: TrackConfig) {
      active = true;
      root.visible = true;
      cursor.scale.setScalar(brushRadius);
      ui.root.hidden = false;
      this.setTrack(nextTrack);
    },
    hide() {
      active = false;
      rotating = false;
      painting = false;
      root.visible = false;
      cursor.visible = false;
      ui.hide();
      keys.clear();
    },
    update(dt: number) {
      if (!active) return;
      const moveSpeed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 76 : 32) * dt;
      direction.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
      right.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
      if (keys.has("KeyW")) camera.position.addScaledVector(direction, moveSpeed);
      if (keys.has("KeyS")) camera.position.addScaledVector(direction, -moveSpeed);
      if (keys.has("KeyD")) camera.position.addScaledVector(right, moveSpeed);
      if (keys.has("KeyA")) camera.position.addScaledVector(right, -moveSpeed);
      if (keys.has("KeyE")) camera.position.y += moveSpeed;
      if (keys.has("KeyQ")) camera.position.y -= moveSpeed;
      camera.position.y = Math.max(4, Math.min(150, camera.position.y));
      setCameraFromAngles();
    },
  };
}
