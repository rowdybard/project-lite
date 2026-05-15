import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from "three";
import type { TrackConfig } from "../../game/types";
import { getRoadWidth, isTracksideClearZone } from "../../game/simulation/trackLayout";
import { loadGltf } from "../loaders/loadGltf";
import {
  createAsphaltMaterial,
  createConcreteMaterial,
  createGrassMaterial,
  createGravelMaterial,
  createProceduralStainMaterial,
  createRoadPaintMaterial,
  createRubberMaterial,
  createShoulderMaterial,
} from "../materials/surfaceMaterials";

export type TrackViewResult = {
  root: Object3D;
  coneMeshes: Mesh[];
};

const yawForTangentX = (tangent: Vector3) => Math.atan2(-tangent.z, tangent.x);

export async function createTrackView(scene: Scene, track: TrackConfig): Promise<TrackViewResult> {
  const root = new Group();
  const imported = await loadGltf(track.model);
  if (imported) {
    root.add(imported);
    scene.add(root);
    return { root, coneMeshes: [] };
  }

  const bounds = getTrackBounds(track);
  const grassGeometry = new PlaneGeometry(bounds.width, bounds.depth);
  grassGeometry.setAttribute("uv2", grassGeometry.attributes.uv.clone());
  const grass = new Mesh(
    grassGeometry,
    createGrassMaterial({
      x: Math.max(36, bounds.width / 7),
      y: Math.max(34, bounds.depth / 7),
    }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(bounds.centerX, -0.02, bounds.centerZ);
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  root.add(grass);

  if (track.roadPath && track.roadPath.length >= 4) {
    const { group, coneMeshes } = createRoadFromPath(track, bounds);
    root.add(group);
    scene.add(root);
    return { root, coneMeshes };
  } else {
    root.add(createRingRoad(track));
    scene.add(root);
    return { root, coneMeshes: [] };
  }

}

type TrackBounds = ReturnType<typeof getTrackBounds>;

function createRoadFromPath(track: TrackConfig, bounds: TrackBounds) {
  const group = new Group();
  const points = track.roadPath!.map((point) => new Vector3(point.x, 0, point.z));
  const curve = new CatmullRomCurve3(points, true, "catmullrom", 0.48);
  const samples = curve.getPoints(240);
  const roadWidth = getRoadWidth(track);
  const roadMaterial = createAsphaltMaterial({ x: 1.15, y: 18 });
  roadMaterial.side = DoubleSide;
  const road = new Mesh(createRoadGeometry(samples, roadWidth), roadMaterial);
  road.receiveShadow = true;
  group.add(road);

  group.add(createCornerPoles(track, roadWidth));
  group.add(createShoulderBlend(track, samples, roadWidth));
  group.add(createGrassTufts(track, samples, roadWidth));
  group.add(createFoliage(track, samples, roadWidth));
  group.add(createGrassColorPatches(bounds));
  group.add(createRoadSurfaceWear(samples, roadWidth));
  group.add(createPaintedLines(samples, roadWidth));
  group.add(createRacingLine(samples));
  group.add(createRunoffPatches(track, samples, roadWidth));
  group.add(createPracticeAreas(track));
  group.add(createCurbs(track, samples, roadWidth));
  const trackside = createTracksideDepth(track, samples, roadWidth);
  group.add(trackside.group);
  group.add(createTrainingCircuitDressing(track, samples, roadWidth));
  group.add(createCircuitFacilities(track, samples, roadWidth));
  return { group, coneMeshes: trackside.coneMeshes };
}

function createPracticeAreas(track: TrackConfig) {
  const group = new Group();
  if (!track.practiceAreas) return group;

  const asphaltMaterial = createAsphaltMaterial({ x: 10, y: 5 });
  const paintMaterial = createRoadPaintMaterial({ x: 1, y: 1 }, 0xd8d2bf, 0.68);
  const rubberMaterial = createRubberMaterial({ x: 3, y: 2 }, 0.34);
  const coneMaterial = new MeshStandardMaterial({ color: 0xe68a2e, roughness: 0.72 });

  for (const area of track.practiceAreas) {
    const heading = area.type === "rect" ? area.heading ?? 0 : 0;
    const pad =
      area.type === "circle"
        ? new Mesh(new CylinderGeometry(area.radius, area.radius, 0.035, 96), asphaltMaterial)
        : new Mesh(new BoxGeometry(area.width, 0.035, area.depth), asphaltMaterial);
    pad.position.set(area.x, 0.048, area.z);
    pad.rotation.y = heading;
    pad.receiveShadow = true;
    group.add(pad);

    if (area.type === "circle") {
      for (const radius of [area.radius * 0.48, area.radius * 0.82]) {
        const ring = new Mesh(new RingGeometry(radius - 0.18, radius + 0.18, 96), paintMaterial);
        ring.position.set(area.x, 0.082, area.z);
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);
      }
    } else {
      const outline = [
        { x: 0, z: area.depth / 2 },
        { x: 0, z: -area.depth / 2 },
      ];
      for (const edge of outline) {
        const line = new Mesh(new BoxGeometry(area.width, 0.018, 0.22), paintMaterial);
        line.position.set(area.x, 0.084, area.z);
        line.rotation.y = heading;
        line.translateZ(edge.z);
        group.add(line);
      }
      for (let i = -2; i <= 2; i++) {
        const mark = new Mesh(new BoxGeometry(5.5, 0.014, 2.2), rubberMaterial);
        mark.position.set(area.x, 0.086, area.z);
        mark.rotation.y = heading + i * 0.08;
        mark.translateX(i * 8.5);
        group.add(mark);
      }
    }
  }

  const gymkhana = track.practiceZones?.find((zone) => zone.id === "gymkhana");
  if (gymkhana) {
    for (let row = -2; row <= 2; row++) {
      for (let col = -3; col <= 3; col++) {
        if ((row + col) % 2 !== 0) continue;
        const cone = new Mesh(new CylinderGeometry(0.14, 0.36, 0.78, 12), coneMaterial);
        cone.position.set(gymkhana.x + col * 9, 0.39, gymkhana.z + row * 8);
        cone.castShadow = true;
        group.add(cone);
      }
    }
  }

  return group;
}

function createRoadGeometry(samples: Vector3[], roadWidth: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cumulativeDistances: number[] = [0];

  for (let i = 1; i < samples.length; i++) {
    cumulativeDistances[i] = cumulativeDistances[i - 1] + samples[i].distanceTo(samples[i - 1]);
  }
  const totalDistance = cumulativeDistances[samples.length - 1] + samples[0].distanceTo(samples[samples.length - 1]);
  const across = [-0.5, -0.24, 0, 0.24, 0.5];

  for (let i = 0; i < samples.length; i++) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const distance01 = cumulativeDistances[i] / Math.max(totalDistance, 1);
    const bank = Math.sin(distance01 * Math.PI * 8 + 0.45) * 0.028;

    for (const acrossPosition of across) {
      const crown = (1 - Math.min(1, Math.abs(acrossPosition) * 2)) * 0.09;
      const edgeDrop = Math.pow(Math.abs(acrossPosition) * 2, 1.7) * 0.035;
      const point = samples[i].clone().addScaledVector(normal, acrossPosition * roadWidth);
      positions.push(point.x, 0.036 + crown - edgeDrop + bank * acrossPosition, point.z);
      uvs.push(acrossPosition + 0.5, cumulativeDistances[i] / 7.5);
    }
  }

  for (let i = 0; i < samples.length; i++) {
    const next = (i + 1) % samples.length;
    for (let lane = 0; lane < across.length - 1; lane++) {
      const a = i * across.length + lane;
      const b = i * across.length + lane + 1;
      const c = next * across.length + lane;
      const d = next * across.length + lane + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function getTrackBounds(track: TrackConfig) {
  const points = track.roadPath && track.roadPath.length > 0 ? track.roadPath : [{ x: 0, z: 0 }];
  const padding = Math.max(85, track.roadWidth * 5 + track.boundaryMargin);
  const minX = Math.min(...points.map((p) => p.x)) - padding;
  const maxX = Math.max(...points.map((p) => p.x)) + padding;
  const minZ = Math.min(...points.map((p) => p.z)) - padding;
  const maxZ = Math.max(...points.map((p) => p.z)) + padding;

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

function createRingRoad(track: TrackConfig) {
  const group = new Group();
  const roadMaterial = createAsphaltMaterial({ x: 9, y: 9 });
  roadMaterial.side = DoubleSide;
  const road = new Mesh(
    new RingGeometry(track.roadWidth + 8, track.roadWidth - 8, 220),
    roadMaterial,
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

function createShoulderBlend(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const shoulderMaterial = createShoulderMaterial();

  for (let i = 0; i < samples.length; i += 4) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

      const shoulder = new Mesh(new BoxGeometry(3.1, 0.016, 1.45), shoulderMaterial);
      shoulder.position.copy(samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 1.04)));
      shoulder.position.y = 0.042;
      shoulder.rotation.y = angle;
      shoulder.receiveShadow = true;
      group.add(shoulder);
    }
  }

  return group;
}

function createGrassTufts(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const geometry = new PlaneGeometry(0.38, 0.72);
  const material = new MeshStandardMaterial({
    color: 0x365438,
    side: DoubleSide,
    roughness: 1,
    transparent: true,
    opacity: 0.78,
  });
  material.envMapIntensity = 0.02;
  const tuftCount = Math.min(520, samples.length * 2);
  const tufts = new InstancedMesh(geometry, material, tuftCount);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let index = 0;

  for (let i = 0; i < samples.length && index < tuftCount; i += 2) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const jitter = Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 2.417) * 0.35;

    for (const side of [-1, 1]) {
      if (index >= tuftCount) break;
      if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

      const distance = roadWidth / 2 + 3.4 + ((i * 7) % 10) * 0.72;
      const position = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, jitter * 2.1);
      const scale = 0.64 + ((i * 13) % 9) * 0.055;
      rotation.setFromAxisAngle(up, (i * 0.81 + side * 0.7) % Math.PI);
      matrix.compose(
        new Vector3(position.x, 0.34 * scale, position.z),
        rotation,
        new Vector3(scale, scale, scale),
      );
      tufts.setMatrixAt(index, matrix);
      index += 1;
    }
  }

  tufts.count = index;
  tufts.instanceMatrix.needsUpdate = true;
  tufts.castShadow = true;
  tufts.receiveShadow = true;
  group.add(tufts);
  return group;
}

