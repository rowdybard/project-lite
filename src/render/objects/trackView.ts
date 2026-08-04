import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DirectionalLight,
  Fog,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from "three";
import type { CarState, TrackConfig } from "../../game/types";
import { loadMapEdits, type MapEditStamp } from "../../game/editor/mapEdits";
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
import { createImportedCarModel } from "./importedCars";
import { createMapEditStampObject } from "./mapEditObjects";

export type TrackViewResult = {
  root: Object3D;
  coneMeshes: Mesh[];
  cornerMarkers: CornerMarker[];
};

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

export async function createTrackView(scene: Scene, track: TrackConfig): Promise<TrackViewResult> {
  const indoor = isIndoorDriftVenue(track);
  configureTrackMood(scene, indoor);
  const root = new Group();
  const imported = await loadGltf(track.model);
  if (imported) {
    root.add(imported);
    scene.add(root);
    return { root, coneMeshes: [], cornerMarkers: [] };
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
  root.add(ground);
  if (indoor) root.add(createIndoorDriftHall(bounds));
  else root.add(createTrackBackdrop(track));

  if (track.roadPath && track.roadPath.length >= 4) {
    const { group, coneMeshes, cornerMarkers } = await createRoadFromPath(track, indoor);
    optimizeTrackShadows(group);
    root.add(group);
    scene.add(root);
    return { root, coneMeshes, cornerMarkers };
  } else {
    root.add(createRingRoad(track));
    scene.add(root);
    return { root, coneMeshes: [], cornerMarkers: [] };
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
  const roadMaterial = createAsphaltMaterial({ x: 1, y: 1 });
  if (indoor) {
    roadMaterial.color.set(0x918d84);
    roadMaterial.roughness = 0.94;
    roadMaterial.envMapIntensity = 0.28;
  }
  roadMaterial.side = DoubleSide;
  const road = new Mesh(createRoadGeometry(samples, roadWidth), roadMaterial);
  road.receiveShadow = true;
  group.add(road);

  const cornerMarkers = createCornerPoles(track, roadWidth, dressing);
  group.add(cornerMarkers.group);
  if (!indoor) {
    group.add(createShoulderBlend(track, samples, roadWidth, dressing));
    group.add(createGrassTufts(samples, roadWidth, dressing));
    group.add(createFoliage(samples, roadWidth, dressing));
    group.add(createRunoffPatches(track, samples, roadWidth, dressing));
  }
  group.add(createRoadWearDecals(samples, roadWidth));
  group.add(createPaintedLines(samples, roadWidth));
  group.add(createPracticeAreas(track, samples, roadWidth));
  group.add(await createModePortals(track));
  group.add(createOnlineLobbyDressing(track));
  group.add(createCurbs(track, samples, roadWidth, dressing));
  const trackside = createTracksideDepth(track, samples, roadWidth, dressing);
  group.add(trackside.group);
  group.add(createTrackLandmarks(samples, roadWidth, dressing));
  group.add(createTrainingCircuitDressing(track, samples, roadWidth, dressing));
  if (indoor) group.add(createIndoorPaddock(track));
  else group.add(createCircuitFacilities(track, samples, roadWidth));
  group.add(await createMapEditOverlays(mapEdits));
  return { group, coneMeshes: trackside.coneMeshes, cornerMarkers: cornerMarkers.markers };
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

function createPracticeAreas(track: TrackConfig, samples: Vector3[], roadWidth: number) {
  const group = new Group();
  if (!track.practiceAreas) return group;

  const asphaltMaterial = createAsphaltMaterial({ x: 1, y: 1 });
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

function createOnlineLobbyDressing(track: TrackConfig) {
  const group = new Group();
  if (track.id !== "online-lobby") return group;

  const paint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0x9fdfff, 0.46));
  const goldPaint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xf1c75b, 0.5));
  const whitePaint = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1, y: 1 }, 0xf7f0df, 0.82));
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
    group.add(pole);

    const arm = new Mesh(new BoxGeometry(3.6, 0.16, 0.18), metal);
    arm.position.set(x + (x < 0 ? 1.5 : -1.5), 8.05, z);
    arm.castShadow = true;
    group.add(arm);

    const lamp = new Mesh(new BoxGeometry(1.4, 0.16, 0.55), light);
    lamp.position.set(x + (x < 0 ? 3 : -3), 7.86, z);
    group.add(lamp);
  }

  for (const portal of track.portals ?? []) {
    const heading = portal.heading ?? 0;
    const approach = new Group();
    approach.position.set(portal.x, 0.118, portal.z);
    approach.rotation.y = heading;
    for (let i = 0; i < 6; i++) {
      const centerLine = createGroundDecal(0.82, 3.2, whitePaint, 10);
      centerLine.position.set(0, 0, -13 - i * 6.1);
      centerLine.receiveShadow = true;
      approach.add(centerLine);

      for (const side of [-1, 1]) {
        const chevron = createGroundDecal(5.6 - i * 0.24, 0.5, whitePaint, 10);
        chevron.position.set(side * 2.25, 0.002, -10.5 - i * 6.1);
        chevron.rotation.y = side * 0.48;
        chevron.receiveShadow = true;
        approach.add(chevron);
      }
    }

    const laneEdgeOffset = portal.mode === "drift-attack" ? -5.2 : 5.2;
    const edgeStripe = createGroundDecal(0.52, 38, portal.mode === "drift-attack" ? goldPaint : paint, 10);
    edgeStripe.position.set(laneEdgeOffset, 0.004, -22);
    edgeStripe.receiveShadow = true;
    approach.add(edgeStripe);

    const label = createGroundPaintLabel(portal.mode === "drift-attack" ? "DRIFT" : "PRACTICE");
    label.position.set(0, 0.006, -39);
    approach.add(label);

    for (const x of [-6.8, 6.8]) {
      const stopBar = createGroundDecal(0.62, 11, whitePaint, 10);
      stopBar.position.set(x, 0.004, -2.8);
      stopBar.receiveShadow = true;
      approach.add(stopBar);
    }
    group.add(approach);
  }

  return group;
}

