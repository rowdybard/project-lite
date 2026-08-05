import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Light,
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
import type { CarState, TrackConfig } from "../../game/types";
import { loadMapEdits, type MapEditStamp } from "../../game/editor/mapEdits";
import { getRoadWidth, isTracksideClearZone } from "../../game/simulation/trackLayout";
import { buildArenaShell, createIndoorVenueSign, type ArenaShellResult } from "../arena/arenaShell";
import { arenaPalette } from "../arena/palette";
import { loadGltf } from "../loaders/loadGltf";
import {
  createAsphaltMaterial,
  createConcreteMaterial,
  createGrassMaterial,
  createGravelMaterial,
  createIndoorAsphaltMaterial,
  createIndoorTrackEdgeMaterial,
  createProceduralStainMaterial,
  createRoadPaintMaterial,
  createRubberMaterial,
  createShoulderMaterial,
} from "../materials/surfaceMaterials";
import { createMapEditStampObject } from "./mapEditObjects";
import { disposeObject3D } from "../resources/disposeObject3D";
import {
  collectAuthoredColliders,
  collectDynamicCones,
  markBoxCollider,
  markCircleCollider,
  markDynamicCone,
} from "../resources/colliderAuthoring";
import { createCollisionWorld } from "../../game/simulation/collisionWorld";

export type TrackViewResult = {
  root: Object3D;
  coneMeshes: Mesh[];
  cornerMarkers: CornerMarker[];
  arena?: ArenaShellResult;
  windUniforms?: { value: number }[];
  collisionWorld?: import("../../game/simulation/collisionWorld").CollisionWorld;
  cones?: import("../../game/simulation/trackCollision").Cone[];
  dispose(): void;
};

// Public helper for applying track mood to a scene during commit/rollback
export function applyTrackMood(scene: Scene, track: TrackConfig) {
  configureTrackMood(scene, isIndoorDriftVenue(track));
}

type CornerMarker = {
  anchor: Group;
  pole: Group;
  x: number;
  z: number;
  bendX: number;
  bendZ: number;
};

type DressingPlacement = {
  allows: (point: { x: number; z: number }, roadClearance?: number, objectRadius?: number) => boolean;
};

const yawForTangentX = (tangent: Vector3) => Math.atan2(-tangent.z, tangent.x);
const roadBaseY = 0.036;
const asphaltTextureMeters = 6.4;
const isIndoorDriftVenue = (track: TrackConfig) => track.id === "indoor-drift-lab";

function buildRoadDistances(samples: Vector3[]) {
  const cumulativeDistances: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    cumulativeDistances[i] = cumulativeDistances[i - 1] + samples[i].distanceTo(samples[i - 1]);
  }
  const totalDistance = cumulativeDistances[samples.length - 1] + samples[0].distanceTo(samples[samples.length - 1]);
  return { cumulativeDistances, totalDistance };
}

function roadSurfaceY(distance01: number, acrossPosition: number) {
  const bank = Math.sin(distance01 * Math.PI * 8 + 0.45) * 0.028;
  const crown = (1 - Math.min(1, Math.abs(acrossPosition) * 2)) * 0.04;
  const edgeDrop = Math.pow(Math.abs(acrossPosition) * 2, 1.7) * 0.035;
  const longWave = Math.sin(distance01 * Math.PI * 34 + acrossPosition * 3.2) * 0.008;
  const fineBreakup = Math.sin(distance01 * Math.PI * 137 + acrossPosition * 19) * 0.0035;
  return roadBaseY + crown - edgeDrop + bank * acrossPosition + longWave + fineBreakup;
}

function roadSurfaceYAt(
  distances: ReturnType<typeof buildRoadDistances>,
  sampleIndex: number,
  lateralOffset: number,
  roadWidth: number,
  lift = 0,
) {
  const distance01 = distances.cumulativeDistances[sampleIndex] / Math.max(distances.totalDistance, 1);
  return roadSurfaceY(distance01, lateralOffset / roadWidth) + lift;
}

function prepGroundOverlayMaterial(material: MeshStandardMaterial) {
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4;
  material.polygonOffsetUnits = -4;
  return material;
}

function prepGroundOverlay<T extends Object3D>(object: T, renderOrder = 8) {
  object.renderOrder = renderOrder;
  return object;
}