function createFoliage(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const up = new Vector3(0, 1, 0);
  const matrix = new Matrix4();
  const rotation = new Quaternion();

  const trunkMaterial = new MeshStandardMaterial({ color: 0x4a3425, roughness: 0.95 });
  trunkMaterial.envMapIntensity = 0.02;
  const leafMaterialA = new MeshStandardMaterial({ color: 0x263d27, roughness: 1 });
  leafMaterialA.envMapIntensity = 0.015;
  const leafMaterialB = new MeshStandardMaterial({ color: 0x344f2f, roughness: 1 });
  leafMaterialB.envMapIntensity = 0.015;
  const shrubMaterial = new MeshStandardMaterial({ color: 0x2b4a2d, roughness: 1 });
  shrubMaterial.envMapIntensity = 0.015;

  const trunkGeometry = new CylinderGeometry(0.18, 0.3, 3.6, 7);
  const canopyGeometry = new IcosahedronGeometry(1, 1);
  const shrubGeometry = new IcosahedronGeometry(0.72, 1);
  const treeCount = 64;
  const shrubCount = 180;
  const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const canopiesA = new InstancedMesh(canopyGeometry, leafMaterialA, treeCount);
  const canopiesB = new InstancedMesh(canopyGeometry, leafMaterialB, treeCount);
  const shrubs = new InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  let treeIndex = 0;
  let shrubIndex = 0;

  for (let i = 10; i < samples.length && (treeIndex < treeCount || shrubIndex < shrubCount); i += 3) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const hash = Math.abs(Math.sin(i * 19.191) * 43758.5453) % 1;
    const side = i % 2 === 0 ? 1 : -1;

    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    if (i % 12 === 10 && treeIndex < treeCount) {
      const distance = roadWidth / 2 + 13 + hash * 22;
      const base = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, (hash - 0.5) * 7);
      const heightScale = 0.95 + hash * 0.62;
      const widthScale = 1.05 + ((i * 7) % 10) * 0.065;
      rotation.setFromAxisAngle(up, hash * Math.PI * 2);

      matrix.compose(new Vector3(base.x, 1.75 * heightScale, base.z), rotation, new Vector3(widthScale, heightScale, widthScale));
      trunks.setMatrixAt(treeIndex, matrix);

      matrix.compose(new Vector3(base.x, 4.0 * heightScale, base.z), rotation, new Vector3(1.65 * widthScale, 0.92 * heightScale, 1.35 * widthScale));
      canopiesA.setMatrixAt(treeIndex, matrix);

      matrix.compose(
        new Vector3(base.x + normal.x * side * 0.78, 4.68 * heightScale, base.z + normal.z * side * 0.78),
        rotation,
        new Vector3(1.18 * widthScale, 0.72 * heightScale, 1.08 * widthScale),
      );
      canopiesB.setMatrixAt(treeIndex, matrix);
      treeIndex += 1;
    }

    if (shrubIndex < shrubCount) {
      const distance = roadWidth / 2 + 6.2 + hash * 16;
      const base = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, (((i * 11) % 9) - 4) * 0.75);
      const scale = 0.8 + ((i * 13) % 9) * 0.075;
      rotation.setFromAxisAngle(up, (hash + i * 0.07) * Math.PI * 2);
      matrix.compose(new Vector3(base.x, 0.54 * scale, base.z), rotation, new Vector3(scale * 1.55, scale * 0.66, scale * 1.18));
      shrubs.setMatrixAt(shrubIndex, matrix);
      shrubIndex += 1;
    }
  }

  trunks.count = treeIndex;
  canopiesA.count = treeIndex;
  canopiesB.count = treeIndex;
  shrubs.count = shrubIndex;
  trunks.instanceMatrix.needsUpdate = true;
  canopiesA.instanceMatrix.needsUpdate = true;
  canopiesB.instanceMatrix.needsUpdate = true;
  shrubs.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  canopiesA.castShadow = true;
  canopiesB.castShadow = true;
  shrubs.castShadow = true;
  shrubs.receiveShadow = true;
  group.add(trunks, canopiesA, canopiesB, shrubs);
  return group;
}

