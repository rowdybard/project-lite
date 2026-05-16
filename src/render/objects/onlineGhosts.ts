import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { paintColors, type CarCustomization } from "../../game/customization";
import type { TrackConfig, Vec2 } from "../../game/types";
import type { OnlinePlayerState } from "../../net/protocol";
import { createCarView } from "./carView";

type GhostDriver = {
  id: string;
  name: string;
  color: number;
  root: Group;
  progress: number;
  speed: number;
  laneOffset: number;
};

type RemoteDriver = {
  view: ReturnType<typeof createCarView>;
  key: string;
};

export type OnlineGhostSnapshot = {
  id: string;
  name: string;
  color: number;
  position: Vec2;
  speedMph: number;
  heading?: number;
};

type RouteSample = {
  position: Vec2;
  tangent: Vec2;
};

function makeGhostCar(color: number, bodyStyle: "coupe" | "hatch" | "suv" | "pickup") {
  const root = new Group();
  root.name = "online-ghost-car";

  const bodyMaterial = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.16,
    roughness: 0.55,
    metalness: 0.18,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
  });
  const glassMaterial = new MeshStandardMaterial({
    color: 0x9fc6dc,
    emissive: 0x4f7f9a,
    emissiveIntensity: 0.08,
    roughness: 0.28,
    metalness: 0.06,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const wheelMaterial = new MeshStandardMaterial({
    color: 0x10151a,
    roughness: 0.82,
    metalness: 0.12,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  const bodySize =
    bodyStyle === "suv"
      ? { x: 2.55, y: 0.94, z: 4.85 }
      : bodyStyle === "pickup"
        ? { x: 2.5, y: 0.82, z: 5.1 }
        : bodyStyle === "hatch"
          ? { x: 2.22, y: 0.78, z: 3.95 }
          : { x: 2.35, y: 0.72, z: 4.55 };
  const body = new Mesh(new BoxGeometry(bodySize.x, bodySize.y, bodySize.z), bodyMaterial);
  body.position.y = 0.75 + bodySize.y * 0.12;
  root.add(body);

  const hood = new Mesh(new BoxGeometry(bodySize.x * 0.86, 0.16, bodySize.z * 0.26), bodyMaterial);
  hood.position.set(0, 1.12, bodySize.z * 0.22);
  root.add(hood);

  const cabinLength = bodyStyle === "pickup" ? bodySize.z * 0.28 : bodySize.z * 0.38;
  const cabin = new Mesh(new BoxGeometry(bodySize.x * 0.72, bodyStyle === "suv" ? 0.88 : 0.72, cabinLength), glassMaterial);
  cabin.position.set(0, bodyStyle === "suv" ? 1.42 : 1.3, bodyStyle === "pickup" ? -0.68 : -0.42);
  root.add(cabin);

  if (bodyStyle === "pickup") {
    const bedLine = new Mesh(new BoxGeometry(bodySize.x * 0.84, 0.08, bodySize.z * 0.28), bodyMaterial);
    bedLine.position.set(0, 1.17, -bodySize.z * 0.28);
    root.add(bedLine);
  }

  const lightMaterial = new MeshStandardMaterial({
    color: 0xff2f39,
    emissive: 0xff2f39,
    emissiveIntensity: 1.6,
    roughness: 0.35,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  for (const x of [-bodySize.x * 0.32, bodySize.x * 0.32]) {
    const tailLight = new Mesh(new BoxGeometry(0.22, 0.18, 0.05), lightMaterial);
    tailLight.position.set(x, 0.92, -bodySize.z * 0.51);
    root.add(tailLight);
  }

  const wheelGeometry = new CylinderGeometry(0.42, 0.42, 0.34, 16);
  for (const x of [-bodySize.x * 0.52, bodySize.x * 0.52]) {
    for (const z of [-bodySize.z * 0.32, bodySize.z * 0.32]) {
      const wheel = new Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.43, z);
      root.add(wheel);
    }
  }

  root.traverse((child) => {
    if (child instanceof Mesh) child.castShadow = false;
  });

  return root;
}

function buildSegmentLengths(points: Vec2[]) {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    lengths.push(length);
    total += length;
  }
  return { lengths, total };
}

function sampleRoute(points: Vec2[], lengths: number[], total: number, distance: number): RouteSample {
  let remaining = ((distance % total) + total) % total;
  for (let i = 0; i < points.length; i++) {
    const length = Math.max(lengths[i], 0.001);
    if (remaining <= length) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const t = remaining / length;
      const tangent = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
      return {
        position: {
          x: a.x + (b.x - a.x) * t,
          z: a.z + (b.z - a.z) * t,
        },
        tangent,
      };
    }
    remaining -= length;
  }

  return {
    position: points[0],
    tangent: { x: 0, z: 1 },
  };
}

function customizationForPlayer(player: OnlinePlayerState): CarCustomization {
  return {
    selectedMode: "online-lobby",
    selectedCar: player.carId || player.customization.selectedCar,
    paint: player.customization.paint,
    wheelColor: player.customization.wheelColor,
    stance: player.customization.stance,
    spoiler: player.customization.spoiler,
    frontLip: player.customization.frontLip,
    sideSkirts: player.customization.sideSkirts,
    underglow: player.customization.underglow,
    tuningPreset: player.customization.tuningPreset,
  };
}

function remoteKey(player: OnlinePlayerState) {
  return `${player.carId}|${JSON.stringify(player.customization)}`;
}

export function createOnlineGhosts() {
  const root = new Group();
  root.visible = false;

  let points: Vec2[] = [];
  let segmentLengths: number[] = [];
  let totalDistance = 1;
  let ghosts: GhostDriver[] = [];
  let remoteGhosts = new Map<string, RemoteDriver>();
  let remoteSnapshots: OnlineGhostSnapshot[] | null = null;

  function setTrack(track: TrackConfig) {
    root.clear();
    ghosts = [];
    remoteSnapshots = null;
    remoteGhosts.clear();
    points = track.id === "online-lobby" && track.roadPath ? track.roadPath : [];

    if (points.length < 3) {
      root.visible = false;
      return;
    }

    const route = buildSegmentLengths(points);
    segmentLengths = route.lengths;
    totalDistance = Math.max(route.total, 1);
    const colors = [0x68d8ff, 0xf1c75b, 0xa96bff, 0x55e27d, 0xf05a4f, 0xf7f0df, 0x72a0ff, 0xd4a45f];
    const names = ["ApexRiot", "NightLine", "ShiftKid", "CurbCheck", "PulseRun", "TandemMax", "LateBrake", "BlueAero"];
    const styles: Array<"coupe" | "hatch" | "suv" | "pickup"> = ["coupe", "hatch", "suv", "pickup"];
    const laneOffsets = [-11.5, -7, -3.5, 4, 8.5, 12, -14, 14];

    for (let i = 0; i < 8; i++) {
      const color = colors[i % colors.length];
      const ghostRoot = makeGhostCar(color, styles[i % styles.length]);
      root.add(ghostRoot);
      ghosts.push({
        id: `ghost-${i}`,
        name: names[i % names.length],
        color,
        root: ghostRoot,
        progress: (totalDistance / 8) * i + i * 11,
        speed: 9 + (i % 4) * 2.2,
        laneOffset: laneOffsets[i % laneOffsets.length],
      });
    }

    root.visible = true;
  }

  function update(dt: number) {
    if (remoteSnapshots) {
      root.visible = remoteSnapshots.length > 0;
      for (const snapshot of remoteSnapshots) {
        const ghost = remoteGhosts.get(snapshot.id);
        if (!ghost) continue;
        ghost.view.root.position.set(snapshot.position.x, 0, snapshot.position.z);
        ghost.view.root.rotation.y = snapshot.heading ?? ghost.view.root.rotation.y;
      }
      return;
    }

    if (!root.visible || points.length < 3) return;

    for (const ghost of ghosts) {
      ghost.progress += ghost.speed * dt;
      const sample = sampleRoute(points, segmentLengths, totalDistance, ghost.progress);
      const normal = { x: -sample.tangent.z, z: sample.tangent.x };
      ghost.root.position.set(
        sample.position.x + normal.x * ghost.laneOffset,
        0.04,
        sample.position.z + normal.z * ghost.laneOffset,
      );
      ghost.root.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z);
    }
  }

  function getPlayers(): OnlineGhostSnapshot[] {
    if (remoteSnapshots) return remoteSnapshots;
    return ghosts.map((ghost) => ({
      id: ghost.id,
      name: ghost.name,
      color: ghost.color,
      position: { x: ghost.root.position.x, z: ghost.root.position.z },
      speedMph: ghost.speed * 2.237,
    }));
  }

  function setRemotePlayers(players: OnlinePlayerState[], localPlayerId: string | null) {
    remoteSnapshots = players
      .filter((player) => player.id !== localPlayerId)
      .map((player) => ({
        id: player.id,
        name: player.name,
        color: paintColors[player.customization.paint] ?? (player.leader ? 0xf1c75b : 0x68d8ff),
        position: { x: player.pose.x, z: player.pose.z },
        heading: player.pose.heading,
        speedMph: player.pose.speed * 2.237,
      }));

    const live = new Set(remoteSnapshots.map((snapshot) => snapshot.id));
    for (const [id, ghost] of remoteGhosts) {
      if (!live.has(id)) {
        root.remove(ghost.view.root);
        remoteGhosts.delete(id);
      }
    }

    for (const player of players) {
      if (player.id === localPlayerId) continue;
      const key = remoteKey(player);
      const existing = remoteGhosts.get(player.id);
      if (existing?.key === key) continue;
      if (existing) root.remove(existing.view.root);

      const view = createCarView(1.55);
      view.applyCustomization(customizationForPlayer(player));
      view.root.traverse((child) => {
        if (child instanceof Mesh) {
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
      remoteGhosts.set(player.id, { view, key });
      root.add(view.root);
    }
  }

  function clearRemotePlayers() {
    remoteSnapshots = null;
    for (const ghost of remoteGhosts.values()) root.remove(ghost.view.root);
    remoteGhosts.clear();
  }

  return { root, setTrack, update, getPlayers, setRemotePlayers, clearRemotePlayers };
}