function groundDecalGeometry(width: number, depth: number) {
  const geometry = new PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function applyGroundUvs(geometry: BufferGeometry, scale = asphaltTextureMeters) {
  const position = geometry.attributes.position;
  const uvs: number[] = [];
  for (let i = 0; i < position.count; i++) {
    uvs.push(position.getX(i) / scale, position.getZ(i) / scale);
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

function createGroundDecal(width: number, depth: number, material: MeshStandardMaterial, renderOrder = 8) {
  return prepGroundOverlay(new Mesh(groundDecalGeometry(width, depth), material), renderOrder);
}

async function createMapEditOverlays(edits: MapEditStamp[]) {
  const group = new Group();
  if (!edits.length) return group;

  for (const stamp of edits) {
    group.add(createMapEditStampObject(stamp));
  }

  return group;
}

export async function createTrackView(scene: Scene | null, track: TrackConfig): Promise<TrackViewResult> {
  const indoor = isIndoorDriftVenue(track);
  if (scene) configureTrackMood(scene, indoor);
  const root = new Group();
  const imported = await loadGltf(track.model);
  if (imported) {
    root.add(imported);
    if (scene) scene.add(root);
    const colliders = collectAuthoredColliders(root, track.id);
    const { meshes: coneMeshes, cones } = collectDynamicCones(root);
    return {
      root,
      coneMeshes,
      cornerMarkers: [],
      collisionWorld: createCollisionWorld(colliders),
      cones,
      dispose: () => disposeObject3D(root),
    };
  }

  const bounds = getTrackBounds(track);
  const groundGeometry = new PlaneGeometry(bounds.width, bounds.depth);
  groundGeometry.setAttribute("uv2", groundGeometry.attributes.uv.clone());
  const ground = new Mesh(
    groundGeometry,
    indoor
      ? createConcreteMaterial({ x: Math.max(12, bounds.width / 26), y: Math.max(12, bounds.depth / 26) })
      : createGrassMaterial({
          x: Math.max(18, bounds.width / 18),
          y: Math.max(18, bounds.depth / 18),
        }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(bounds.centerX, -0.02, bounds.centerZ);
  ground.receiveShadow = true;
  const arena = indoor ? buildArenaShell(bounds) : undefined;
  // Indoor: the floor belongs to the shell so the environment bake captures floor bounce.
  if (arena) {
    arena.group.add(ground);
    root.add(arena.group);
  } else {
    root.add(ground);
    root.add(createTrackBackdrop(track));
  }

  if (track.roadPath && track.roadPath.length >= 4) {
    const { group, coneMeshes, cornerMarkers, windUniforms } = await createRoadFromPath(track, indoor);
    optimizeTrackShadows(group);
    root.add(group);
    if (scene) scene.add(root);
    const colliders = collectAuthoredColliders(root, track.id);
    const { meshes: dynamicConeMeshes, cones: dynamicCones } = collectDynamicCones(root);
    const allConeMeshes = [...coneMeshes, ...dynamicConeMeshes];
    return {
      root,
      coneMeshes: allConeMeshes,
      cornerMarkers,
      arena,
      windUniforms,
      collisionWorld: createCollisionWorld(colliders),
      cones: dynamicCones,
      dispose: () => disposeObject3D(root),
    };
  } else {
    root.add(createRingRoad(track));
    if (scene) scene.add(root);
    const colliders = collectAuthoredColliders(root, track.id);
    return {
      root,
      coneMeshes: [],
      cornerMarkers: [],
      arena,
      collisionWorld: createCollisionWorld(colliders),
      cones: [],
      dispose: () => disposeObject3D(root),
    };
  }

}

function optimizeTrackShadows(root: Object3D) {
  root.traverse((child) => {
    if (child instanceof Mesh) child.castShadow = false;
  });
}

async function createRoadFromPath(track: TrackConfig, indoor = false) {
  const group = new Group();
  const points = track.roadPath!.map((point) => new Vector3(point.x, 0, point.z));
  const curve = new CatmullRomCurve3(points, true, "chordal", 0.48);
  const samples = curve.getPoints(320);
  if (samples.length > 1 && samples[0].distanceToSquared(samples[samples.length - 1]) < 0.0001) {
    samples.pop();
  }
  const roadWidth = getRoadWidth(track);
  const mapEdits = await loadMapEdits(track.id).catch(() => []);
  const dressing = createDressingPlacement(track, samples, roadWidth, mapEdits);
  const roadMaterial = indoor ? createIndoorAsphaltMaterial({ x: 1, y: 1 }) : createAsphaltMaterial({ x: 1, y: 1 });
  roadMaterial.side = DoubleSide;
  const road = new Mesh(createRoadGeometry(samples, roadWidth), roadMaterial);
  road.receiveShadow = true;
  group.add(road);
  if (indoor) group.add(createIndoorTrackEdges(samples, roadWidth));

  const cornerMarkers = createCornerPoles(track, roadWidth, dressing);
  group.add(cornerMarkers.group);
  const windUniforms: { value: number }[] = [];
  if (!indoor) {
    group.add(createShoulderBlend(track, samples, roadWidth, dressing));
    const tufts = createGrassTufts(samples, roadWidth, dressing);
    if (tufts.userData.windUniform) windUniforms.push(tufts.userData.windUniform);
    group.add(tufts);
    group.add(createFoliage(samples, roadWidth, dressing));
    group.add(createRunoffPatches(track, samples, roadWidth, dressing));
  }
  group.add(createRoadWearDecals(samples, roadWidth, indoor));
  group.add(createPaintedLines(samples, roadWidth, indoor));
  group.add(createPracticeAreas(track, samples, roadWidth, indoor));
  group.add(createPracticeGarage(track));
  group.add(createOnlineLobbyDressing(track));
  group.add(createCurbs(track, samples, roadWidth, dressing, indoor));
  const trackside = createTracksideDepth(track, samples, roadWidth, dressing);
  group.add(trackside.group);
  group.add(createTrackLandmarks(samples, roadWidth, dressing));
  group.add(createTrainingCircuitDressing(track, samples, roadWidth, dressing));
  if (indoor) group.add(createIndoorPaddock(track));
  else group.add(createCircuitFacilities(track, samples, roadWidth));
  group.add(await createMapEditOverlays(mapEdits));
  return { group, coneMeshes: trackside.coneMeshes, cornerMarkers: cornerMarkers.markers, windUniforms };
}

function createPracticeAreaSurface(
  area: NonNullable<TrackConfig["practiceAreas"]>[number],
  _samples: Vector3[],
  _roadWidth: number,
  material: MeshStandardMaterial,
) {
  const heading = area.type === "rect" ? area.heading ?? 0 : 0;
  const width = area.type === "circle" ? area.radius * 2 : area.width;
  const depth = area.type === "circle" ? area.radius * 2 : area.depth;

  const geometry = area.type === "circle"
    ? new CircleGeometry(area.radius, 96)
    : new PlaneGeometry(width, depth, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  applyGroundUvs(geometry);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.position.set(area.x, -0.012, area.z);
  mesh.rotation.y = heading;
  return mesh;
}

function createPracticeGarage(track: TrackConfig) {
  const group = new Group();
  if (track.id !== "practice-grounds") return group;

  const position = track.start;
  const width = 38;
  const depth = 44;
  const height = 12;
  const concrete = createConcreteMaterial({ x: 5, y: 3 });
  const rubber = createRubberMaterial({ x: 3, y: 2 }, 0.34);
  const wall = new MeshStandardMaterial({ color: 0x222a33, roughness: 0.72, metalness: 0.1, envMapIntensity: 0.25 });
  const wallTrim = new MeshStandardMaterial({ color: 0x2f3942, roughness: 0.6, metalness: 0.15, envMapIntensity: 0.3 });
  const roof = new MeshStandardMaterial({ color: 0x111820, roughness: 0.62, metalness: 0.36, envMapIntensity: 0.38 });
  const frame = new MeshStandardMaterial({ color: 0x273541, roughness: 0.42, metalness: 0.68, envMapIntensity: 0.46 });
  const accent = new MeshStandardMaterial({ color: 0xd0a63e, emissive: 0x3b2300, emissiveIntensity: 0.7, roughness: 0.42, metalness: 0.28 });
  const fixture = new MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xaed9ff, emissiveIntensity: 3.2, roughness: 0.25 });
  const cabinet = new MeshStandardMaterial({ color: 0x2a3338, roughness: 0.55, metalness: 0.25, envMapIntensity: 0.3 });
  const cabinetTop = new MeshStandardMaterial({ color: 0x1a2024, roughness: 0.4, metalness: 0.3, envMapIntensity: 0.35 });
  const screenEmissive = new MeshStandardMaterial({ color: 0x0a1015, emissive: 0x4488cc, emissiveIntensity: 0.8, roughness: 0.3 });
  const tireMat = new MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.88, metalness: 0 });
  const yellowPaint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xe6b840, 0.7));
  const whitePaint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xf7f0df, 0.7));
  const oilStain = prepGroundOverlayMaterial(createProceduralStainMaterial(0x0a0a0a, 0.32));

  group.position.set(position.x, 0, position.z);
  group.rotation.y = position.heading;
  const floor = new Mesh(new PlaneGeometry(width, depth), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const servicePad = new Mesh(new PlaneGeometry(9, 8), rubber);
  servicePad.rotation.x = -Math.PI / 2;
  servicePad.position.y = 0.018;
  servicePad.receiveShadow = true;
  group.add(servicePad);

  // Painted floor markings: parking bay outline + safety yellow lines around service pad
  const bayOutline = createGroundDecal(8, 16, whitePaint, 10);
  bayOutline.position.set(0, 0.022, 2);
  group.add(bayOutline);
  for (const side of [-1, 1]) {
    const yellowLine = createGroundDecal(0.3, 8.5, yellowPaint, 10);
    yellowLine.position.set(side * 4.8, 0.022, -2);
    group.add(yellowLine);
  }
  // Oil stain near service pad
  const stain = createGroundDecal(5, 3, oilStain, 9);
  stain.position.set(2, 0.02, -5);
  group.add(stain);

  // Back wall
  const backWall = new Mesh(new BoxGeometry(width, height, 0.42), wall);
  backWall.position.set(0, height / 2, -depth / 2);
  backWall.receiveShadow = true;
  markBoxCollider(backWall, { profile: "wall", cameraObstruction: true });
  group.add(backWall);
  // Wall trim band
  const trimBand = new Mesh(new BoxGeometry(width, 0.6, 0.44), wallTrim);
  trimBand.position.set(0, 1.2, -depth / 2 + 0.02);
  group.add(trimBand);

  // Side walls
  for (const x of [-width / 2, width / 2]) {
    const sideWall = new Mesh(new BoxGeometry(0.42, height, depth), wall);
    sideWall.position.set(x, height / 2, 0);
    sideWall.receiveShadow = true;
    markBoxCollider(sideWall, { profile: "wall", cameraObstruction: true });
    group.add(sideWall);
  }
  const roofMesh = new Mesh(new BoxGeometry(width + 0.8, 0.48, depth + 0.8), roof);
  roofMesh.position.y = height;
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);
  for (const z of [-depth / 2 + 3, -11, 0, 11, depth / 2 - 3]) {
    const crossbeam = new Mesh(new BoxGeometry(width, 0.34, 0.34), frame);
    crossbeam.position.set(0, height - 0.9, z);
    group.add(crossbeam);
    for (const x of [-width / 2 + 0.8, width / 2 - 0.8]) {
      const post = new Mesh(new BoxGeometry(0.5, height, 0.5), frame);
      post.position.set(x, height / 2, z);
      post.castShadow = true;
      markBoxCollider(post, { profile: "post" });
      group.add(post);
    }
  }
  for (const x of [-11, 0, 11]) {
    const lightStrip = new Mesh(new BoxGeometry(5.4, 0.12, 0.5), fixture);
    lightStrip.position.set(x, height - 1.1, -3);
    group.add(lightStrip);
  }
  const fascia = new Mesh(new BoxGeometry(width + 0.7, 0.7, 0.25), accent);
  fascia.position.set(0, height - 0.7, depth / 2);
  group.add(fascia);

  // Workbenches along back wall
  for (const x of [-12, 0, 12]) {
    const bench = new Mesh(new BoxGeometry(8, 1.0, 2.2), cabinet);
    bench.position.set(x, 0.5, -depth / 2 + 1.5);
    bench.castShadow = true;
    bench.receiveShadow = true;
    markBoxCollider(bench, { profile: "concrete" });
    group.add(bench);
    const benchTop = new Mesh(new BoxGeometry(8.2, 0.08, 2.4), cabinetTop);
    benchTop.position.set(x, 1.04, -depth / 2 + 1.5);
    benchTop.castShadow = true;
    group.add(benchTop);
    // Screen on wall above bench
    const screen = new Mesh(new BoxGeometry(3, 1.6, 0.08), screenEmissive);
    screen.position.set(x, 3.5, -depth / 2 + 0.05);
    group.add(screen);
  }

  // Tire stacks in corners
  for (const corner of [
    { x: -width / 2 + 3, z: -depth / 2 + 4 },
    { x: width / 2 - 3, z: -depth / 2 + 4 },
  ]) {
    const stackGroup = new Group();
    stackGroup.position.set(corner.x, 0, corner.z);
    for (let i = 0; i < 4; i++) {
      const tire = new Mesh(new TorusGeometry(0.42, 0.18, 8, 20), tireMat);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(0, 0.18 + i * 0.36, 0);
      tire.castShadow = true;
      stackGroup.add(tire);
    }
    markCircleCollider(stackGroup, { profile: "soft-barrier", padding: 0.2 });
    group.add(stackGroup);
  }

  // Front apron ramp
  const apron = new Mesh(new PlaneGeometry(width, 6), concrete);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.01, depth / 2 + 3);
  apron.receiveShadow = true;
  group.add(apron);

  return group;
}