function createGrassColorPatches(bounds: TrackBounds) {
  const group = new Group();
  const patchMaterials = [
    new MeshStandardMaterial({ color: 0x1f3527, roughness: 1, transparent: true, opacity: 0.26 }),
    new MeshStandardMaterial({ color: 0x405136, roughness: 1, transparent: true, opacity: 0.13 }),
    new MeshStandardMaterial({ color: 0x2e4f33, roughness: 1, transparent: true, opacity: 0.18 }),
  ];
  for (const material of patchMaterials) material.envMapIntensity = 0.02;

  for (let i = 0; i < 18; i++) {
    const patch = new Mesh(new BoxGeometry(34 + (i % 5) * 12, 0.012, 14 + (i % 4) * 10), patchMaterials[i % patchMaterials.length]);
    const x = bounds.centerX - bounds.width * 0.42 + ((i * 37) % Math.max(1, bounds.width * 0.84));
    const z = bounds.centerZ - bounds.depth * 0.42 + ((i * 53) % Math.max(1, bounds.depth * 0.84));
    patch.position.set(x, -0.002, z);
    patch.rotation.y = (i * 0.41) % Math.PI;
    patch.receiveShadow = true;
    group.add(patch);
  }

  return group;
}

function createRoadSurfaceWear(samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const darkMaterial = createProceduralStainMaterial(0x07090a, 0.38);
  const lightMaterial = createProceduralStainMaterial(0x8a8c86, 0.2);
  const patchMaterial = createRubberMaterial({ x: 1.1, y: 1 }, 0.3);
  const crackGeometry = new BoxGeometry(4.8, 0.01, 0.055);
  const gritGeometry = new BoxGeometry(0.78, 0.008, 0.18);
  const patchGeometry = new BoxGeometry(3.2, 0.009, 0.72);
  const crackCount = Math.floor(samples.length / 3);
  const gritCount = Math.floor(samples.length / 2);
  const patchCount = Math.floor(samples.length / 9);
  const cracks = new InstancedMesh(crackGeometry, darkMaterial, crackCount);
  const grit = new InstancedMesh(gritGeometry, lightMaterial, gritCount);
  const patches = new InstancedMesh(patchGeometry, patchMaterial, patchCount);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let crackIndex = 0;
  let gritIndex = 0;
  let patchIndex = 0;

  for (let i = 0; i < samples.length; i++) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    if (i % 3 === 0 && crackIndex < crackCount) {
      const lateral = (((i * 29) % 100) / 100 - 0.5) * (roadWidth - 3.4);
      const position = samples[i].clone().addScaledVector(normal, lateral);
      rotation.setFromAxisAngle(up, angle + ((((i * 19) % 100) / 100) - 0.5) * 0.42);
      matrix.compose(new Vector3(position.x, 0.098, position.z), rotation, new Vector3(0.74 + ((i * 7) % 8) * 0.08, 1, 1));
      cracks.setMatrixAt(crackIndex, matrix);
      crackIndex += 1;
    }

    if (i % 2 === 0 && gritIndex < gritCount) {
      const lateral = (((i * 41) % 100) / 100 - 0.5) * (roadWidth - 2.2);
      const position = samples[i].clone().addScaledVector(normal, lateral).addScaledVector(tangent, ((i * 13) % 7) - 3);
      rotation.setFromAxisAngle(up, angle + Math.PI * 0.5);
      matrix.compose(new Vector3(position.x, 0.099, position.z), rotation, new Vector3(0.8 + ((i * 5) % 5) * 0.12, 1, 1));
      grit.setMatrixAt(gritIndex, matrix);
      gritIndex += 1;
    }

    if (i % 9 === 0 && patchIndex < patchCount) {
      const lateral = (((i * 11) % 100) / 100 - 0.5) * (roadWidth - 4.8);
      const position = samples[i].clone().addScaledVector(normal, lateral).addScaledVector(tangent, ((i * 17) % 6) - 3);
      rotation.setFromAxisAngle(up, angle + ((((i * 23) % 100) / 100) - 0.5) * 0.3);
      matrix.compose(new Vector3(position.x, 0.097, position.z), rotation, new Vector3(0.85 + ((i * 3) % 5) * 0.11, 1, 0.75 + ((i * 7) % 4) * 0.1));
      patches.setMatrixAt(patchIndex, matrix);
      patchIndex += 1;
    }
  }

  cracks.count = crackIndex;
  grit.count = gritIndex;
  patches.count = patchIndex;
  cracks.instanceMatrix.needsUpdate = true;
  grit.instanceMatrix.needsUpdate = true;
  patches.instanceMatrix.needsUpdate = true;
  group.add(patches, cracks, grit);
  return group;
}