function createGroundPaintLabel(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(247, 240, 223, 0.9)";
  ctx.font = "900 72px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 4;
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
  });
  prepGroundOverlayMaterial(material);
  const mesh = new Mesh(new PlaneGeometry(18, 4.5), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 10;
  return mesh;
}

async function createModePortals(track: TrackConfig) {
  const group = new Group();
  if (!track.portals) return group;

  for (const portal of track.portals) {
    const color = portal.color ?? (portal.mode === "drift-attack" ? 0xf1c75b : 0x68d8ff);
    const portalGroup = new Group();
    portalGroup.position.set(portal.x, 0.03, portal.z);
    portalGroup.rotation.y = portal.heading ?? 0;

    const glowMaterial = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.75,
      roughness: 0.38,
      metalness: 0.12,
      transparent: true,
      opacity: 0.72,
    });
    const frameMaterial = new MeshStandardMaterial({
      color: 0x111923,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.52,
      metalness: 0.45,
    });
    const padMaterial = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.7,
      transparent: true,
      opacity: 0.34,
    });

    const gateHalfWidth = Math.max(4.8, portal.radius * 0.56);
    const postHeight = 4.8;
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.42, postHeight, 0.5), frameMaterial);
      post.position.set(side * gateHalfWidth, postHeight / 2, 0);
      post.castShadow = true;
      portalGroup.add(post);
    }

    const topBeam = new Mesh(new BoxGeometry(gateHalfWidth * 2 + 0.4, 0.38, 0.52), frameMaterial);
    topBeam.position.set(0, postHeight, 0);
    topBeam.castShadow = true;
    portalGroup.add(topBeam);

    const ring = new Mesh(new TorusGeometry(gateHalfWidth * 0.58, 0.07, 10, 48), glowMaterial);
    ring.position.set(0, 2.65, -0.06);
    ring.scale.y = 0.72;
    portalGroup.add(ring);

    const pad = new Mesh(new RingGeometry(portal.radius * 0.35, portal.radius * 0.78, 64), padMaterial);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.065;
    portalGroup.add(pad);

    const hauler = await createPortalHauler(color, portal.mode);
    portalGroup.add(hauler);

    const beamMaterial = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      roughness: 1,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
    });
    const beam = new Mesh(new CylinderGeometry(4.4, 1.8, 34, 32, 1, true), beamMaterial);
    beam.position.y = 19;
    portalGroup.add(beam);

    const smokeMaterial = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.26,
      roughness: 1,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    for (let i = 0; i < 9; i++) {
      const puff = new Mesh(new IcosahedronGeometry(1, 1), smokeMaterial);
      const angle = i * 1.73;
      const radius = 0.9 + (i % 3) * 0.52;
      puff.position.set(Math.cos(angle) * radius, 6.5 + i * 3.15, Math.sin(angle) * radius * 0.72);
      const scale = 1.1 + (i % 4) * 0.28;
      puff.scale.set(scale * 1.28, scale * 0.72, scale);
      portalGroup.add(puff);
    }

    group.add(portalGroup);
  }

  return group;
}