function createPracticeAreas(track: TrackConfig, samples: Vector3[], roadWidth: number, indoor = false) {
  const group = new Group();
  if (!track.practiceAreas) return group;

  const asphaltMaterial = indoor ? createIndoorAsphaltMaterial({ x: 1, y: 1 }) : createAsphaltMaterial({ x: 1, y: 1 });
  const paintMaterial = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xd8d2bf, 0.68));
  const rubberMaterial = prepGroundOverlayMaterial(createRubberMaterial({ x: 3, y: 2 }, 0.34));
  const coneMaterial = new MeshStandardMaterial({ color: 0xe68a2e, roughness: 0.72 });

  for (const area of track.practiceAreas) {
    const heading = area.type === "rect" ? area.heading ?? 0 : 0;
    const paintY = 0.004;
    const rubberY = 0.006;
    const pad = createPracticeAreaSurface(area, samples, roadWidth, asphaltMaterial);
    pad.receiveShadow = true;
    group.add(pad);

    if (area.type === "circle") {
      for (const radius of [area.radius * 0.48, area.radius * 0.82]) {
        const ring = new Mesh(new RingGeometry(radius - 0.18, radius + 0.18, 96), paintMaterial);
        ring.position.set(area.x, paintY, area.z);
        ring.rotation.x = -Math.PI / 2;
        group.add(prepGroundOverlay(ring));
      }
    } else {
      const outline = [
        { x: 0, z: area.depth / 2 },
        { x: 0, z: -area.depth / 2 },
      ];
      for (const edge of outline) {
        const line = createGroundDecal(area.width, 0.22, paintMaterial);
        line.position.set(area.x, paintY, area.z);
        line.rotation.y = heading;
        line.translateZ(edge.z);
        group.add(line);
      }
      for (let i = -2; i <= 2; i++) {
        const mark = createGroundDecal(5.5, 2.2, rubberMaterial);
        mark.position.set(area.x, rubberY, area.z);
        mark.rotation.y = heading + i * 0.08;
        mark.translateX(i * 8.5);
        group.add(mark);
      }
    }
  }

  const gymkhana = track.practiceZones?.find((zone) => zone.id === "gymkhana");
  if (gymkhana) {
    let coneIdx = 0;
    for (let row = -2; row <= 2; row++) {
      for (let col = -3; col <= 3; col++) {
        if ((row + col) % 2 !== 0) continue;
        const cone = new Mesh(new CylinderGeometry(0.14, 0.36, 0.78, 12), coneMaterial);
        cone.position.set(gymkhana.x + col * 9, 0.39, gymkhana.z + row * 8);
        cone.castShadow = true;
        markDynamicCone(cone, `gymkhana-${coneIdx++}`, 0.36);
        group.add(cone);
      }
    }
  }

  return group;
}

function createOnlineLobbyDressing(track: TrackConfig) {
  const group = new Group();
  if (track.id !== "online-lobby") return group;

  const paint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0x9fdfff, 0.46));
  const goldPaint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xf1c75b, 0.5));
  const concrete = createConcreteMaterial({ x: 4, y: 2 });
  const rubber = prepGroundOverlayMaterial(createRubberMaterial({ x: 2, y: 1 }, 0.32));
  const metal = new MeshStandardMaterial({ color: 0x111923, roughness: 0.46, metalness: 0.52 });
  const light = new MeshStandardMaterial({
    color: 0xf7f0df,
    emissive: 0xf1c75b,
    emissiveIntensity: 1.15,
    roughness: 0.32,
  });

  for (let i = -3; i <= 3; i++) {
    const stripe = createGroundDecal(2.4, 112, i === 0 ? goldPaint : paint, 9);
    stripe.position.set(i * 18, 0.096, -2);
    stripe.receiveShadow = true;
    group.add(stripe);
  }

  for (let i = -4; i <= 4; i++) {
    const stain = createGroundDecal(22, 1.4, rubber, 9);
    stain.position.set(i * 20, 0.102, -48 + (i % 2) * 11);
    stain.rotation.y = 0.08 + i * 0.015;
    group.add(stain);
  }

  const islands = [
    { x: -126, z: -78, w: 30, d: 9, r: 0.12 },
    { x: 124, z: 82, w: 34, d: 9, r: -0.18 },
    { x: -6, z: 106, w: 62, d: 8, r: 0 },
  ];
  for (const island of islands) {
    const curb = new Mesh(new BoxGeometry(island.w, 0.28, island.d), concrete);
    curb.position.set(island.x, 0.14, island.z);
    curb.rotation.y = island.r;
    curb.castShadow = true;
    curb.receiveShadow = true;
    markBoxCollider(curb, { profile: "concrete" });
    group.add(curb);
  }

  const lightPositions = [
    [-118, 86],
    [118, 86],
    [-132, -86],
    [132, -86],
  ];
  for (const [x, z] of lightPositions) {
    const pole = new Mesh(new CylinderGeometry(0.16, 0.22, 8.4, 10), metal);
    pole.position.set(x, 4.2, z);
    pole.castShadow = true;
    markCircleCollider(pole, { profile: "post" });
    group.add(pole);

    const arm = new Mesh(new BoxGeometry(3.6, 0.16, 0.18), metal);
    arm.position.set(x + (x < 0 ? 1.5 : -1.5), 8.05, z);
    arm.castShadow = true;
    group.add(arm);

    const lamp = new Mesh(new BoxGeometry(1.4, 0.16, 0.55), light);
    lamp.position.set(x + (x < 0 ? 3 : -3), 7.86, z);
    group.add(lamp);
  }

  return group;
}