function createPaintedLines(samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const edgeMaterial = createRoadPaintMaterial({ x: 1.8, y: 1 }, 0xcfc8b7, 0.72);
  const seamMaterial = createProceduralStainMaterial(0x15191d, 0.34);

  for (let i = 0; i < samples.length; i += 8) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      const line = new Mesh(new BoxGeometry(3.6, 0.014, 0.075), edgeMaterial);
      line.position.copy(samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 - 0.68)));
      line.position.y = 0.104;
      line.rotation.y = angle;
      group.add(line);
    }

    if (i % 24 === 0) {
      const seam = new Mesh(new BoxGeometry(2.8, 0.01, 0.045), seamMaterial);
      seam.position.copy(samples[i]);
      seam.position.y = 0.105;
      seam.rotation.y = angle;
      group.add(seam);
    }
  }

  return group;
}

function createRacingLine(samples: Vector3[]) {
  const group = new Group();
  const rubberMaterial = createRubberMaterial({ x: 2.4, y: 1.1 }, 0.42);

  for (let i = 0; i < samples.length; i += 4) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const angle = yawForTangentX(tangent);
    const rubber = new Mesh(new BoxGeometry(4.4, 0.012, 3.4), rubberMaterial);
    rubber.position.copy(samples[i]);
    rubber.position.y = 0.106;
    rubber.rotation.y = angle;
    group.add(rubber);
  }

  return group;
}

