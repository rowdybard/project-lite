import type { Barrier, TrackColliders } from "../simulation/trackCollision";
import type { CarState, CarTuning } from "../types";
import type { Vec2 } from "../types";
import type { CarPose2D, CollisionResult } from "../simulation/collisionTypes";
import { collisionResponses, emptyCollisionResult } from "../simulation/collisionTypes";
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
  scoringShoulder: 5,
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
  /** Centerline-distance guardrail pushback. Returns impact severity 0..1. */
  resolveGuardrail(car: CarState, previousPose: CarPose2D, tuning?: CarTuning): CollisionResult;
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
    // Guardrail collision is now handled by resolveGuardrail() using centerline
    // projection, not box barriers. Keep the barriers array empty so
    // updateTrackCollision (used for cones) doesn't process stale boxes.
    colliders.barriers.length = 0;
  };

  const project = (point: Vec2): TrackProjection => {
    if (segments.length === 0) throw new Error("Endless track has no generated segments.");
    // If the point is non-finite, return the last segment's projection as a
    // safe fallback so downstream code doesn't propagate NaN.
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      const fallback = segments[segments.length - 1];
      return {
        point: { x: fallback.b.x, z: fallback.b.z },
        distance: fallback.endDistance,
        lateralDistance: 0,
        signedLateralDistance: 0,
        heading: fallback.heading,
        roadWidth: fallback.roadWidth,
        segment: fallback,
        segmentT: 1,
      };
    }
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
    // Guard against NaN car positions — if the car is at NaN, keep the last
    // known good progress so the track keeps streaming and the run can end
    // gracefully instead of freezing.
    if (Number.isFinite(projection.distance)) {
      state.progressDistance = Math.max(state.progressDistance, projection.distance);
    }
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

  const resolveGuardrail = (
    car: CarState,
    previousPose: CarPose2D,
    tuning?: CarTuning,
  ): CollisionResult => {
    const response = collisionResponses.guardrail;
    const carHalfWidth = Math.max(1.08, (tuning?.collisionWidth ?? 2.76) * 0.5);

    const prevProjection = project(previousPose);
    const prevLateral = prevProjection.signedLateralDistance;
    const prevAbsLateral = Math.abs(prevLateral);

    const projection = project(car.position);
    const halfWidth = projection.roadWidth * 0.5;
    const edge = halfWidth + config.guardrailEdgeOffset;
    const lateral = projection.signedLateralDistance;
    const absLateral = Math.abs(lateral);

    if (!Number.isFinite(absLateral)) return emptyCollisionResult;

    const limit = edge - carHalfWidth;

    // Sweep check: if previous was inside and current crossed the limit
    if (prevAbsLateral <= limit && absLateral > limit) {
      const crossingT = (limit - prevAbsLateral) / Math.max(absLateral - prevAbsLateral, 0.001);
      const safeT = Math.max(0, crossingT - 0.01 / Math.max(absLateral - prevAbsLateral, 0.001));
      const side = lateral >= 0 ? 1 : -1;
      const tangentX = Math.sin(projection.heading);
      const tangentZ = Math.cos(projection.heading);
      const normalX = -tangentZ;
      const normalZ = tangentX;
      const dx = car.position.x - previousPose.x;
      const dz = car.position.z - previousPose.z;
      car.position.x = previousPose.x + dx * safeT;
      car.position.z = previousPose.z + dz * safeT;
      const inwardX = -normalX * side;
      const inwardZ = -normalZ * side;
      const normalSpeed = car.velocity.x * inwardX + car.velocity.z * inwardZ;
      if (normalSpeed < -response.bounceThreshold) {
        const closingSpeed = -normalSpeed;
        const bounceSpeed = Math.min(response.maxBounceSpeed, closingSpeed * response.restitution);
        const tangentVX = car.velocity.x - normalSpeed * inwardX;
        const tangentVZ = car.velocity.z - normalSpeed * inwardZ;
        car.velocity.x = tangentVX * response.tangentRetention + inwardX * bounceSpeed;
        car.velocity.z = tangentVZ * response.tangentRetention + inwardZ * bounceSpeed;
        const severity = clamp(
          (closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
          0,
          1,
        );
        car.speed = Math.hypot(car.velocity.x, car.velocity.z);
        return { severity, contactCount: 1, colliderIds: ["guardrail"] };
      }
      car.speed = Math.hypot(car.velocity.x, car.velocity.z);
      return emptyCollisionResult;
    }

    if (absLateral <= limit) return emptyCollisionResult;

    // Car is outside — push inward
    const side = lateral >= 0 ? 1 : -1;
    const overshoot = absLateral - limit;
    const tangentX = Math.sin(projection.heading);
    const tangentZ = Math.cos(projection.heading);
    const normalX = -tangentZ;
    const normalZ = tangentX;
    const inwardX = -normalX * side;
    const inwardZ = -normalZ * side;

    const correction = Math.min(
      response.maxCorrection,
      Math.max(0, overshoot - response.correctionSlop) * response.correctionPercent,
    );
    car.position.x += inwardX * correction;
    car.position.z += inwardZ * correction;

    const normalSpeed = car.velocity.x * inwardX + car.velocity.z * inwardZ;
    if (normalSpeed < -response.bounceThreshold) {
      const closingSpeed = -normalSpeed;
      const bounceSpeed = Math.min(response.maxBounceSpeed, closingSpeed * response.restitution);
      const tangentVX = car.velocity.x - normalSpeed * inwardX;
      const tangentVZ = car.velocity.z - normalSpeed * inwardZ;
      car.velocity.x = tangentVX * response.tangentRetention + inwardX * bounceSpeed;
      car.velocity.z = tangentVZ * response.tangentRetention + inwardZ * bounceSpeed;

      const lever = (projection.point.x - car.position.x) * inwardZ - (projection.point.z - car.position.z) * inwardX;
      const yawDelta = clamp(
        lever * bounceSpeed * response.yawImpulseScale,
        -response.maxYawImpulse,
        response.maxYawImpulse,
      );
      car.yawVelocity += yawDelta;

      const severity = clamp(
        (closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
        0,
        1,
      );
      car.speed = Math.hypot(car.velocity.x, car.velocity.z);
      return { severity, contactCount: 1, colliderIds: ["guardrail"] };
    }

    car.speed = Math.hypot(car.velocity.x, car.velocity.z);
    return emptyCollisionResult;
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
    resolveGuardrail,
  };
}