function createIndoorTrackEdges(samples: Vector3[], roadWidth: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const { cumulativeDistances, totalDistance } = buildRoadDistances(samples);
  const profile = [roadWidth / 2 + 0.02, roadWidth / 2 + 0.62, roadWidth / 2 + 2.45];

  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex === 0 ? -1 : 1;
    for (let i = 0; i < samples.length; i++) {
      const previous = samples[(i - 1 + samples.length) % samples.length];
      const next = samples[(i + 1) % samples.length];
      const tangent = next.clone().sub(previous).normalize();
      const normal = new Vector3(-tangent.z, 0, tangent.x);
      const distance01 = cumulativeDistances[i] / Math.max(totalDistance, 1);
      const gutterBreakup =
        Math.sin(distance01 * Math.PI * 46 + sideIndex * 1.7) * 0.0035
        + Math.sin(distance01 * Math.PI * 132 + sideIndex * 0.9) * 0.0015;
      for (let profileIndex = 0; profileIndex < profile.length; profileIndex++) {
        const point = samples[i].clone().addScaledVector(normal, side * profile[profileIndex]);
        const y = profileIndex === 0
          ? roadSurfaceY(distance01, side * 0.5) + 0.014
          : roadBaseY - (profileIndex === 1 ? 0.028 : 0.052) + gutterBreakup * (profileIndex === 1 ? 1 : 0.65);
        positions.push(point.x, y, point.z);
        uvs.push(profile[profileIndex] / asphaltTextureMeters, cumulativeDistances[i] / asphaltTextureMeters);
      }
    }
  }

  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const sideBase = sideIndex * samples.length * profile.length;
    for (let i = 0; i < samples.length; i++) {
      const next = (i + 1) % samples.length;
      for (let profileIndex = 0; profileIndex < profile.length - 1; profileIndex++) {
        const a = sideBase + i * profile.length + profileIndex;
        const b = a + 1;
        const c = sideBase + next * profile.length + profileIndex;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = createIndoorTrackEdgeMaterial({ x: 1, y: 1 });
  material.side = DoubleSide;
  const edges = new Mesh(geometry, material);
  edges.receiveShadow = true;
  return edges;
}

function createRoadGeometry(samples: Vector3[], roadWidth: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const { cumulativeDistances, totalDistance } = buildRoadDistances(samples);
  const across = [-0.5, -0.42, -0.34, -0.25, -0.16, -0.08, 0, 0.08, 0.16, 0.25, 0.34, 0.42, 0.5];

  for (let i = 0; i < samples.length; i++) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const distance01 = cumulativeDistances[i] / Math.max(totalDistance, 1);

    for (const acrossPosition of across) {
      const point = samples[i].clone().addScaledVector(normal, acrossPosition * roadWidth);
      positions.push(point.x, roadSurfaceY(distance01, acrossPosition), point.z);
      uvs.push((acrossPosition * roadWidth) / asphaltTextureMeters, cumulativeDistances[i] / asphaltTextureMeters);
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
  const padding = isIndoorDriftVenue(track)
    ? Math.max(48, track.roadWidth + track.boundaryMargin * 0.86)
    : Math.max(85, track.roadWidth * 5 + track.boundaryMargin);
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

function configureTrackMood(scene: Scene, indoor: boolean) {
  type OutdoorMood = {
    background: Scene["background"];
    fog: Scene["fog"];
    environment: Scene["environment"];
    environmentIntensity: number;
  };
  const stored = scene.userData.outdoorMood as OutdoorMood | undefined;

  if (!stored) {
    scene.userData.outdoorMood = {
      background: scene.background,
      fog: scene.fog,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
    } satisfies OutdoorMood;
  }

  const outdoor = scene.userData.outdoorMood as OutdoorMood;
  const outdoorLights = scene.userData.outdoorLights as Record<string, Light> | undefined;
  scene.userData.indoorVenue = indoor;
  if (indoor) {
    // Enclosed arena: no sun, no sky. Every photon comes from the ArenaLightRig.
    scene.background = new Color(arenaPalette.background);
    scene.fog = new FogExp2(arenaPalette.fogColor, arenaPalette.fogDensity);
    scene.environment = null;
    scene.environmentIntensity = arenaPalette.environmentIntensity;
    if (outdoorLights) for (const light of Object.values(outdoorLights)) light.visible = false;
    return;
  }

  scene.background = outdoor.background;
  scene.fog = outdoor.fog;
  scene.environment = outdoor.environment;
  scene.environmentIntensity = outdoor.environmentIntensity;
  if (outdoorLights) for (const light of Object.values(outdoorLights)) light.visible = true;
}

function createIndoorPaddock(track: TrackConfig) {
  const group = new Group();
  const pit = track.practiceAreas?.find((area) => area.type === "rect");
  if (!pit || pit.type !== "rect") return group;

  const angle = pit.heading ?? 0;
  const tangent = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
  const normal = new Vector3(Math.sin(angle), 0, Math.cos(angle));
  const depth = 12.2;
  const width = Math.min(96, pit.width - 18);
  const center = new Vector3(pit.x, 0, pit.z).addScaledVector(normal, -(pit.depth / 2 - depth / 2 - 1.2));
  const steel = new MeshStandardMaterial({ color: 0x252d31, roughness: 0.55, metalness: 0.42 });
  const wall = new MeshStandardMaterial({ color: 0x4b5254, roughness: 0.84, metalness: 0.08 });
  const door = new MeshStandardMaterial({ color: 0x171d20, roughness: 0.68, metalness: 0.24 });
  const accent = new MeshStandardMaterial({ color: 0xd6a63d, emissive: 0x392104, roughness: 0.46 });

  const backWall = new Mesh(new BoxGeometry(width, 6.8, 0.5), wall);
  backWall.position.copy(center).addScaledVector(normal, -depth / 2);
  backWall.position.y = 3.4;
  backWall.rotation.y = angle;
  markBoxCollider(backWall, { profile: "wall", cameraObstruction: true });
  const roof = new Mesh(new BoxGeometry(width, 0.36, depth), steel);
  roof.position.copy(center);
  roof.position.y = 6.9;
  roof.rotation.y = angle;
  group.add(backWall, roof);

  const bayWidth = width / 9;
  for (let i = -4; i <= 4; i++) {
    const bayCenter = center.clone().addScaledVector(tangent, i * bayWidth);
    const bayDoor = new Mesh(new BoxGeometry(bayWidth - 0.8, 4.5, 0.22), door);
    bayDoor.position.copy(bayCenter).addScaledVector(normal, depth / 2 - 0.12);
    bayDoor.position.y = 2.45;
    bayDoor.rotation.y = angle;
    markBoxCollider(bayDoor, { profile: "wall" });
    const header = new Mesh(new BoxGeometry(bayWidth - 0.45, 0.3, 0.34), accent);
    header.position.copy(bayDoor.position);
    header.position.y = 5.35;
    header.rotation.y = angle;
    group.add(bayDoor, header);

    if (i < 4) {
      const column = new Mesh(new BoxGeometry(0.32, 6.7, 0.42), steel);
      column.position.copy(center).addScaledVector(tangent, (i + 0.5) * bayWidth).addScaledVector(normal, depth / 2);
      column.position.y = 3.35;
      column.rotation.y = angle;
      markBoxCollider(column, { profile: "post" });
      group.add(column);
    }
  }

  const fascia = createIndoorVenueSign("DRIFT ATTACK  //  PIT LANE", 0xb74a36);
  fascia.scale.set(1.8, 0.72, 1);
  fascia.position.copy(center).addScaledVector(normal, depth / 2 + 0.16);
  fascia.position.y = 6.05;
  fascia.rotation.y = angle;
  group.add(fascia, createIndoorStartGantry(track));
  return group;
}

function createIndoorStartGantry(track: TrackConfig) {
  const group = new Group();
  if (!track.roadPath || track.roadPath.length < 2) return group;
  const tangent = new Vector3(
    track.roadPath[1].x - track.roadPath[0].x,
    0,
    track.roadPath[1].z - track.roadPath[0].z,
  ).normalize();
  const start = new Vector3(track.start.x, 0, track.start.z).addScaledVector(tangent, 13);
  const normal = new Vector3(-tangent.z, 0, tangent.x);
  const angle = yawForTangentX(tangent);
  const steel = new MeshStandardMaterial({ color: 0x171e22, roughness: 0.5, metalness: 0.42 });

  for (const side of [-1, 1]) {
    const post = new Mesh(new BoxGeometry(0.42, 6.8, 0.42), steel);
    post.position.copy(start).addScaledVector(normal, side * (track.roadWidth / 2 + 1.55));
    post.position.y = 3.4;
    post.rotation.y = angle;
    markBoxCollider(post, { profile: "post" });
    group.add(post);
  }

  const beam = new Mesh(new BoxGeometry(track.roadWidth + 4.2, 0.5, 0.48), steel);
  beam.position.copy(start);
  beam.position.y = 6.55;
  beam.rotation.y = angle + Math.PI / 2;
  const panel = new Mesh(new BoxGeometry(5.2, 0.62, 0.2), steel);
  panel.position.copy(start);
  panel.position.y = 6.08;
  panel.rotation.y = angle + Math.PI / 2;
  group.add(beam, panel);
  return group;
}

function createTrackBackdrop(track: TrackConfig) {
  const group = new Group();
  const bounds = getTrackBounds(track);
  const distantTreeMaterial = new MeshStandardMaterial({ color: 0x355247, roughness: 1 });
  const farTreeMaterial = new MeshStandardMaterial({ color: 0x4c6650, roughness: 1 });

  // A restrained far treeline defines the world edge without adding collision or visual noise near the road.
  const treeCount = Math.min(148, Math.max(56, Math.ceil((bounds.width + bounds.depth) / 20)));
  const primaryTrees = new InstancedMesh(new ConeGeometry(1.1, 4.8, 7), distantTreeMaterial, treeCount);
  const secondaryTrees = new InstancedMesh(new ConeGeometry(0.82, 3.5, 7), farTreeMaterial, treeCount);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const treeColor = new Color();
  const inset = Math.max(14, Math.min(38, Math.min(bounds.width, bounds.depth) * 0.08));
  const perimeter = (bounds.width + bounds.depth) * 2;

  for (let i = 0; i < treeCount; i++) {
    const distance = (i / treeCount) * perimeter;
    let x = bounds.centerX;
    let z = bounds.centerZ;
    if (distance < bounds.width) {
      x += -bounds.width / 2 + distance;
      z += -bounds.depth / 2 + inset;
    } else if (distance < bounds.width + bounds.depth) {
      x += bounds.width / 2 - inset;
      z += -bounds.depth / 2 + (distance - bounds.width);
    } else if (distance < bounds.width * 2 + bounds.depth) {
      x += bounds.width / 2 - (distance - bounds.width - bounds.depth);
      z += bounds.depth / 2 - inset;
    } else {
      x += -bounds.width / 2 + inset;
      z += bounds.depth / 2 - (distance - bounds.width * 2 - bounds.depth);
    }

    const hash = Math.abs(Math.sin((i + 17) * 91.213) * 43758.5453) % 1;
    const scale = 0.82 + hash * 1.2;
    rotation.setFromAxisAngle(new Vector3(0, 1, 0), hash * Math.PI * 2);
    matrix.compose(new Vector3(x, 2.15 * scale, z), rotation, new Vector3(scale, scale, scale));
    primaryTrees.setMatrixAt(i, matrix);
    primaryTrees.setColorAt(i, treeColor.setHex(hash > 0.54 ? 0x2e4a42 : 0x38594b));

    matrix.compose(
      new Vector3(x + (hash - 0.5) * 4.6, 1.62 * scale, z + (0.5 - hash) * 3.8),
      rotation,
      new Vector3(scale * 0.8, scale * 0.82, scale * 0.8),
    );
    secondaryTrees.setMatrixAt(i, matrix);
    secondaryTrees.setColorAt(i, treeColor.setHex(hash > 0.46 ? 0x4a634e : 0x3f5948));
  }

  primaryTrees.instanceMatrix.needsUpdate = true;
  secondaryTrees.instanceMatrix.needsUpdate = true;
  primaryTrees.instanceColor!.needsUpdate = true;
  secondaryTrees.instanceColor!.needsUpdate = true;
  primaryTrees.computeBoundingSphere();
  secondaryTrees.computeBoundingSphere();
  primaryTrees.castShadow = false;
  secondaryTrees.castShadow = false;
  group.add(primaryTrees, secondaryTrees);
  return group;
}

function createRingRoad(track: TrackConfig) {
  const group = new Group();
  const roadMaterial = createAsphaltMaterial({ x: 3, y: 3 });
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

function createCornerPoles(track: TrackConfig, roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const markers: CornerMarker[] = [];
  if (!track.roadPath) return { group, markers };

  const baseMaterial = new MeshStandardMaterial({ color: 0x343a3e, roughness: 0.76, metalness: 0.16 });
  const material = new MeshStandardMaterial({ color: 0xe26628, emissive: 0x3e1004, roughness: 0.48 });
  const capMaterial = new MeshStandardMaterial({ color: 0xf3c04e, emissive: 0x4c2905, roughness: 0.42 });

  for (let i = 0; i < track.roadPath.length; i++) {
    const previous = track.roadPath[(i - 1 + track.roadPath.length) % track.roadPath.length];
    const current = track.roadPath[i];
    const next = track.roadPath[(i + 1) % track.roadPath.length];
    const tangent = new Vector3(next.x - previous.x, 0, next.z - previous.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);

    for (const side of [-1, 1]) {
      if (isTracksideClearZone({ x: current.x, z: current.z }, track)) continue;
      const x = current.x + normal.x * side * (roadWidth / 2 + 1.35);
      const z = current.z + normal.z * side * (roadWidth / 2 + 1.35);
      if (!dressing.allows({ x, z }, 0.45, 0.36)) continue;

      const anchor = new Group();
      anchor.position.set(x, 0, z);
      const base = new Mesh(new CylinderGeometry(0.2, 0.28, 0.1, 12), baseMaterial);
      base.position.y = 0.05;
      const pole = new Group();
      pole.position.y = 0.1;
      const shaft = new Mesh(new CylinderGeometry(0.105, 0.13, 2.34, 12), material);
      shaft.position.y = 1.17;
      const cap = new Mesh(new CylinderGeometry(0.14, 0.105, 0.16, 12), capMaterial);
      cap.position.y = 2.38;
      pole.add(shaft, cap);
      anchor.add(base, pole);
      markCircleCollider(anchor, { profile: "post", padding: 0.05 });
      group.add(anchor);
      markers.push({ anchor, pole, x, z, bendX: 0, bendZ: 0 });
    }
  }

  return { group, markers };
}

function createShoulderBlend(track: TrackConfig, samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
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

      const position = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 1.04));
      if (!dressing.allows(position, 0.18)) continue;
      const shoulder = new Mesh(new BoxGeometry(3.1, 0.016, 1.45), shoulderMaterial);
      shoulder.position.copy(position);
      shoulder.position.y = 0.042;
      shoulder.rotation.y = angle;
      shoulder.receiveShadow = true;
      group.add(shoulder);
    }
  }

  return group;
}