function createRunoffPatches(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const gravelMaterial = createGravelMaterial({ x: 6, y: 3 });

  for (let i = 12; i < samples.length; i += 40) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);
    const side = i % 80 === 12 ? 1 : -1;
    const runoff = new Mesh(new BoxGeometry(18, 0.02, 8.5), gravelMaterial);
    runoff.position.copy(samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 6.2)));
    runoff.position.y = 0.005;
    runoff.rotation.y = angle;
    runoff.receiveShadow = true;
    group.add(runoff);
  }

  return group;
}

function createCurbs(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const red = createRoadPaintMaterial({ x: 1, y: 1 }, 0xa33a32, 0.94);
  const white = createRoadPaintMaterial({ x: 1, y: 1 }, 0xd7d1bf, 0.94);

  for (let i = 0; i < samples.length; i += 10) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

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

function createGuardrailPanelGeometry(track: TrackConfig, samples: Vector3[], roadWidth: number, side: -1 | 1) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const railDistance = roadWidth / 2 + 3.15;
  const profile = [
    { y: 0.48, depth: 0.02 },
    { y: 0.58, depth: 0.13 },
    { y: 0.69, depth: -0.035 },
    { y: 0.82, depth: 0.13 },
    { y: 0.94, depth: 0.02 },
  ];

  for (let i = 0; i < samples.length; i += 2) {
    const nextIndex = (i + 2) % samples.length;
    if (
      isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track) ||
      isTracksideClearZone({ x: samples[nextIndex].x, z: samples[nextIndex].z }, track)
    ) {
      continue;
    }

    const baseIndex = positions.length / 3;

    for (const sampleIndex of [i, nextIndex]) {
      const previous = samples[(sampleIndex - 1 + samples.length) % samples.length];
      const next = samples[(sampleIndex + 1) % samples.length];
      const tangent = next.clone().sub(previous).normalize();
      const normal = new Vector3(-tangent.z, 0, tangent.x);
      const base = samples[sampleIndex].clone().addScaledVector(normal, side * railDistance);

      for (let p = 0; p < profile.length; p++) {
        const corrugated = base.clone().addScaledVector(normal, side * profile[p].depth);
        positions.push(corrugated.x, profile[p].y, corrugated.z);
        uvs.push(p / (profile.length - 1), sampleIndex / samples.length);
      }
    }

    for (let p = 0; p < profile.length - 1; p++) {
      const a = baseIndex + p;
      const b = baseIndex + p + 1;
      const c = baseIndex + profile.length + p;
      const d = baseIndex + profile.length + p + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createMetalGuardrails(
  track: TrackConfig,
  samples: Vector3[],
  roadWidth: number,
  railMaterial: MeshStandardMaterial,
  postMaterial: MeshStandardMaterial,
) {
  const group = new Group();
  const postGeometry = new BoxGeometry(0.18, 1.18, 0.24);
  const boltGeometry = new BoxGeometry(0.38, 0.08, 0.075);

  for (const side of [-1, 1] as const) {
    const rail = new Mesh(createGuardrailPanelGeometry(track, samples, roadWidth, side), railMaterial);
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
  }

  for (let i = 0; i < samples.length; i += 8) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      const postPosition = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 3.22));
      const post = new Mesh(postGeometry, postMaterial);
      post.position.copy(postPosition);
      post.position.y = 0.58;
      post.rotation.y = angle;
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);

      if (i % 16 === 0) {
        for (const y of [0.6, 0.82]) {
          const bolt = new Mesh(boltGeometry, postMaterial);
          bolt.position.copy(postPosition).addScaledVector(normal, side * 0.08);
          bolt.position.y = y;
          bolt.rotation.y = angle;
          bolt.castShadow = true;
          group.add(bolt);
        }
      }
    }
  }

  return group;
}

