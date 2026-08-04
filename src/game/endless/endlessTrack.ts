import type { Barrier, TrackColliders } from "../simulation/trackCollision";
import type { Vec2 } from "../types";
import {
  createTrackGenerator,
  type TrackGeneratorOptions,
  type TrackPoint,
} from "./trackGenerator";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

export const endlessTrackDefaults = {
  aheadDistance: 900,
  behindDistance: 320,
  scoringShoulder: 2.5,
  runoffWidth: 3.5,
  guardrailHalfWidth: 0.28,
  guardrailEdgeOffset: 0.42,
  gateHalfWidthMargin: 0.65,
} as const;

export type EndlessTrackOptions = {
  aheadDistance?: number;
  behindDistance?: number;
  scoringShoulder?: number;
  runoffWidth?: number;
  guardrailHalfWidth?: number;
  guardrailEdgeOffset?: number;
  gateHalfWidthMargin?: number;
  generator?: TrackGeneratorOptions;
};

export type TrackSegment = {
  readonly id: number;
  readonly index: number;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Cumulative distance at a. */
  readonly distance: number;
  readonly endDistance: number;
  readonly length: number;
  /** Tangent direction in radians. Zero points down world +Z. */
  readonly heading: number;
  readonly curvature: number;
  readonly startRoadWidth: number;
  readonly endRoadWidth: number;
  readonly roadWidth: number;
  readonly difficulty: number;
};

export type Gate = {
  readonly id: number;
  readonly position: Vec2;
  readonly heading: number;
  readonly distance: number;
  readonly roadWidth: number;
  passed: boolean;
};

export type TrackProjection = {
  readonly point: Vec2;
  readonly distance: number;
  readonly lateralDistance: number;
  readonly signedLateralDistance: number;
  readonly heading: number;
  readonly roadWidth: number;
  readonly segment: TrackSegment;
  readonly segmentT: number;
};

export type EndlessTrackState = {
  readonly seed: number;
  roadWidth: number;
  readonly segments: TrackSegment[];
  readonly gates: Gate[];
  /** Stable collider object; its barrier array is updated in place when streaming. */
  readonly colliders: TrackColliders;
  readonly barriers: Barrier[];
  /** Furthest valid centerline progress observed for the car. */
  progressDistance: number;
  /** Generated centerline distance, including the look-ahead window. */
  totalDistance: number;
  nextGateDistance: number;
  revision: number;
};

export type EndlessTrackUpdate = {
  readonly projection: TrackProjection;
  readonly passedGates: readonly Gate[];
  readonly changed: boolean;
};

export type EndlessTrack = {
  readonly state: EndlessTrackState;
  update(carPosition: Vec2): EndlessTrackUpdate;
  project(point: Vec2): TrackProjection;
  getTrackDistance(point: Vec2): number;
  getProgress(point: Vec2): number;
  getNextGateDistance(point?: Vec2): number;
  isOnTrack(point: Vec2): boolean;
  isInRunoff(point: Vec2): boolean;
  nearestGate(point: Vec2): Gate | null;
  nextGate(): Gate | null;
  consumePassedGates(): Gate[];
  getColliders(): TrackColliders;
};

function projectToSegment(point: Vec2, segment: TrackSegment) {
  const abx = segment.b.x - segment.a.x;
  const abz = segment.b.z - segment.a.z;
  const lengthSq = abx * abx + abz * abz;
  const apx = point.x - segment.a.x;
  const apz = point.z - segment.a.z;
  const t = lengthSq <= 1e-8 ? 0 : clamp((apx * abx + apz * abz) / lengthSq, 0, 1);
  const x = segment.a.x + abx * t;
  const z = segment.a.z + abz * t;
  const dx = point.x - x;
  const dz = point.z - z;
  const inverseLength = segment.length > 1e-8 ? 1 / segment.length : 0;
  const normalX = -abz * inverseLength;
  const normalZ = abx * inverseLength;
  return {
    point: { x, z },
    t,
    lateralDistance: Math.hypot(dx, dz),
    signedLateralDistance: dx * normalX + dz * normalZ,
  };
}