function isDressingClearZone(track: TrackConfig, point: { x: number; z: number }) {
  if (isTracksideClearZone(point, track)) return true;

  if (track.portals?.some((portal) => Math.hypot(point.x - portal.x, point.z - portal.z) < portal.radius + 14)) {
    return true;
  }

  return track.practiceAreas?.some((area) => {
    if (area.type === "circle") {
      return Math.hypot(point.x - area.x, point.z - area.z) < area.radius + 10;
    }

    const heading = area.heading ?? 0;
    const dx = point.x - area.x;
    const dz = point.z - area.z;
    const localX = dx * Math.cos(heading) + dz * Math.sin(heading);
    const localZ = -dx * Math.sin(heading) + dz * Math.cos(heading);
    return Math.abs(localX) < area.width / 2 + 10 && Math.abs(localZ) < area.depth / 2 + 10;
  }) ?? false;
}

function pointToSegmentDistanceSquared(point: { x: number; z: number }, start: Vector3, end: Vector3) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const segmentLengthSq = dx * dx + dz * dz;
  const t = segmentLengthSq > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / segmentLengthSq))
    : 0;
  const closestX = start.x + dx * t;
  const closestZ = start.z + dz * t;
  const distanceX = point.x - closestX;
  const distanceZ = point.z - closestZ;
  return distanceX * distanceX + distanceZ * distanceZ;
}

function createDressingPlacement(track: TrackConfig, samples: Vector3[], roadWidth: number, mapEdits: MapEditStamp[]): DressingPlacement {
  return {
    allows(point, roadClearance = 0.7, objectRadius = 0) {
      if (isDressingClearZone(track, point)) return false;
      if (mapEdits.some((stamp) => Math.hypot(point.x - stamp.x, point.z - stamp.z) < stamp.radius + objectRadius + 4)) {
        return false;
      }

      const minimumDistanceSq = Math.pow(roadWidth / 2 + roadClearance + objectRadius, 2);
      for (let i = 0; i < samples.length; i++) {
        const next = samples[(i + 1) % samples.length];
        if (pointToSegmentDistanceSquared(point, samples[i], next) < minimumDistanceSq) return false;
      }
      return true;
    },
  };
}

export function updateCornerMarkerFlex(markers: CornerMarker[], car: CarState, dt: number) {
  for (const marker of markers) {
    const dx = marker.x - car.position.x;
    const dz = marker.z - car.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 2.1) {
      const strength = (1 - distance / 2.1) * Math.min(1, 0.28 + car.speed * 0.05);
      const impulse = Math.min(1, dt * 18) * strength * 0.72;
      marker.bendX += (dx / Math.max(distance, 0.001)) * impulse;
      marker.bendZ += (dz / Math.max(distance, 0.001)) * impulse;
    }

    const rebound = Math.exp(-dt * 8.5);
    marker.bendX *= rebound;
    marker.bendZ *= rebound;
    marker.pole.rotation.z = -marker.bendX;
    marker.pole.rotation.x = marker.bendZ;
  }
}