function createJerseyBarrierRuns(
  track: TrackConfig,
  samples: Vector3[],
  roadWidth: number,
  concreteMaterial: MeshStandardMaterial,
) {
  const group = new Group();
  const baseGeometry = new BoxGeometry(4.2, 0.34, 0.82);
  const upperGeometry = new BoxGeometry(4.2, 0.5, 0.42);
  const scuffMaterial = createProceduralStainMaterial(0x14171a, 0.28);

  for (let i = 18; i < samples.length; i += 44) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);
    const side = i % 88 === 18 ? 1 : -1;

    for (let segment = -1; segment <= 1; segment++) {
      const center = samples[i]
        .clone()
        .addScaledVector(tangent, segment * 4.05)
        .addScaledVector(normal, side * (roadWidth / 2 + 5.65));

      const base = new Mesh(baseGeometry, concreteMaterial);
      base.position.copy(center);
      base.position.y = 0.2;
      base.rotation.y = angle;
      base.castShadow = true;
      base.receiveShadow = true;
      group.add(base);

      const upper = new Mesh(upperGeometry, concreteMaterial);
      upper.position.copy(center);
      upper.position.y = 0.62;
      upper.rotation.y = angle;
      upper.castShadow = true;
      upper.receiveShadow = true;
      group.add(upper);

      const scuff = new Mesh(new BoxGeometry(2.8, 0.08, 0.025), scuffMaterial);
      scuff.position.copy(center).addScaledVector(normal, -side * 0.43);
      scuff.position.y = 0.48;
      scuff.rotation.y = angle;
      group.add(scuff);
    }
  }

  return group;
}

function createTireBarrierStacks(track: TrackConfig, samples: Vector3[], roadWidth: number, tireMaterial: MeshStandardMaterial) {
  const group = new Group();
  const tireGeometry = new TorusGeometry(0.42, 0.13, 8, 18);
  const defaultNormal = new Vector3(0, 0, 1);

  for (let i = 30; i < samples.length; i += 52) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const side = i % 104 === 30 ? 1 : -1;
    const base = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 4.75));
    const rotation = new Quaternion().setFromUnitVectors(defaultNormal, tangent);

    for (let column = -2; column <= 2; column++) {
      for (let row = 0; row < 2; row++) {
        const tire = new Mesh(tireGeometry, tireMaterial);
        tire.position.copy(base).addScaledVector(tangent, column * 0.52).addScaledVector(normal, side * (row * 0.05));
        tire.position.y = 0.44 + row * 0.52;
        tire.quaternion.copy(rotation);
        tire.rotation.z += (column + row) * 0.11;
        tire.castShadow = true;
        tire.receiveShadow = true;
        group.add(tire);
      }
    }
  }

  return group;
}

