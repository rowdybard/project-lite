import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  RepeatWrapping,
  Scene,
  Shape,
  Vector3,
} from "three";
import type { TrackConfig } from "../../game/types";
import { getRoadWidth, isTracksideClearZone } from "../../game/simulation/trackLayout";
import { loadGltf } from "../loaders/loadGltf";

export type TrackViewResult = {
  coneMeshes: Mesh[];
};

export async function createTrackView(scene: Scene, track: TrackConfig): Promise<TrackViewResult> {
  const imported = await loadGltf(track.model);
  if (imported) {
    scene.add(imported);
    return { coneMeshes: [] };
  }

  const grass = new Mesh(
    new PlaneGeometry(360, 320),
    new MeshStandardMaterial({ color: 0x34523d, map: createGrassTexture(), roughness: 0.96 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  scene.add(grass);

  if (track.roadPath && track.roadPath.length >= 4) {
    const { group, coneMeshes } = createRoadFromPath(track);
    scene.add(group);
    return { coneMeshes };
  } else {
    scene.add(createRingRoad(track));
    return { coneMeshes: [] };
  }

}

function createRoadFromPath(track: TrackConfig) {
  const group = new Group();
  const points = track.roadPath!.map((point) => new Vector3(point.x, 0, point.z));
  const curve = new CatmullRomCurve3(points, true, "catmullrom", 0.48);
  const samples = curve.getPoints(240);
  const roadWidth = getRoadWidth(track);
  const roadShape = new Shape();

  const leftEdge: Vector3[] = [];
  const rightEdge: Vector3[] = [];

  for (let i = 0; i < samples.length; i++) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    leftEdge.push(samples[i].clone().addScaledVector(normal, roadWidth / 2));
    rightEdge.push(samples[i].clone().addScaledVector(normal, -roadWidth / 2));
  }

  roadShape.moveTo(leftEdge[0].x, leftEdge[0].z);
  for (const point of leftEdge.slice(1)) roadShape.lineTo(point.x, point.z);
  for (const point of rightEdge.reverse()) roadShape.lineTo(point.x, point.z);
  roadShape.closePath();

  const road = new Mesh(
    new ExtrudeGeometry(roadShape, { depth: 0.06, bevelEnabled: false }),
    new MeshStandardMaterial({ color: 0x2e3138, map: createRoadTexture(), roughness: 0.88 }),
  );
  road.rotation.x = Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  group.add(road);

  group.add(createCornerPoles(track, roadWidth));
  group.add(createCurbs(track, samples, roadWidth));
  const trackside = createTracksideDepth(track, samples, roadWidth);
  group.add(trackside.group);
  group.add(createTrainingCircuitDressing(track, samples, roadWidth));
  return { group, coneMeshes: trackside.coneMeshes };
}

function createRingRoad(track: TrackConfig) {
  const group = new Group();
  const road = new Mesh(
    new RingGeometry(track.roadWidth + 8, track.roadWidth - 8, 220),
    new MeshStandardMaterial({ color: 0x2e3138, roughness: 0.82, side: DoubleSide }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.015;
  road.receiveShadow = true;
  group.add(road);
  return group;
}

function createCornerPoles(track: TrackConfig, roadWidth: number): Object3D {
  const group = new Group();
  if (!track.roadPath) return group;

  const material = new MeshStandardMaterial({ color: 0xd6202b, emissive: 0x370305, roughness: 0.46 });

  for (let i = 0; i < track.roadPath.length; i++) {
    const previous = track.roadPath[(i - 1 + track.roadPath.length) % track.roadPath.length];
    const current = track.roadPath[i];
    const next = track.roadPath[(i + 1) % track.roadPath.length];
    const tangent = new Vector3(next.x - previous.x, 0, next.z - previous.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);

    for (const side of [-1, 1]) {
      if (isTracksideClearZone({ x: current.x, z: current.z }, track)) continue;

      const pole = new Mesh(new CylinderGeometry(0.12, 0.12, 2.5, 12), material);
      pole.position.set(current.x + normal.x * side * (roadWidth / 2 + 1.05), 1.25, current.z + normal.z * side * (roadWidth / 2 + 1.05));
      pole.castShadow = true;
      group.add(pole);
    }
  }

  return group;
}

function createRoadTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2b2e34";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 900; i++) {
    const shade = 38 + Math.random() * 38;
    ctx.fillStyle = `rgba(${shade}, ${shade + 2}, ${shade + 7}, ${0.12 + Math.random() * 0.18})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  for (let y = 0; y < 256; y += 28) {
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fillRect(0, y, 256, 1);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(18, 16);
  return texture;
}

function createGrassTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#34523d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 1300; i++) {
    const green = 58 + Math.random() * 52;
    ctx.strokeStyle = `rgba(${22 + Math.random() * 28}, ${green}, ${34 + Math.random() * 28}, 0.24)`;
    ctx.beginPath();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 8 - 4, y + Math.random() * 8 - 4);
    ctx.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(34, 30);
  return texture;
}

function createCurbs(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const red = new MeshStandardMaterial({ color: 0xbd2d32, roughness: 0.62 });
  const white = new MeshStandardMaterial({ color: 0xf4f0dc, roughness: 0.58 });

  for (let i = 0; i < samples.length; i += 10) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = Math.atan2(tangent.x, tangent.z);

    for (const side of [-1, 1]) {
      const curb = new Mesh(new BoxGeometry(1.85, 0.1, 0.72), (i / 10) % 2 === 0 ? red : white);
      curb.position.copy(samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 0.35)));
      curb.position.y = 0.12;
      curb.rotation.y = angle;
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    }
  }

  return group;
}

function createTracksideDepth(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const coneMeshes: Mesh[] = [];
  const coneMaterial = new MeshStandardMaterial({ color: 0xe68a2e, roughness: 0.7 });
  const postMaterial = new MeshStandardMaterial({ color: 0xd8d2bd, roughness: 0.74 });

  for (let i = 6; i < samples.length; i += 24) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);

    for (const side of [-1, 1]) {
      const cone = new Mesh(new CylinderGeometry(0.15, 0.38, 0.8, 12), coneMaterial);
      cone.position.copy(samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 2.4)));
      cone.position.y = 0.4;
      cone.castShadow = true;
      group.add(cone);
      coneMeshes.push(cone);
    }
  }

  for (let i = 0; i < samples.length; i += 40) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const post = new Mesh(new CylinderGeometry(0.18, 0.18, 2.6, 10), postMaterial);
    post.position.copy(samples[i].clone().addScaledVector(normal, roadWidth / 2 + 6.5));
    post.position.y = 1.3;
    post.castShadow = true;
    group.add(post);
  }

  return { group, coneMeshes };
}

function createTrainingCircuitDressing(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const barrierMaterial = new MeshStandardMaterial({ color: 0x9fa7ad, roughness: 0.64, metalness: 0.18 });
  const darkBarrierMaterial = new MeshStandardMaterial({ color: 0x29313a, roughness: 0.7, metalness: 0.08 });
  const signMaterial = new MeshStandardMaterial({ color: 0x1b2836, roughness: 0.58, metalness: 0.05 });
  const yellowMaterial = new MeshStandardMaterial({ color: 0xe5bf55, emissive: 0x322000, roughness: 0.52 });
  const lightMaterial = new MeshStandardMaterial({ color: 0xf6edd2, emissive: 0xe5bf55, roughness: 0.35 });
  for (let i = 4; i < samples.length; i += 18) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);
    const localAngle = Math.atan2(localTangent.x, localTangent.z);

    for (const side of [-1, 1]) {
      const barrier = new Mesh(new BoxGeometry(5.2, 0.72, 0.38), i % 36 === 4 ? yellowMaterial : barrierMaterial);
      barrier.position.copy(samples[i].clone().addScaledVector(localNormal, side * (roadWidth / 2 + 1.7)));
      barrier.position.y = 0.42;
      barrier.rotation.y = localAngle;
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      group.add(barrier);
    }
  }

  for (let i = 14; i < samples.length; i += 44) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);
    const localAngle = Math.atan2(localTangent.x, localTangent.z);
    const side = i % 88 === 14 ? 1 : -1;

    const billboard = new Mesh(new BoxGeometry(7.5, 2.1, 0.24), signMaterial);
    billboard.position.copy(samples[i].clone().addScaledVector(localNormal, side * (roadWidth / 2 + 7.4)));
    billboard.position.y = 2.5;
    billboard.rotation.y = localAngle;
    billboard.castShadow = true;
    group.add(billboard);

    const stripe = new Mesh(new BoxGeometry(6.5, 0.22, 0.28), yellowMaterial);
    stripe.position.copy(billboard.position);
    stripe.position.y += 0.45;
    stripe.rotation.y = billboard.rotation.y;
    group.add(stripe);
  }

  for (let i = 22; i < samples.length; i += 58) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);

    const pole = new Mesh(new CylinderGeometry(0.16, 0.2, 7.6, 12), darkBarrierMaterial);
    pole.position.copy(samples[i].clone().addScaledVector(localNormal, roadWidth / 2 + 10.5));
    pole.position.y = 3.8;
    pole.castShadow = true;
    group.add(pole);

    const lamp = new Mesh(new BoxGeometry(1.3, 0.34, 0.72), lightMaterial);
    lamp.position.copy(pole.position);
    lamp.position.y = 7.35;
    lamp.castShadow = true;
    group.add(lamp);
  }
  return group;
}