async function createPortalHauler(color: number, mode: "drift-attack" | "free-drive") {
  const group = new Group();
  const metal = new MeshStandardMaterial({ color: 0x202932, roughness: 0.48, metalness: 0.58 });
  const deck = new MeshStandardMaterial({ color: 0x303a42, roughness: 0.72, metalness: 0.36 });
  const dark = new MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.78, metalness: 0.12 });
  const paint = createRoadPaintMaterial({ x: 1, y: 1 }, 0xf7f0df, 0.86);
  const accent = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.62,
    roughness: 0.5,
    metalness: 0.22,
  });
  const light = new MeshStandardMaterial({
    color: 0xf6e3a8,
    emissive: color,
    emissiveIntensity: 1.35,
    roughness: 0.28,
  });

  const trailer = new Group();
  trailer.position.z = 0.7;
  group.add(trailer);

  const deckPlate = new Mesh(new BoxGeometry(7.2, 0.24, 11.8), deck);
  deckPlate.position.set(0, 0.28, 1.0);
  deckPlate.castShadow = true;
  deckPlate.receiveShadow = true;
  trailer.add(deckPlate);

  const bedTop = new Mesh(new BoxGeometry(6.65, 0.035, 11.25), dark);
  bedTop.position.set(0, 0.43, 1.0);
  bedTop.receiveShadow = true;
  trailer.add(bedTop);

  for (const x of [-2.05, 2.05]) {
    const tireLane = createGroundDecal(0.74, 10.2, paint, 10);
    tireLane.position.set(x, 0.46, 0.72);
    tireLane.receiveShadow = true;
    trailer.add(tireLane);
  }

  for (const x of [-3.82, 3.82]) {
    const rail = new Mesh(new BoxGeometry(0.26, 0.45, 11.8), metal);
    rail.position.set(x, 0.66, 1.0);
    rail.castShadow = true;
    trailer.add(rail);
  }

  for (const z of [-4.7, -2.2, 0.3, 2.8, 5.3]) {
    const crossBrace = new Mesh(new BoxGeometry(7.55, 0.18, 0.18), metal);
    crossBrace.position.set(0, 0.23, z);
    crossBrace.castShadow = true;
    trailer.add(crossBrace);
  }

  for (const x of [-2.2, 2.2]) {
    const ramp = new Mesh(new BoxGeometry(1.65, 0.12, 5.6), metal);
    ramp.position.set(x, 0.2, -7.1);
    ramp.rotation.x = -0.08;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    trailer.add(ramp);

    const rampStripe = createGroundDecal(1.1, 4.5, paint, 10);
    rampStripe.position.set(x, 0.285, -7.35);
    rampStripe.rotation.x = -0.08;
    trailer.add(rampStripe);
  }

  const axle = new Mesh(new CylinderGeometry(0.11, 0.11, 8.1, 12), metal);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.36, -2.05);
  trailer.add(axle);

  const wheelMaterial = new MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.86, metalness: 0.08 });
  const rimMaterial = new MeshStandardMaterial({ color: 0x7b858d, roughness: 0.42, metalness: 0.42 });
  for (const x of [-3.68, 3.68]) {
    for (const z of [-2.9, -1.25]) {
      const wheel = new Mesh(new CylinderGeometry(0.48, 0.48, 0.38, 20), wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.45, z);
      wheel.castShadow = true;
      trailer.add(wheel);

      const rim = new Mesh(new CylinderGeometry(0.24, 0.24, 0.4, 16), rimMaterial);
      rim.rotation.z = Math.PI / 2;
      rim.position.copy(wheel.position);
      trailer.add(rim);
    }
  }

  const portalLine = createGroundDecal(6.4, 0.48, accent, 10);
  portalLine.position.set(0, 0.49, mode === "drift-attack" ? 1.7 : 2.25);
  trailer.add(portalLine);

  for (const x of [-3.1, 3.1]) {
    const marker = new Mesh(new BoxGeometry(0.42, 0.42, 0.22), light);
    marker.position.set(x, 0.84, -4.88);
    trailer.add(marker);
  }

  const hitch = new Mesh(new BoxGeometry(1.2, 0.18, 3.2), metal);
  hitch.position.set(0, 0.32, 7.6);
  hitch.rotation.y = Math.PI / 4;
  hitch.castShadow = true;
  trailer.add(hitch);
  const hitchMirror = hitch.clone();
  hitchMirror.rotation.y = -Math.PI / 4;
  trailer.add(hitchMirror);

  const truck = await createImportedCarModel("pack-pickup");
  if (truck) {
    truck.root.position.set(0, 0.02, 12.55);
    truck.root.rotation.y = 0;
    truck.root.scale.multiplyScalar(1.78);
    truck.root.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    group.add(truck.root);
  } else {
    const cab = new Mesh(new BoxGeometry(4.6, 2.1, 7.2), accent);
    cab.position.set(0, 1.15, 12.35);
    cab.castShadow = true;
    group.add(cab);
  }

  const loadingSign = createGroundPaintLabel(mode === "drift-attack" ? "LOAD DRIFT" : "LOAD PRACTICE");
  loadingSign.position.set(0, 0.12, -12.6);
  group.add(loadingSign);

  return group;
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
  const stored = scene.userData.outdoorMood as
    | { background: Scene["background"]; fog: Scene["fog"]; environmentIntensity: number; sunIntensity: number }
    | undefined;
  const drivingSun = scene.userData.drivingSun as DirectionalLight | undefined;

  if (!stored) {
    scene.userData.outdoorMood = {
      background: scene.background,
      fog: scene.fog,
      environmentIntensity: scene.environmentIntensity,
      sunIntensity: drivingSun?.intensity ?? 2.75,
    };
  }

  const outdoor = scene.userData.outdoorMood as {
    background: Scene["background"];
    fog: Scene["fog"];
    environmentIntensity: number;
    sunIntensity: number;
  };
  scene.userData.indoorVenue = indoor;
  if (indoor) {
    scene.background = new Color(0x242a2d);
    scene.fog = new Fog(0x3f4648, 82, 310);
    scene.environmentIntensity = 0.14;
    if (drivingSun) drivingSun.intensity = 0.2;
    return;
  }

  scene.background = outdoor.background;
  scene.fog = outdoor.fog;
  scene.environmentIntensity = outdoor.environmentIntensity;
  if (drivingSun) drivingSun.intensity = outdoor.sunIntensity;
}