function createTrainingCircuitDressing(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const railMaterial = new MeshStandardMaterial({ color: 0x858a8c, roughness: 0.5, metalness: 0.34 });
  railMaterial.side = DoubleSide;
  const postMaterial = new MeshStandardMaterial({ color: 0x343a3e, roughness: 0.72, metalness: 0.18 });
  const concreteMaterial = createConcreteMaterial({ x: 4, y: 1 });
  const signMaterial = new MeshStandardMaterial({ color: 0x242a2f, roughness: 0.72, metalness: 0.08 });
  const yellowMaterial = createRoadPaintMaterial({ x: 1, y: 1 }, 0xc7a33f, 0.86);
  const lightMaterial = new MeshStandardMaterial({ color: 0xf6edd2, emissive: 0xe5bf55, roughness: 0.35 });
  const tireMaterial = createRubberMaterial({ x: 1.5, y: 1.5 }, 1);

  group.add(createMetalGuardrails(track, samples, roadWidth, railMaterial, postMaterial));
  group.add(createJerseyBarrierRuns(track, samples, roadWidth, concreteMaterial));
  group.add(createTireBarrierStacks(track, samples, roadWidth, tireMaterial));

  for (let i = 14; i < samples.length; i += 44) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);
    const localAngle = yawForTangentX(localTangent);
    const side = i % 88 === 14 ? 1 : -1;

    const billboard = new Mesh(new BoxGeometry(6.4, 1.55, 0.18), signMaterial);
    billboard.position.copy(samples[i].clone().addScaledVector(localNormal, side * (roadWidth / 2 + 8.4)));
    billboard.position.y = 2.55;
    billboard.rotation.y = localAngle;
    billboard.castShadow = true;
    group.add(billboard);

    const stripe = new Mesh(new BoxGeometry(5.4, 0.12, 0.2), yellowMaterial);
    stripe.position.copy(billboard.position);
    stripe.position.y += 0.26;
    stripe.rotation.y = billboard.rotation.y;
    group.add(stripe);

    for (const offset of [-2.6, 2.6]) {
      const signPost = new Mesh(new BoxGeometry(0.14, 2.5, 0.14), postMaterial);
      signPost.position.copy(samples[i].clone().addScaledVector(localNormal, side * (roadWidth / 2 + 8.55)).addScaledVector(localTangent, offset));
      signPost.position.y = 1.28;
      signPost.castShadow = true;
      group.add(signPost);
    }
  }

  for (let i = 22; i < samples.length; i += 58) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);

    const pole = new Mesh(new CylinderGeometry(0.16, 0.2, 7.6, 12), postMaterial);
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