export function createEndlessTrack(seed: number, options: EndlessTrackOptions = {}): EndlessTrack {
  const config = {
    aheadDistance: Math.max(200, options.aheadDistance ?? endlessTrackDefaults.aheadDistance),
    behindDistance: Math.max(80, options.behindDistance ?? endlessTrackDefaults.behindDistance),
    scoringShoulder: Math.max(0, options.scoringShoulder ?? endlessTrackDefaults.scoringShoulder),
    runoffWidth: Math.max(0, options.runoffWidth ?? endlessTrackDefaults.runoffWidth),
    guardrailHalfWidth: Math.max(0.1, options.guardrailHalfWidth ?? endlessTrackDefaults.guardrailHalfWidth),
    guardrailEdgeOffset: Math.max(0, options.guardrailEdgeOffset ?? endlessTrackDefaults.guardrailEdgeOffset),
    gateHalfWidthMargin: Math.max(0, options.gateHalfWidthMargin ?? endlessTrackDefaults.gateHalfWidthMargin),
  };
  const generator = createTrackGenerator(seed, options.generator);
  const segments: TrackSegment[] = [];
  const gates: Gate[] = [];
  const colliders: TrackColliders = { barriers: [], cones: [] };
  const passedGateQueue: Gate[] = [];
  let previousPoint = generator.current();
  let lastCarPosition: Vec2 = { x: previousPoint.x, z: previousPoint.z };
  let nextSegmentId = 0;

  const state: EndlessTrackState = {
    seed: generator.seed,
    roadWidth: previousPoint.roadWidth,
    segments,
    gates,
    colliders,
    barriers: colliders.barriers,
    progressDistance: 0,
    totalDistance: 0,
    nextGateDistance: previousPoint.gateInterval,
    revision: 0,
  };

  const appendSegment = (start: TrackPoint, end: TrackPoint) => {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-6) return;
    const segment: TrackSegment = {
      id: nextSegmentId,
      index: nextSegmentId,
      a: { x: start.x, z: start.z },
      b: { x: end.x, z: end.z },
      distance: start.distance,
      endDistance: end.distance,
      length,
      heading: Math.atan2(dx, dz),
      curvature: end.curvature,
      startRoadWidth: start.roadWidth,
      endRoadWidth: end.roadWidth,
      roadWidth: (start.roadWidth + end.roadWidth) * 0.5,
      difficulty: end.difficulty,
    };
    nextSegmentId += 1;
    segments.push(segment);

    if (end.gateDistance !== null && end.gateIndex !== null) {
      const gateT = clamp((end.gateDistance - start.distance) / Math.max(end.distance - start.distance, 1e-6), 0, 1);
      gates.push({
        id: end.gateIndex,
        position: {
          x: lerp(start.x, end.x, gateT),
          z: lerp(start.z, end.z, gateT),
        },
        heading: segment.heading,
        distance: end.gateDistance,
        roadWidth: lerp(start.roadWidth, end.roadWidth, gateT),
        passed: false,
      });
    }
  };

  const generateThrough = (targetDistance: number) => {
    let changed = false;
    while (generator.distance() < targetDistance) {
      const nextPoint = generator.next();
      appendSegment(previousPoint, nextPoint);
      previousPoint = nextPoint;
      changed = true;
    }
    state.totalDistance = generator.distance();
    return changed;
  };

  const rebuildBarriers = () => {
    const nextBarriers: Barrier[] = [];
    for (const segment of segments) {
      const tangentX = (segment.b.x - segment.a.x) / segment.length;
      const tangentZ = (segment.b.z - segment.a.z) / segment.length;
      const normalX = -tangentZ;
      const normalZ = tangentX;
      const centerX = (segment.a.x + segment.b.x) * 0.5;
      const centerZ = (segment.a.z + segment.b.z) * 0.5;
      const edgeDistance = segment.roadWidth * 0.5 + config.guardrailEdgeOffset;
      const angle = Math.atan2(tangentZ, tangentX);
      for (const side of [-1, 1]) {
        nextBarriers.push({
          x: centerX + normalX * edgeDistance * side,
          z: centerZ + normalZ * edgeDistance * side,
          angle,
          // Small overlap seals joins between streaming pieces on sharper bends.
          halfLength: segment.length * 0.5 + 0.55,
          halfWidth: config.guardrailHalfWidth,
        });
      }
    }
    colliders.barriers.splice(0, colliders.barriers.length, ...nextBarriers);
  };

  const project = (point: Vec2): TrackProjection => {
    if (segments.length === 0) throw new Error("Endless track has no generated segments.");
    let bestSegment = segments[0];
    let best = projectToSegment(point, bestSegment);
    for (let index = 1; index < segments.length; index += 1) {
      const candidateSegment = segments[index];
      const candidate = projectToSegment(point, candidateSegment);
      if (candidate.lateralDistance < best.lateralDistance) {
        bestSegment = candidateSegment;
        best = candidate;
      }
    }
    return {
      point: best.point,
      distance: lerp(bestSegment.distance, bestSegment.endDistance, best.t),
      lateralDistance: best.lateralDistance,
      signedLateralDistance: best.signedLateralDistance,
      heading: bestSegment.heading,
      roadWidth: lerp(bestSegment.startRoadWidth, bestSegment.endRoadWidth, best.t),
      segment: bestSegment,
      segmentT: best.t,
    };
  };

  const findNextGate = (progress = state.progressDistance) => {
    for (const gate of gates) {
      if (!gate.passed && gate.distance > progress + 0.25) return gate;
    }
    return null;
  };

  const updateNextGateDistance = (progress = state.progressDistance) => {
    const gate = findNextGate(progress);
    state.nextGateDistance = gate ? Math.max(0, gate.distance - progress) : Infinity;
  };

  const detectGatePasses = (carPosition: Vec2) => {
    const passed: Gate[] = [];
    for (const gate of gates) {
      if (gate.passed) continue;
      const forwardX = Math.sin(gate.heading);
      const forwardZ = Math.cos(gate.heading);
      const rightX = Math.cos(gate.heading);
      const rightZ = -Math.sin(gate.heading);
      const previousAlong =
        (lastCarPosition.x - gate.position.x) * forwardX +
        (lastCarPosition.z - gate.position.z) * forwardZ;
      const currentDx = carPosition.x - gate.position.x;
      const currentDz = carPosition.z - gate.position.z;
      const currentAlong = currentDx * forwardX + currentDz * forwardZ;
      const lateral = Math.abs(currentDx * rightX + currentDz * rightZ);
      if (
        previousAlong < 0 && currentAlong >= 0 &&
        lateral <= gate.roadWidth * 0.5 + config.gateHalfWidthMargin
      ) {
        gate.passed = true;
        passed.push(gate);
        passedGateQueue.push(gate);
      }
    }
    return passed;
  };

  generateThrough(config.aheadDistance);
  rebuildBarriers();
  state.revision = 1;
  updateNextGateDistance();

  const update = (carPosition: Vec2): EndlessTrackUpdate => {
    const revisionBefore = state.revision;
    let projection = project(carPosition);
    state.progressDistance = Math.max(state.progressDistance, projection.distance);
    state.roadWidth = projection.roadWidth;

    let geometryChanged = generateThrough(state.progressDistance + config.aheadDistance);
    const pruneBefore = state.progressDistance - config.behindDistance;
    let removeSegmentCount = 0;
    while (
      removeSegmentCount < segments.length - 2 &&
      segments[removeSegmentCount].endDistance < pruneBefore
    ) {
      removeSegmentCount += 1;
    }
    if (removeSegmentCount > 0) {
      segments.splice(0, removeSegmentCount);
      geometryChanged = true;
      projection = project(carPosition);
    }

    const gatePruneBefore = pruneBefore - 40;
    let removeGateCount = 0;
    while (removeGateCount < gates.length && gates[removeGateCount].distance < gatePruneBefore) {
      removeGateCount += 1;
    }
    if (removeGateCount > 0) {
      gates.splice(0, removeGateCount);
      geometryChanged = true;
    }

    if (geometryChanged) {
      rebuildBarriers();
      state.revision += 1;
    }

    const passedGates = detectGatePasses(carPosition);
    if (passedGates.length > 0) state.revision += 1;
    lastCarPosition = { x: carPosition.x, z: carPosition.z };
    updateNextGateDistance();

    return {
      projection,
      passedGates,
      changed: state.revision !== revisionBefore,
    };
  };

  const getProgress = (point: Vec2) => project(point).distance;
  const getTrackDistance = (point: Vec2) => project(point).lateralDistance;
  const isOnTrack = (point: Vec2) => {
    const projection = project(point);
    return projection.lateralDistance <= projection.roadWidth * 0.5 + config.scoringShoulder;
  };
  const isInRunoff = (point: Vec2) => {
    const projection = project(point);
    const roadEdge = projection.roadWidth * 0.5 + config.scoringShoulder;
    return projection.lateralDistance > roadEdge && projection.lateralDistance <= roadEdge + config.runoffWidth;
  };
  const nearestGate = (point: Vec2) => {
    let nearest: Gate | null = null;
    let nearestDistance = Infinity;
    for (const gate of gates) {
      if (gate.passed) continue;
      const distance = Math.hypot(point.x - gate.position.x, point.z - gate.position.z);
      if (distance < nearestDistance) {
        nearest = gate;
        nearestDistance = distance;
      }
    }
    return nearest;
  };
  const getNextGateDistance = (point?: Vec2) => {
    const progress = point ? project(point).distance : state.progressDistance;
    const gate = findNextGate(progress);
    return gate ? Math.max(0, gate.distance - progress) : Infinity;
  };

  return {
    state,
    update,
    project,
    getTrackDistance,
    getProgress,
    getNextGateDistance,
    isOnTrack,
    isInRunoff,
    nearestGate,
    nextGate: () => findNextGate(),
    consumePassedGates: () => passedGateQueue.splice(0, passedGateQueue.length),
    getColliders: () => colliders,
  };
}