function createIndoorVenueSign(label: string, accent: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#151b1e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${accent.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, 20);
  ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
  ctx.fillStyle = "#f1eee2";
  ctx.font = "900 72px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 3);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return new Mesh(
    new PlaneGeometry(20, 5),
    new MeshStandardMaterial({
      map: texture,
      emissive: 0x2f281d,
      emissiveMap: texture,
      emissiveIntensity: 0.16,
      roughness: 0.68,
      side: DoubleSide,
    }),
  );
}

function createIndoorDriftHall(bounds: ReturnType<typeof getTrackBounds>) {
  const group = new Group();
  const wallHeight = 25;
  const roofY = 25.2;
  const inset = 4.5;
  const innerWidth = bounds.width - inset * 2;
  const innerDepth = bounds.depth - inset * 2;
  const wallMaterial = new MeshStandardMaterial({ color: 0x555a59, roughness: 0.91, metalness: 0.03, side: DoubleSide });
  const roofMaterial = new MeshStandardMaterial({ color: 0x1d2427, roughness: 0.8, metalness: 0.2, side: DoubleSide });
  const steelMaterial = new MeshStandardMaterial({ color: 0x20292d, roughness: 0.58, metalness: 0.5 });
  const stripeMaterial = new MeshStandardMaterial({ color: 0xd6a63d, emissive: 0x351e04, roughness: 0.54 });
  const lightMaterial = new MeshStandardMaterial({ color: 0xf5e7bf, emissive: 0xffc873, emissiveIntensity: 1.15, roughness: 0.3 });
  group.add(new AmbientLight(0xe3e9e3, 0.5));

  for (const wall of [
    { width: innerWidth, depth: 0.8, x: bounds.centerX, z: bounds.centerZ - innerDepth / 2 },
    { width: innerWidth, depth: 0.8, x: bounds.centerX, z: bounds.centerZ + innerDepth / 2 },
    { width: 0.8, depth: innerDepth, x: bounds.centerX - innerWidth / 2, z: bounds.centerZ },
    { width: 0.8, depth: innerDepth, x: bounds.centerX + innerWidth / 2, z: bounds.centerZ },
  ]) {
    const shell = new Mesh(new BoxGeometry(wall.width, wallHeight, wall.depth), wallMaterial);
    shell.position.set(wall.x, wallHeight / 2, wall.z);
    shell.receiveShadow = true;
    const stripe = new Mesh(new BoxGeometry(wall.width + 0.04, 0.5, wall.depth + 0.05), stripeMaterial);
    stripe.position.set(wall.x, 3.1, wall.z);
    group.add(shell, stripe);
  }

  const roof = new Mesh(new BoxGeometry(innerWidth + 0.8, 0.5, innerDepth + 0.8), roofMaterial);
  roof.position.set(bounds.centerX, roofY, bounds.centerZ);
  roof.receiveShadow = true;
  group.add(roof);

  const trussCount = 9;
  const trusses = new InstancedMesh(new BoxGeometry(innerWidth - 1.2, 0.24, 0.28), steelMaterial, trussCount);
  const fixtures = new InstancedMesh(new BoxGeometry(4.8, 0.18, 0.88), lightMaterial, trussCount * 2);
  const matrix = new Matrix4();
  let fixtureIndex = 0;
  for (let i = 0; i < trussCount; i++) {
    const z = bounds.centerZ - innerDepth * 0.4 + (i / (trussCount - 1)) * innerDepth * 0.8;
    matrix.makeTranslation(bounds.centerX, roofY - 2.05, z);
    trusses.setMatrixAt(i, matrix);
    for (const offset of [-innerWidth * 0.23, innerWidth * 0.23]) {
      matrix.makeTranslation(bounds.centerX + offset, roofY - 2.5, z);
      fixtures.setMatrixAt(fixtureIndex++, matrix);
    }
  }
  trusses.instanceMatrix.needsUpdate = true;
  fixtures.count = fixtureIndex;
  fixtures.instanceMatrix.needsUpdate = true;
  group.add(trusses, fixtures);

  for (const xRatio of [-0.26, 0.26]) {
    for (const zRatio of [-0.28, 0, 0.28]) {
      const light = new PointLight(0xffd7a5, 52, 128, 1.5);
      light.position.set(bounds.centerX + innerWidth * xRatio, roofY - 3.1, bounds.centerZ + innerDepth * zRatio);
      group.add(light);
    }
  }

  const overhead = new DirectionalLight(0xffe2bd, 0.9);
  overhead.position.set(bounds.centerX - innerWidth * 0.18, roofY - 1, bounds.centerZ - innerDepth * 0.12);
  overhead.target.position.set(bounds.centerX, 0, bounds.centerZ);
  group.add(overhead, overhead.target);

  const sign = createIndoorVenueSign("PROJECT LITE  //  DRIFT LAB", 0xd6a63d);
  sign.position.set(bounds.centerX, 10.5, bounds.centerZ - innerDepth / 2 + 0.46);
  sign.rotation.y = Math.PI;
  group.add(sign);

  return group;
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
  materialA.envMapIntensity = 0.01;
  materialB.envMapIntensity = 0.01;
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

function createPaintedLines(samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const edgeMaterial = prepGroundOverlayMaterial(createRoadPaintMaterial({ x: 1.8, y: 1 }, 0xcfc8b7, 0.68));
  const seamMaterial = prepGroundOverlayMaterial(createProceduralStainMaterial(0x15191d, 0.26));
  const distances = buildRoadDistances(samples);

  for (let i = 0; i < samples.length; i += 8) {
    const previous = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(previous).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = yawForTangentX(tangent);

    for (const side of [-1, 1]) {
      const lateral = side * (roadWidth / 2 - 0.68);
      const line = createGroundDecal(3.6, 0.075, edgeMaterial, 10);
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

  return group;
}

function createRoadWearDecals(samples: Vector3[], roadWidth: number) {
  const group = new Group();
  const rubberMaterial = prepGroundOverlayMaterial(createRubberMaterial({ x: 2.8, y: 1.2 }, 0.34));
  const stainMaterial = prepGroundOverlayMaterial(createProceduralStainMaterial(0x121517, 0.22));
  const rubberGeometry = groundDecalGeometry(6.4, 3.2);
  const stainGeometry = groundDecalGeometry(3.8, 0.52);
  const rubberCount = Math.floor(samples.length / 12);
  const stainCount = Math.floor(samples.length / 10);
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

    if (i % 12 === 0 && rubberIndex < rubberCount) {
      const lateral = Math.sin(i * 0.29) * roadWidth * 0.14;
      const position = samples[i].clone().addScaledVector(normal, lateral);
      rotation.setFromAxisAngle(up, angle + ((((i * 11) % 100) / 100) - 0.5) * 0.18);
      matrix.compose(
        new Vector3(position.x, roadSurfaceYAt(distances, i, lateral, roadWidth, 0.078), position.z),
        rotation,
        new Vector3(0.95 + ((i * 5) % 7) * 0.045, 1, 0.78 + ((i * 3) % 5) * 0.06),
      );
      rubber.setMatrixAt(rubberIndex, matrix);
      rubberIndex += 1;
    }

    if (i % 10 === 0 && stainIndex < stainCount) {
      const lateral = ((((i * 19) % 100) / 100) - 0.5) * roadWidth * 0.72;
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

function createCurbs(track: TrackConfig, samples: Vector3[], roadWidth: number, dressing: DressingPlacement) {
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
      const position = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 0.35));
      if (!dressing.allows(position, 0.1)) continue;
      const curb = new Mesh(new BoxGeometry(1.85, 0.1, 0.72), (i / 10) % 2 === 0 ? red : white);
      curb.position.copy(position);
      curb.position.y = 0.12;
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