function createCircuitFacilities(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  if (!track.roadPath || track.id !== "harbor-grand-circuit") return group;

  const asphaltMaterial = createAsphaltMaterial({ x: 12, y: 2 });
  const wallMaterial = createConcreteMaterial({ x: 12, y: 1 });
  const glassMaterial = new MeshStandardMaterial({ color: 0x5e7e92, roughness: 0.24, metalness: 0.2 });
  const roofMaterial = new MeshStandardMaterial({ color: 0x1d252d, roughness: 0.72, metalness: 0.14 });
  const standMaterial = createConcreteMaterial({ x: 4, y: 2 });
  const seatMaterial = new MeshStandardMaterial({ color: 0x8f3434, roughness: 0.72 });
  const startMaterial = new MeshStandardMaterial({ color: 0x10151b, roughness: 0.48, metalness: 0.18 });
  const stripeMaterial = createRoadPaintMaterial({ x: 1, y: 1 }, 0xd8d2bf, 0.92);

  const start = new Vector3(track.start.x, 0, track.start.z);
  const tangent = samples[2].clone().sub(samples[0]).normalize();
  const normal = new Vector3(-tangent.z, 0, tangent.x);
  const angle = yawForTangentX(tangent);

  const pitLane = new Mesh(new BoxGeometry(74, 0.035, 6.4), asphaltMaterial);
  pitLane.position.copy(start.clone().addScaledVector(normal, -(roadWidth / 2 + 13.2)));
  pitLane.position.y = 0.045;
  pitLane.rotation.y = angle;
  pitLane.receiveShadow = true;
  group.add(pitLane);

  const pitWall = new Mesh(new BoxGeometry(58, 0.34, 0.22), wallMaterial);
  pitWall.position.copy(start.clone().addScaledVector(normal, -(roadWidth / 2 + 8.8)));
  pitWall.position.y = 0.19;
  pitWall.rotation.y = angle;
  pitWall.castShadow = true;
  group.add(pitWall);

  for (let i = -3; i <= 3; i++) {
    const garage = new Mesh(new BoxGeometry(10, 4.2, 9), roofMaterial);
    garage.position
      .copy(start)
      .addScaledVector(tangent, i * 11.5)
      .addScaledVector(normal, -(roadWidth / 2 + 23.5));
    garage.position.y = 2.1;
    garage.rotation.y = angle;
    garage.castShadow = true;
    garage.receiveShadow = true;
    group.add(garage);

    const door = new Mesh(new BoxGeometry(6.8, 2.3, 0.24), glassMaterial);
    door.position.copy(garage.position).addScaledVector(normal, 4.62);
    door.position.y = 1.25;
    door.rotation.y = angle;
    group.add(door);

    const roofLip = new Mesh(new BoxGeometry(10.6, 0.28, 9.7), startMaterial);
    roofLip.position.copy(garage.position);
    roofLip.position.y = 4.32;
    roofLip.rotation.y = angle;
    roofLip.castShadow = true;
    group.add(roofLip);

    for (const baySide of [-1, 1]) {
      const column = new Mesh(new BoxGeometry(0.24, 2.7, 0.28), wallMaterial);
      column.position.copy(door.position).addScaledVector(tangent, baySide * 3.55);
      column.position.y = 1.35;
      column.rotation.y = angle;
      column.castShadow = true;
      group.add(column);
    }
  }

  for (let i = -2; i <= 2; i++) {
    const standBase = new Mesh(new BoxGeometry(16, 2.1, 8), standMaterial);
    standBase.position
      .copy(start)
      .addScaledVector(tangent, i * 18)
      .addScaledVector(normal, roadWidth / 2 + 20);
    standBase.position.y = 1.05;
    standBase.rotation.y = angle;
    standBase.castShadow = true;
    group.add(standBase);

    for (let row = 0; row < 4; row++) {
      const seats = new Mesh(new BoxGeometry(14, 0.22, 0.9), seatMaterial);
      seats.position.copy(standBase.position).addScaledVector(normal, row * 1.35 - 2.6);
      seats.position.y = 2.35 + row * 0.42;
      seats.rotation.y = angle;
      group.add(seats);
    }
  }

  const gantry = new Group();
  for (const side of [-1, 1]) {
    const post = new Mesh(new BoxGeometry(0.22, 7.2, 0.22), startMaterial);
    post.position.copy(start.clone().addScaledVector(normal, side * (roadWidth / 2 + 1.3)));
    post.position.y = 3.6;
    post.rotation.y = angle;
    gantry.add(post);

    const foot = new Mesh(new BoxGeometry(1.2, 0.18, 0.9), wallMaterial);
    foot.position.copy(post.position);
    foot.position.y = 0.09;
    foot.rotation.y = angle;
    foot.castShadow = true;
    gantry.add(foot);
  }

  for (const y of [6.7, 7.35]) {
    const beam = new Mesh(new BoxGeometry(roadWidth + 4.4, 0.16, 0.18), startMaterial);
    beam.position.copy(start);
    beam.position.y = y;
    beam.rotation.y = angle + Math.PI / 2;
    beam.castShadow = true;
    gantry.add(beam);
  }

  for (let i = -3; i <= 3; i++) {
    const diagonal = new Mesh(new BoxGeometry(0.14, 1.1, 0.14), startMaterial);
    diagonal.position.copy(start).addScaledVector(normal, i * ((roadWidth + 2.8) / 7));
    diagonal.position.y = 7.03;
    diagonal.rotation.y = angle + Math.PI / 2;
    diagonal.rotation.z = i % 2 === 0 ? 0.72 : -0.72;
    diagonal.castShadow = true;
    gantry.add(diagonal);
  }

  for (let i = -2; i <= 2; i++) {
    const signal = new Mesh(new BoxGeometry(0.72, 0.34, 0.16), i === 0 ? stripeMaterial : startMaterial);
    signal.position.copy(start).addScaledVector(normal, i * 1.1);
    signal.position.y = 6.28;
    signal.rotation.y = angle + Math.PI / 2;
    signal.castShadow = true;
    gantry.add(signal);
  }

  for (let side = -1; side <= 1; side += 2) {
    const startLine = new Mesh(new BoxGeometry(roadWidth * 0.42, 0.035, 0.34), stripeMaterial);
    startLine.position.copy(start).addScaledVector(normal, side * (roadWidth * 0.23));
    startLine.position.y = 0.11;
    startLine.rotation.y = angle + Math.PI / 2;
    group.add(startLine);
  }

  for (let i = -3; i <= 3; i++) {
    const box = new Mesh(new BoxGeometry(1.6, 0.028, 2.2), i % 2 === 0 ? stripeMaterial : startMaterial);
    box.position.copy(start).addScaledVector(tangent, -10 + i * 2.2).addScaledVector(normal, 0.9);
    box.position.y = 0.12;
    box.rotation.y = angle;
    group.add(box);
  }

  group.add(gantry);
  return group;
}
