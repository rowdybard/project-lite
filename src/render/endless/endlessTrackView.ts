import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from "three";
import type { Vec2 } from "../../game/types";
import { createAsphaltMaterial, createRoadPaintMaterial } from "../materials/surfaceMaterials";

export type EndlessRenderableSegment = {
  a: Vec2;
  b: Vec2;
  distance: number;
  roadWidth?: number;
  width?: number;
};

export type EndlessRenderableGate = {
  id?: string | number;
  position: Vec2;
  heading: number;
  passed: boolean;
  distance: number;
};

export type EndlessRenderableState = {
  roadWidth: number;
  segments: readonly EndlessRenderableSegment[];
  gates: readonly EndlessRenderableGate[];
};

const roadY = 0.075;
const guardrailHeight = 0.82;
const guardrailWidth = 0.24;
const maxGuardrails = 160;
const matrix = new Matrix4();
const rotation = new Quaternion();
const scale = new Vector3();
const position = new Vector3();
const up = new Vector3(0, 1, 0);

function segmentWidth(segment: EndlessRenderableSegment, fallback: number) {
  return segment.roadWidth ?? segment.width ?? fallback;
}

function geometryFromSegments(state: EndlessRenderableState) {
  const segments = state.segments;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  if (segments.length === 0) return new BufferGeometry();

  const points = [segments[0].a, ...segments.map((segment) => segment.b)];
  let carriedDistance = segments[0].distance;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const rightX = dz / length;
    const rightZ = -dx / length;
    const sourceSegment = segments[Math.min(i, segments.length - 1)];
    const halfWidth = segmentWidth(sourceSegment, state.roadWidth) / 2;
    const crown = 0.022 + Math.sin((carriedDistance + i * 4.1) * 0.035) * 0.009;
    positions.push(
      points[i].x - rightX * halfWidth, roadY, points[i].z - rightZ * halfWidth,
      points[i].x + rightX * halfWidth, roadY + crown, points[i].z + rightZ * halfWidth,
    );
    uvs.push(0, carriedDistance / 6, 1, carriedDistance / 6);
    if (i < segments.length) carriedDistance += Math.hypot(segments[i].b.x - segments[i].a.x, segments[i].b.z - segments[i].a.z);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createGate(gate: EndlessRenderableGate, roadWidth: number) {
  const root = new Group();
  const frameMaterial = new MeshStandardMaterial({
    color: 0x172633,
    roughness: 0.43,
    metalness: 0.38,
    emissive: 0x0b4564,
    emissiveIntensity: gate.passed ? 0.3 : 1.35,
  });
  const signalMaterial = new MeshStandardMaterial({
    color: gate.passed ? 0x43646c : 0x7fe8ff,
    roughness: 0.28,
    emissive: gate.passed ? 0x163039 : 0x36bce9,
    emissiveIntensity: gate.passed ? 0.2 : 3.4,
  });
  const width = roadWidth + 1.8;
  for (const side of [-1, 1]) {
    const post = new Mesh(new BoxGeometry(0.32, 5.4, 0.34), frameMaterial);
    post.position.set(side * width / 2, 2.7, 0);
    root.add(post);
  }
  const beam = new Mesh(new BoxGeometry(width + 0.35, 0.34, 0.38), frameMaterial);
  beam.position.y = 5.25;
  root.add(beam);
  for (let i = -3; i <= 3; i++) {
    const signal = new Mesh(new BoxGeometry(0.66, 0.18, 0.44), signalMaterial);
    signal.position.set(i * (width / 8), 4.78, 0);
    root.add(signal);
  }
  root.position.set(gate.position.x, 0, gate.position.z);
  root.rotation.y = gate.heading;
  root.userData.frameMaterial = frameMaterial;
  root.userData.signalMaterial = signalMaterial;
  root.userData.passed = gate.passed;
  return root;
}

export function createEndlessTrackView(scene: Scene) {
  const root = new Group();
  root.name = "endless-track";
  scene.add(root);

  const savedBackground = scene.background;
  const savedFog = scene.fog;
  const savedEnvironmentIntensity = scene.environmentIntensity;
  scene.background = new Color(0x0d1117);
  scene.fog = new FogExp2(0x0d1117, 0.0038);
  scene.environmentIntensity = 0.42;

  const outdoorLights = scene.userData.outdoorLights as Record<string, { intensity: number; visible: boolean }> | undefined;
  const savedLights = outdoorLights
    ? Object.fromEntries(Object.entries(outdoorLights).map(([key, light]) => [key, { intensity: light.intensity, visible: light.visible }]))
    : null;
  if (outdoorLights) {
    for (const light of Object.values(outdoorLights)) light.visible = true;
    if (outdoorLights.ambient) outdoorLights.ambient.intensity = 0.32;
    if (outdoorLights.hemi) outdoorLights.hemi.intensity = 0.9;
    if (outdoorLights.sun) outdoorLights.sun.intensity = 3.2;
    if (outdoorLights.skyFill) outdoorLights.skyFill.intensity = 0.5;
  }

  const groundMaterial = new MeshStandardMaterial({ color: 0x141a22, roughness: 1, metalness: 0 });
  const ground = new Mesh(new PlaneGeometry(460, 460), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.055;
  ground.receiveShadow = true;
  root.add(ground);

  const roadMaterial = createAsphaltMaterial({ x: 4.5, y: 24 });
  roadMaterial.color.setHex(0x2e353d);
  roadMaterial.roughness = 0.88;
  roadMaterial.envMapIntensity = 0.22;
  let road = new Mesh(geometryFromSegments({ roadWidth: 20, segments: [], gates: [] }), roadMaterial);
  road.frustumCulled = false;
  road.receiveShadow = true;
  root.add(road);

  const railMaterial = new MeshStandardMaterial({
    color: 0x3a4a5a,
    roughness: 0.48,
    metalness: 0.52,
    envMapIntensity: 0.38,
  });
  const rails = new InstancedMesh(new BoxGeometry(1, 1, 1), railMaterial, maxGuardrails);
  rails.frustumCulled = false;
  rails.castShadow = false;
  rails.receiveShadow = true;
  rails.count = 0;
  root.add(rails);

  const edgeMaterial = createRoadPaintMaterial({ x: 1, y: 6 }, 0x7a9aad, 0.82);
  edgeMaterial.emissive = new Color(0x0c3a52);
  edgeMaterial.emissiveIntensity = 1.2;
  const edges = new InstancedMesh(new BoxGeometry(1, 1, 1), edgeMaterial, maxGuardrails);
  edges.frustumCulled = false;
  edges.count = 0;
  root.add(edges);

  const gateRoots = new Map<string, Group>();
  let segmentKey = "";

  function rebuild(state: EndlessRenderableState) {
    const nextGeometry = geometryFromSegments(state);
    road.geometry.dispose();
    road.geometry = nextGeometry;

    let railIndex = 0;
    let edgeIndex = 0;
    for (const segment of state.segments) {
      const dx = segment.b.x - segment.a.x;
      const dz = segment.b.z - segment.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const heading = Math.atan2(dx, dz);
      const rightX = dz / length;
      const rightZ = -dx / length;
      const halfWidth = segmentWidth(segment, state.roadWidth) / 2;
      rotation.setFromAxisAngle(up, heading);

      for (const side of [-1, 1]) {
        if (railIndex < maxGuardrails) {
          position.set(
            (segment.a.x + segment.b.x) * 0.5 + rightX * side * (halfWidth + 0.5),
            guardrailHeight * 0.5 + 0.13,
            (segment.a.z + segment.b.z) * 0.5 + rightZ * side * (halfWidth + 0.5),
          );
          scale.set(guardrailWidth, guardrailHeight, length + 0.4);
          matrix.compose(position, rotation, scale);
          rails.setMatrixAt(railIndex++, matrix);
        }
        if (edgeIndex < maxGuardrails) {
          position.set(
            (segment.a.x + segment.b.x) * 0.5 + rightX * side * (halfWidth - 0.2),
            roadY + 0.025,
            (segment.a.z + segment.b.z) * 0.5 + rightZ * side * (halfWidth - 0.2),
          );
          scale.set(0.11, 0.025, length);
          matrix.compose(position, rotation, scale);
          edges.setMatrixAt(edgeIndex++, matrix);
        }
      }
    }
    rails.count = railIndex;
    rails.instanceMatrix.needsUpdate = true;
    edges.count = edgeIndex;
    edges.instanceMatrix.needsUpdate = true;

    const activeGateKeys = new Set<string>();
    for (const gate of state.gates) {
      const key = String(gate.id ?? Math.round(gate.distance));
      activeGateKeys.add(key);
      let gateRoot = gateRoots.get(key);
      if (!gateRoot) {
        gateRoot = createGate(gate, state.roadWidth);
        gateRoots.set(key, gateRoot);
        root.add(gateRoot);
      }
      gateRoot.position.set(gate.position.x, 0, gate.position.z);
      gateRoot.rotation.y = gate.heading;
      if (gateRoot.userData.passed !== gate.passed) {
        gateRoot.userData.passed = gate.passed;
        const frame = gateRoot.userData.frameMaterial as MeshStandardMaterial;
        const signal = gateRoot.userData.signalMaterial as MeshStandardMaterial;
        frame.emissiveIntensity = gate.passed ? 0.3 : 1.35;
        signal.color.setHex(gate.passed ? 0x43646c : 0x7fe8ff);
        signal.emissive.setHex(gate.passed ? 0x163039 : 0x36bce9);
        signal.emissiveIntensity = gate.passed ? 0.2 : 3.4;
      }
    }
    for (const [key, gateRoot] of gateRoots) {
      if (activeGateKeys.has(key)) continue;
      root.remove(gateRoot);
      gateRoot.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      });
      gateRoots.delete(key);
    }
  }

  return {
    root,
    update(state: EndlessRenderableState, carPosition: Vec2) {
      ground.position.x = Math.round(carPosition.x / 25) * 25;
      ground.position.z = Math.round(carPosition.z / 25) * 25;
      const first = state.segments[0];
      const last = state.segments[state.segments.length - 1];
      const nextKey = `${state.segments.length}:${first?.distance ?? 0}:${last?.distance ?? 0}:${state.gates.map((gate) => `${gate.id ?? gate.distance}:${gate.passed ? 1 : 0}`).join(",")}`;
      if (nextKey === segmentKey) return;
      segmentKey = nextKey;
      rebuild(state);
    },
    reset() {
      segmentKey = "";
    },
    dispose() {
      scene.remove(root);
      scene.background = savedBackground;
      scene.fog = savedFog;
      scene.environmentIntensity = savedEnvironmentIntensity;
      if (outdoorLights && savedLights) {
        for (const [key, saved] of Object.entries(savedLights)) {
          const light = outdoorLights[key];
          if (!light) continue;
          light.intensity = saved.intensity;
          light.visible = saved.visible;
        }
      }
      root.traverse((child: Object3D) => {
        if (!(child instanceof Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      });
    },
  };
}