function createGrassClumpGeometry(rotationY = 0) {
  const positions: number[] = [];
  const blades = [
    { x: -0.18, width: 0.14, height: 0.62, lean: -0.09 },
    { x: 0.02, width: 0.16, height: 0.86, lean: 0.12 },
    { x: 0.2, width: 0.12, height: 0.58, lean: 0.18 },
  ];

  for (const blade of blades) {
    const left = blade.x - blade.width / 2;
    const right = blade.x + blade.width / 2;
    const top = blade.x + blade.lean;
    positions.push(left, 0, 0, right, 0, 0, top, blade.height, 0);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.rotateY(rotationY);
  return geometry;
}

function createGrassTufts(samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const materialA = new MeshStandardMaterial({
    color: 0x637b43,
    side: DoubleSide,
    roughness: 1,
  });
  const materialB = new MeshStandardMaterial({
    color: 0x78904d,
    side: DoubleSide,
    roughness: 1,
  });
  materialA.envMapIntensity = 0.008;
  materialB.envMapIntensity = 0.008;

  // Wind sway: offset blade tips based on time and instance position
  const windUniform = { value: 0 };
  for (const mat of [materialA, materialB]) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windUniform;
      shader.vertexShader = `
        uniform float uWindTime;
      ` + shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 wPos = (instanceMatrix * vec4(position, 1.0)).xyz;
          float windPhase = uWindTime * 1.8 + wPos.x * 0.12 + wPos.z * 0.09;
          float windStrength = max(0.0, position.y) * 0.06;
          transformed.x += sin(windPhase) * windStrength;
          transformed.z += cos(windPhase * 0.7) * windStrength * 0.6;
        }`,
      );
    };
    mat.customProgramCacheKey = () => "grass-wind";
  }

  const tuftCount = Math.min(220, samples.length);
  const tuftsA = new InstancedMesh(createGrassClumpGeometry(0), materialA, tuftCount);
  const tuftsB = new InstancedMesh(createGrassClumpGeometry(Math.PI * 0.44), materialB, tuftCount);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const color = new Color();
  let index = 0;

  for (let i = 0; i < samples.length && index < tuftCount; i += 2) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const jitter = Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 2.417) * 0.35;

    for (const side of [-1, 1]) {
      if (index >= tuftCount) break;
      const distance = roadWidth / 2 + 3.5 + ((i * 7) % 10) * 0.78;
      const position = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, jitter * 2.1);
      if (!dressing.allows(position, 0.9, 0.42)) continue;
      const scale = 0.68 + ((i * 13) % 9) * 0.06;
      rotation.setFromAxisAngle(up, (i * 0.81 + side * 0.7) % Math.PI);
      matrix.compose(
        new Vector3(position.x, 0.015, position.z),
        rotation,
        new Vector3(scale, scale, scale),
      );
      tuftsA.setMatrixAt(index, matrix);
      tuftsB.setMatrixAt(index, matrix);
      tuftsA.setColorAt(index, color.setHex((i + side) % 3 === 0 ? 0x526d39 : 0x678145));
      tuftsB.setColorAt(index, color.setHex((i + side) % 4 === 0 ? 0x809854 : 0x708a49));
      index += 1;
    }
  }

  for (const tufts of [tuftsA, tuftsB]) {
    tufts.count = index;
    tufts.instanceMatrix.needsUpdate = true;
    tufts.instanceColor!.needsUpdate = true;
    tufts.computeBoundingSphere();
    tufts.castShadow = false;
    tufts.receiveShadow = false;
  }
  group.add(tuftsA, tuftsB);
  group.userData.windUniform = windUniform;
  return group;
}

function createFoliage(samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const up = new Vector3(0, 1, 0);
  const matrix = new Matrix4();
  const rotation = new Quaternion();

  const trunkMaterial = new MeshStandardMaterial({ color: 0x493728, roughness: 0.96 });
  trunkMaterial.envMapIntensity = 0.02;
  const leafMaterialA = new MeshStandardMaterial({ color: 0x4a6d3c, roughness: 1 });
  leafMaterialA.envMapIntensity = 0.02;
  const leafMaterialB = new MeshStandardMaterial({ color: 0x607d45, roughness: 1 });
  leafMaterialB.envMapIntensity = 0.02;
  const pineMaterial = new MeshStandardMaterial({ color: 0x365946, roughness: 1 });
  pineMaterial.envMapIntensity = 0.02;
  const shrubMaterial = new MeshStandardMaterial({ color: 0x58773f, roughness: 1 });
  shrubMaterial.envMapIntensity = 0.02;

  const trunkGeometry = new CylinderGeometry(0.16, 0.3, 4.1, 7);
  const canopyGeometry = new IcosahedronGeometry(1, 1);
  const pineGeometry = new ConeGeometry(1.18, 4.6, 7);
  const shrubGeometry = new IcosahedronGeometry(0.78, 1);
  const broadleafCount = 34;
  const pineCount = 24;
  const shrubCount = 120;
  const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, broadleafCount + pineCount);
  const canopiesA = new InstancedMesh(canopyGeometry, leafMaterialA, broadleafCount);
  const canopiesB = new InstancedMesh(canopyGeometry, leafMaterialB, broadleafCount);
  const pines = new InstancedMesh(pineGeometry, pineMaterial, pineCount);
  const shrubs = new InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  const color = new Color();
  let trunkIndex = 0;
  let broadleafIndex = 0;
  let pineIndex = 0;
  let shrubIndex = 0;

  for (let i = 10; i < samples.length && (broadleafIndex < broadleafCount || pineIndex < pineCount || shrubIndex < shrubCount); i += 2) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const hash = Math.abs(Math.sin(i * 19.191) * 43758.5453) % 1;
    const side = i % 2 === 0 ? 1 : -1;
    const step = Math.floor((i - 10) / 2);

    if (step % 5 === 0 && broadleafIndex < broadleafCount) {
      const distance = roadWidth / 2 + 15 + hash * 25;
      const base = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, (hash - 0.5) * 7);
      if (!dressing.allows(base, 1.4, 2.2)) continue;
      const heightScale = 0.92 + hash * 0.65;
      const widthScale = 1.02 + ((i * 7) % 10) * 0.07;
      rotation.setFromAxisAngle(up, hash * Math.PI * 2);

      matrix.compose(new Vector3(base.x, 2.05 * heightScale, base.z), rotation, new Vector3(widthScale, heightScale, widthScale));
      trunks.setMatrixAt(trunkIndex, matrix);
      trunks.setColorAt(trunkIndex, color.setHex(hash > 0.5 ? 0x543b29 : 0x433025));
      trunkIndex += 1;

      matrix.compose(new Vector3(base.x, 4.45 * heightScale, base.z), rotation, new Vector3(1.7 * widthScale, 1.04 * heightScale, 1.4 * widthScale));
      canopiesA.setMatrixAt(broadleafIndex, matrix);
      canopiesA.setColorAt(broadleafIndex, color.setHex(hash > 0.56 ? 0x3d6539 : 0x50753f));

      matrix.compose(
        new Vector3(base.x + normal.x * side * 0.82, 5.25 * heightScale, base.z + normal.z * side * 0.82),
        rotation,
        new Vector3(1.24 * widthScale, 0.77 * heightScale, 1.1 * widthScale),
      );
      canopiesB.setMatrixAt(broadleafIndex, matrix);
      canopiesB.setColorAt(broadleafIndex, color.setHex(hash > 0.4 ? 0x657f45 : 0x56743e));
      broadleafIndex += 1;
    }

    if (step % 8 === 3 && pineIndex < pineCount) {
      const distance = roadWidth / 2 + 21 + hash * 32;
      const base = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, (hash - 0.5) * 10);
      if (!dressing.allows(base, 1.4, 1.6)) continue;
      const heightScale = 0.9 + hash * 0.8;
      rotation.setFromAxisAngle(up, hash * Math.PI * 2);
      matrix.compose(new Vector3(base.x, 2.18 * heightScale, base.z), rotation, new Vector3(0.72, heightScale, 0.72));
      trunks.setMatrixAt(trunkIndex, matrix);
      trunks.setColorAt(trunkIndex, color.setHex(0x3f3026));
      trunkIndex += 1;
      matrix.compose(new Vector3(base.x, 5.02 * heightScale, base.z), rotation, new Vector3(1.2 * heightScale, heightScale, 1.2 * heightScale));
      pines.setMatrixAt(pineIndex, matrix);
      pines.setColorAt(pineIndex, color.setHex(hash > 0.5 ? 0x305442 : 0x3a6249));
      pineIndex += 1;
    }

    if (shrubIndex < shrubCount) {
      const distance = roadWidth / 2 + 6.6 + hash * 18;
      const base = samples[i]
        .clone()
        .addScaledVector(normal, side * distance)
        .addScaledVector(tangent, (((i * 11) % 9) - 4) * 0.75);
      if (!dressing.allows(base, 1.15, 1.1)) continue;
      const scale = 0.76 + ((i * 13) % 9) * 0.08;
      rotation.setFromAxisAngle(up, (hash + i * 0.07) * Math.PI * 2);
      matrix.compose(new Vector3(base.x, 0.54 * scale, base.z), rotation, new Vector3(scale * 1.55, scale * 0.66, scale * 1.18));
      shrubs.setMatrixAt(shrubIndex, matrix);
      shrubs.setColorAt(shrubIndex, color.setHex(shrubIndex % 3 === 0 ? 0x4c6d3b : 0x5b7b40));
      shrubIndex += 1;
    }
  }

  trunks.count = trunkIndex;
  canopiesA.count = broadleafIndex;
  canopiesB.count = broadleafIndex;
  pines.count = pineIndex;
  shrubs.count = shrubIndex;
  for (const mesh of [trunks, canopiesA, canopiesB, pines, shrubs]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  group.add(trunks, canopiesA, canopiesB, pines, shrubs);
  return group;
}

function createTrackLandmarks(samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const markerCapacity = 9;
  const panelMaterial = new MeshStandardMaterial({ color: 0xd6a941, roughness: 0.62, metalness: 0.08 });
  const stripeMaterial = new MeshStandardMaterial({ color: 0x202932, roughness: 0.68, metalness: 0.08 });
  const postMaterial = new MeshStandardMaterial({ color: 0x41484a, roughness: 0.72, metalness: 0.22 });
  const panelGeometry = new BoxGeometry(3.8, 1.6, 0.16);
  const stripeGeometry = new BoxGeometry(1.38, 0.16, 0.2);
  const postGeometry = new BoxGeometry(0.14, 1.55, 0.16);
  const panels = new InstancedMesh(panelGeometry, panelMaterial, markerCapacity);
  const stripesA = new InstancedMesh(stripeGeometry, stripeMaterial, markerCapacity);
  const stripesB = new InstancedMesh(stripeGeometry, stripeMaterial, markerCapacity);
  const posts = new InstancedMesh(postGeometry, postMaterial, markerCapacity * 2);
  const marker = new Object3D();
  let markerIndex = 0;
  let postIndex = 0;
  let lastMarkerSample = -36;

  for (let i = 16; i < samples.length - 16 && markerIndex < markerCapacity; i += 5) {
    const previous = samples[(i - 10 + samples.length) % samples.length];
    const current = samples[i];
    const next = samples[(i + 10) % samples.length];
    const incoming = current.clone().sub(previous).normalize();
    const outgoing = next.clone().sub(current).normalize();
    const turnAmount = incoming.x * outgoing.z - incoming.z * outgoing.x;
    const severity = Math.abs(Math.asin(Math.max(-1, Math.min(1, turnAmount))));
    if (severity < 0.17 || i - lastMarkerSample < 32) continue;
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const outerSide = turnAmount > 0 ? -1 : 1;
    const base = current.clone().addScaledVector(normal, outerSide * (roadWidth / 2 + 8.5));
    if (!dressing.allows(base, 1.5, 2.1)) continue;
    const yaw = yawForTangentX(tangent);

    marker.position.set(base.x, 2.25, base.z);
    marker.rotation.set(0, yaw, 0);
    marker.scale.set(1, 1, 1);
    marker.updateMatrix();
    panels.setMatrixAt(markerIndex, marker.matrix);

    const chevronTilt = turnAmount > 0 ? -0.5 : 0.5;
    for (const [stripes, offset, tilt] of [
      [stripesA, -0.36, chevronTilt],
      [stripesB, 0.36, -chevronTilt],
    ] as const) {
      marker.position.set(base.x, 2.25 + offset, base.z - outerSide * 0.11 * normal.z);
      marker.rotation.set(0, yaw, tilt);
      marker.scale.set(1, 1, 1);
      marker.updateMatrix();
      stripes.setMatrixAt(markerIndex, marker.matrix);
    }

    for (const lateral of [-1.28, 1.28]) {
      marker.position.copy(base).addScaledVector(tangent, lateral);
      marker.position.y = 0.78;
      marker.rotation.set(0, yaw, 0);
      marker.scale.set(1, 1, 1);
      marker.updateMatrix();
      posts.setMatrixAt(postIndex, marker.matrix);
      postIndex += 1;
    }

    markerIndex += 1;
    lastMarkerSample = i;
  }

  for (const mesh of [panels, stripesA, stripesB, posts]) {
    mesh.count = mesh === posts ? postIndex : markerIndex;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  }
  group.add(panels, stripesA, stripesB, posts);
  return group;
}

function createPaintedLines(samples: Vector3[], roadWidth: number, indoor = false) {
  const group = new Group();
  const edgeMaterial = prepGroundOverlayMaterial(
    createRoadPaintMaterial({ x: 1.8, y: 1 }, indoor ? 0x8b908d : 0xcfc8b7, indoor ? 0.56 : 0.68),
  );
  const seamMaterial = prepGroundOverlayMaterial(createProceduralStainMaterial(indoor ? 0x0c1012 : 0x15191d, indoor ? 0.42 : 0.26));
  const distances = buildRoadDistances(samples);

  for (let i = 0; i < samples.length; i += 8) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      const lateral = side * (roadWidth / 2 - 0.68);
      const line = createGroundDecal(3.6, indoor ? 0.14 : 0.075, edgeMaterial, 10);
      line.position.copy(samples[i].clone().addScaledVector(normal, lateral));
      line.position.y = roadSurfaceYAt(distances, i, lateral, roadWidth, 0.068);
      line.rotation.y = angle;
      group.add(line);
    }

    if (i % 24 === 0) {
      const seam = createGroundDecal(2.8, 0.045, seamMaterial, 10);
      seam.position.copy(samples[i]);
      seam.position.y = roadSurfaceYAt(distances, i, 0, roadWidth, 0.07);
      seam.rotation.y = angle;
      group.add(seam);
    }
  }

  if (indoor) {
    const rumbleMaterial = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0x555b59, 0.44));
    const rumbleGeometry = groundDecalGeometry(0.72, 0.38);
    const rumble = new InstancedMesh(rumbleGeometry, rumbleMaterial, Math.ceil(samples.length / 2) * 2);
    const marker = new Object3D();
    let rumbleIndex = 0;

    for (let i = 0; i < samples.length; i += 2) {
      const previous = samples[(i - 1 + samples.length) % samples.length];
      const next = samples[(i + 1) % samples.length];
      const tangent = next.clone().sub(previous).normalize();
      const normal = new Vector3(-tangent.z, 0, tangent.x);
      const angle = yawForTangentX(tangent);

      for (const side of [-1, 1]) {
        const lateral = side * (roadWidth / 2 + 0.1);
        marker.position.copy(samples[i]).addScaledVector(normal, lateral);
        marker.position.y = roadSurfaceYAt(distances, i, side * roadWidth / 2, roadWidth, 0.028);
        marker.rotation.set(0, angle, 0);
        marker.scale.set(1, 1, 1);
        marker.updateMatrix();
        rumble.setMatrixAt(rumbleIndex, marker.matrix);
        rumbleIndex += 1;
      }
    }

    rumble.count = rumbleIndex;
    rumble.instanceMatrix.needsUpdate = true;
    rumble.computeBoundingSphere();
    group.add(prepGroundOverlay(rumble, 11));
  }

  return group;
}

function createRoadWearDecals(samples: Vector3[], roadWidth: number, indoor = false) {
  const group = new Group();
  const rubberMaterial = prepGroundOverlayMaterial(createRubberMaterial({ x: 2.8, y: 1.2 }, indoor ? 0.58 : 0.34));
  const stainMaterial = prepGroundOverlayMaterial(createProceduralStainMaterial(indoor ? 0x080a0b : 0x121517, indoor ? 0.42 : 0.22));
  const rubberGeometry = groundDecalGeometry(6.4, 3.2);
  const stainGeometry = groundDecalGeometry(3.8, 0.52);
  const sampleCount = Math.ceil(samples.length / 5);
  const rubberStride = indoor ? 2 : 12;
  const stainStride = indoor ? 1 : 2;
  const rubberCount = Math.ceil(sampleCount / rubberStride);
  const stainCount = Math.ceil(sampleCount / stainStride);
  const rubber = new InstancedMesh(rubberGeometry, rubberMaterial, rubberCount);
  const stains = new InstancedMesh(stainGeometry, stainMaterial, stainCount);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const distances = buildRoadDistances(samples);
  let rubberIndex = 0;
  let stainIndex = 0;

  for (let i = 0; i < samples.length; i += 5) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);
    const sampleIndex = i / 5;

    if (sampleIndex % rubberStride === 0 && rubberIndex < rubberCount) {
      const lateral = Math.sin(i * 0.29) * roadWidth * (indoor ? 0.22 : 0.14);
      const position = samples[i].clone().addScaledVector(normal, lateral);
      rotation.setFromAxisAngle(up, angle + ((((i * 11) % 100) / 100) - 0.5) * 0.18);
      matrix.compose(
        new Vector3(position.x, roadSurfaceYAt(distances, i, lateral, roadWidth, 0.078), position.z),
        rotation,
        new Vector3(
          (0.95 + ((i * 5) % 7) * 0.045) * (indoor ? 1.2 : 1),
          1,
          (0.78 + ((i * 3) % 5) * 0.06) * (indoor ? 1.12 : 1),
        ),
      );
      rubber.setMatrixAt(rubberIndex, matrix);
      rubberIndex += 1;
    }

    if (sampleIndex % stainStride === 0 && stainIndex < stainCount) {
      const lateral = ((((i * 19) % 100) / 100) - 0.5) * roadWidth * (indoor ? 0.82 : 0.72);
      const position = samples[i].clone().addScaledVector(normal, lateral);
      rotation.setFromAxisAngle(up, angle + Math.PI * 0.5 + ((((i * 23) % 100) / 100) - 0.5) * 0.34);
      matrix.compose(
        new Vector3(position.x, roadSurfaceYAt(distances, i, lateral, roadWidth, 0.08), position.z),
        rotation,
        new Vector3(0.78 + ((i * 7) % 5) * 0.08, 1, 1),
      );
      stains.setMatrixAt(stainIndex, matrix);
      stainIndex += 1;
    }
  }

  rubber.count = rubberIndex;
  stains.count = stainIndex;
  rubber.instanceMatrix.needsUpdate = true;
  stains.instanceMatrix.needsUpdate = true;
  group.add(prepGroundOverlay(rubber, 9), prepGroundOverlay(stains, 9));
  return group;
}

function createRunoffPatches(track: TrackConfig, samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
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
    const position = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 6.2));
    if (!dressing.allows(position, 0.8)) continue;
    const runoff = new Mesh(new BoxGeometry(18, 0.02, 8.5), gravelMaterial);
    runoff.position.copy(position);
    runoff.position.y = 0.005;
    runoff.rotation.y = angle;
    runoff.receiveShadow = true;
    group.add(runoff);
  }

  return group;
}

function createCurbs(
  track: TrackConfig,
  samples: Vector3[],
  roadWidth: number,
  dressing: DressingPlacement,
  indoor = false,
) {
  const group = new Group();
  const red = createRoadPaintMaterial({ x: 1, y: 1 }, indoor ? 0x6c3029 : 0xa33a32, 0.94);
  const white = createRoadPaintMaterial({ x: 1, y: 1 }, indoor ? 0x898984 : 0xd7d1bf, 0.94);
  if (indoor) {
    red.envMapIntensity = 0.12;
    white.envMapIntensity = 0.12;
  }
  const distances = buildRoadDistances(samples);

  for (let i = 0; i < samples.length; i += 10) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      const lateral = side * (roadWidth / 2 + 0.35);
      const position = samples[i].clone().addScaledVector(normal, lateral);
      if (!dressing.allows(position, 0.1)) continue;
      const curbHeight = indoor ? 0.14 : 0.1;
      const curb = new Mesh(new BoxGeometry(1.85, curbHeight, 0.72), (i / 10) % 2 === 0 ? red : white);
      curb.position.copy(position);
      curb.position.y = indoor
        ? roadSurfaceYAt(distances, i, lateral, roadWidth, curbHeight * 0.5 + 0.006)
        : 0.12;
      curb.rotation.y = angle;
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    }
  }

  return group;
}

function createTracksideDepth(track: TrackConfig, samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const coneMeshes: Mesh[] = [];
  const coneMaterial = new MeshStandardMaterial({ color: 0xe68a2e, roughness: 0.7 });
  const postMaterial = new MeshStandardMaterial({ color: 0xd8d2bd, roughness: 0.74 });

  let tracksideConeIdx = 0;
  for (let i = 6; i < samples.length; i += 24) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);

    for (const side of [-1, 1]) {
      const position = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 2.4));
      if (!dressing.allows(position, 1.0, 0.42)) continue;
      const cone = new Mesh(new CylinderGeometry(0.15, 0.38, 0.8, 12), coneMaterial);
      cone.position.copy(position);
      cone.position.y = 0.4;
      cone.castShadow = true;
      markDynamicCone(cone, `trackside-${tracksideConeIdx++}`, 0.38);
      group.add(cone);
      coneMeshes.push(cone);
    }
  }

  for (let i = 0; i < samples.length; i += 40) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const position = samples[i].clone().addScaledVector(normal, roadWidth / 2 + 6.5);
    if (!dressing.allows(position, 1.25, 0.3)) continue;
    const post = new Mesh(new CylinderGeometry(0.18, 0.18, 2.6, 10), postMaterial);
    post.position.copy(position);
    post.position.y = 1.3;
    post.castShadow = true;
    markCircleCollider(post, { profile: "post", padding: 0.05 });
    group.add(post);
  }

  return { group, coneMeshes };
}

function createGuardrailPanelGeometry(track: TrackConfig, samples: Vector3[], roadWidth: number, side: -1 | 1, dressing: DressingPlacement) {
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

    const startPrevious = samples[(i - 1 + samples.length) % samples.length];
    const startNext = samples[(i + 1) % samples.length];
    const startNormal = new Vector3(-(startNext.z - startPrevious.z), 0, startNext.x - startPrevious.x).normalize();
    const endPrevious = samples[(nextIndex - 1 + samples.length) % samples.length];
    const endNext = samples[(nextIndex + 1) % samples.length];
    const endNormal = new Vector3(-(endNext.z - endPrevious.z), 0, endNext.x - endPrevious.x).normalize();
    const startBase = samples[i].clone().addScaledVector(startNormal, side * railDistance);
    const endBase = samples[nextIndex].clone().addScaledVector(endNormal, side * railDistance);
    if (!dressing.allows(startBase, 0.9) || !dressing.allows(endBase, 0.9)) continue;

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
  dressing: DressingPlacement,
) {
  const group = new Group();
  const postGeometry = new BoxGeometry(0.18, 1.18, 0.24);
  const boltGeometry = new BoxGeometry(0.38, 0.08, 0.075);

  for (const side of [-1, 1] as const) {
    const rail = new Mesh(createGuardrailPanelGeometry(track, samples, roadWidth, side, dressing), railMaterial);
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
      if (!dressing.allows(postPosition, 0.9, 0.2)) continue;
      const post = new Mesh(postGeometry, postMaterial);
      post.position.copy(postPosition);
      post.position.y = 0.58;
      post.rotation.y = angle;
      post.castShadow = true;
      post.receiveShadow = true;
      markBoxCollider(post, { profile: "guardrail" });
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
  dressing: DressingPlacement,
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
      if (!dressing.allows(center, 1.0, 0.75)) continue;

      const base = new Mesh(baseGeometry, concreteMaterial);
      base.position.copy(center);
      base.position.y = 0.2;
      base.rotation.y = angle;
      base.castShadow = true;
      base.receiveShadow = true;
      markBoxCollider(base, { profile: "concrete" });
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

function createTireBarrierStacks(track: TrackConfig, samples: Vector3[], roadWidth: number, tireMaterial: MeshStandardMaterial, dressing: DressingPlacement) {
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
    if (!dressing.allows(base, 1.1, 1.25)) continue;
    const rotation = new Quaternion().setFromUnitVectors(defaultNormal, tangent);
    const stackGroup = new Group();
    stackGroup.position.copy(base);

    for (let column = -2; column <= 2; column++) {
      for (let row = 0; row < 2; row++) {
        const tire = new Mesh(tireGeometry, tireMaterial);
        tire.position.set(
          column * 0.52,
          0.44 + row * 0.52,
          side * (row * 0.05),
        );
        tire.quaternion.copy(rotation);
        tire.rotation.z += (column + row) * 0.11;
        tire.castShadow = true;
        tire.receiveShadow = true;
        stackGroup.add(tire);
      }
    }
    markCircleCollider(stackGroup, { profile: "soft-barrier", padding: 0.4 });
    group.add(stackGroup);
  }

  return group;
}

function createTrainingCircuitDressing(track: TrackConfig, samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
  const group = new Group();
  const railMaterial = new MeshStandardMaterial({ color: 0x858a8c, roughness: 0.5, metalness: 0.34 });
  railMaterial.side = DoubleSide;
  const postMaterial = new MeshStandardMaterial({ color: 0x343a3e, roughness: 0.72, metalness: 0.18 });
  const concreteMaterial = createConcreteMaterial({ x: 4, y: 1 });
  const signMaterial = new MeshStandardMaterial({ color: 0x242a2f, roughness: 0.72, metalness: 0.08 });
  const yellowMaterial = createRoadPaintMaterial({ x: 1, y: 1 }, 0xc7a33f, 0.86);
  const lightMaterial = new MeshStandardMaterial({ color: 0xf6edd2, emissive: 0xe5bf55, roughness: 0.35 });
  const tireMaterial = createRubberMaterial({ x: 1.5, y: 1.5 }, 1);

  group.add(createMetalGuardrails(track, samples, roadWidth, railMaterial, postMaterial, dressing));
  group.add(createJerseyBarrierRuns(track, samples, roadWidth, concreteMaterial, dressing));
  group.add(createTireBarrierStacks(track, samples, roadWidth, tireMaterial, dressing));

  for (let i = 14; i < samples.length; i += 44) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const localTangent = next.clone().sub(previous).normalize();
    const localNormal = new Vector3(-localTangent.z, 0, localTangent.x);
    const localAngle = yawForTangentX(localTangent);
    const side = i % 88 === 14 ? 1 : -1;
    const billboardPosition = samples[i].clone().addScaledVector(localNormal, side * (roadWidth / 2 + 8.4));
    if (!dressing.allows(billboardPosition, 1.25, 2.6)) continue;

    const billboard = new Mesh(new BoxGeometry(6.4, 1.55, 0.18), signMaterial);
    billboard.position.copy(billboardPosition);
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
    const polePosition = samples[i].clone().addScaledVector(localNormal, roadWidth / 2 + 10.5);
    if (!dressing.allows(polePosition, 1.35, 0.45)) continue;

    const pole = new Mesh(new CylinderGeometry(0.16, 0.2, 7.6, 12), postMaterial);
    pole.position.copy(polePosition);
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

  const wallMaterial = createConcreteMaterial({ x: 12, y: 1 });
  const glassMaterial = new MeshStandardMaterial({ color: 0x5e7e92, roughness: 0.24, metalness: 0.2 });
  const roofMaterial = new MeshStandardMaterial({ color: 0x1d252d, roughness: 0.72, metalness: 0.14 });
  const standMaterial = createConcreteMaterial({ x: 4, y: 2 });
  const seatMaterial = new MeshStandardMaterial({ color: 0x8f3434, roughness: 0.72 });
  const startMaterial = new MeshStandardMaterial({ color: 0x10151b, roughness: 0.48, metalness: 0.18 });
  const startPaintMaterial = prepGroundOverlayMaterial(new MeshStandardMaterial({ color: 0x10151b, roughness: 0.64, metalness: 0.04 }));
  const stripeMaterial = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xd8d2bf, 0.92));

  const start = new Vector3(track.start.x, 0, track.start.z);
  const tangent = samples[2].clone().sub(samples[0]).normalize();
  const normal = new Vector3(-tangent.z, 0, tangent.x);
  const angle = yawForTangentX(tangent);

  const pitLaneCenter = new Vector3(-20, 0, 68);
  for (const offset of [-5.4, 5.4]) {
    const laneLine = createGroundDecal(92, 0.18, stripeMaterial, 10);
    laneLine.position.copy(pitLaneCenter).addScaledVector(normal, offset);
    laneLine.position.y = 0.095;
    laneLine.rotation.y = angle;
    group.add(laneLine);
  }

  // The center wall leaves both ends open so the apron reads and drives as a real pit entry/exit.
  const pitWall = new Mesh(new BoxGeometry(66, 0.34, 0.22), wallMaterial);
  pitWall.position.set(-26, 0.19, 76);
  pitWall.rotation.y = angle;
  pitWall.castShadow = true;
  markBoxCollider(pitWall, { profile: "concrete" });
  group.add(pitWall);

  const garageRowCenter = new Vector3(-18, 0, 38);
  for (let i = -4; i <= 4; i++) {
    const garage = new Mesh(new BoxGeometry(9.4, 4.2, 10.4), roofMaterial);
    garage.position
      .copy(garageRowCenter)
      .addScaledVector(tangent, i * 9.8);
    garage.position.y = 2.1;
    garage.rotation.y = angle;
    garage.castShadow = true;
    garage.receiveShadow = true;
    markBoxCollider(garage, { profile: "wall" });
    group.add(garage);

    const door = new Mesh(new BoxGeometry(6.8, 2.3, 0.24), glassMaterial);
    door.position.copy(garage.position).addScaledVector(normal, 5.32);
    door.position.y = 1.25;
    door.rotation.y = angle;
    group.add(door);

    for (const baySide of [-1, 1]) {
      const column = new Mesh(new BoxGeometry(0.24, 2.7, 0.28), wallMaterial);
      column.position.copy(door.position).addScaledVector(tangent, baySide * 3.55);
      column.position.y = 1.35;
      column.rotation.y = angle;
      column.castShadow = true;
      markBoxCollider(column, { profile: "post" });
      group.add(column);
    }
  }

  const sharedRoof = new Mesh(new BoxGeometry(88, 0.34, 11.4), startMaterial);
  sharedRoof.position.copy(garageRowCenter);
  sharedRoof.position.y = 4.34;
  sharedRoof.rotation.y = angle;
  sharedRoof.castShadow = true;
  group.add(sharedRoof);

  const fascia = new Mesh(new BoxGeometry(88, 0.78, 0.32), wallMaterial);
  fascia.position.copy(garageRowCenter).addScaledVector(normal, 5.5);
  fascia.position.y = 4.03;
  fascia.rotation.y = angle;
  fascia.castShadow = true;
  group.add(fascia);

  for (let i = -2; i <= 2; i++) {
    const standBase = new Mesh(new BoxGeometry(16, 2.1, 8), standMaterial);
    standBase.position
      .copy(start)
      .addScaledVector(tangent, i * 18)
      .addScaledVector(normal, roadWidth / 2 + 20);
    standBase.position.y = 1.05;
    standBase.rotation.y = angle;
    standBase.castShadow = true;
    markBoxCollider(standBase, { profile: "concrete" });
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
    markBoxCollider(post, { profile: "post" });
    gantry.add(post);

    const foot = new Mesh(new BoxGeometry(1.2, 0.18, 0.9), wallMaterial);
    foot.position.copy(post.position);
    foot.position.y = 0.09;
    foot.rotation.y = angle;
    foot.castShadow = true;
    markBoxCollider(foot, { profile: "concrete" });
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
    const startLine = createGroundDecal(roadWidth * 0.42, 0.34, stripeMaterial, 10);
    startLine.position.copy(start).addScaledVector(normal, side * (roadWidth * 0.23));
    startLine.position.y = 0.11;
    startLine.rotation.y = angle + Math.PI / 2;
    group.add(startLine);
  }

  for (let i = -3; i <= 3; i++) {
    const box = createGroundDecal(1.6, 2.2, i % 2 === 0 ? stripeMaterial : startPaintMaterial, 10);
    box.position.copy(start).addScaledVector(tangent, -10 + i * 2.2).addScaledVector(normal, 0.9);
    box.position.y = 0.12;
    box.rotation.y = angle;
    group.add(box);
  }

  group.add(gantry);
  return group;
}
