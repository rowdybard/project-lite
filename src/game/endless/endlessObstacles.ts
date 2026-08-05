import type { CarState, CarTuning, Vec2 } from "../types";
import type { EndlessTrack } from "./endlessTrack";
import type { CarPose2D, CollisionResult } from "../simulation/collisionTypes";
import { emptyCollisionResult } from "../simulation/collisionTypes";
import { resolveVehicleContact, captureCarPose } from "../simulation/collisionSolver";

// Procedural traffic obstacles for endless mode. Slow-moving cars spawn ahead
// on the track, drifting slightly. Hitting one at speed triggers crash severity.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type ObstacleCar = {
  id: number;
  position: Vec2;
  heading: number;
  speed: number;
  lateralOffset: number;
  alive: boolean;
  /** Distance along track when spawned. */
  spawnDistance: number;
  velocity: Vec2;
  yawVelocity: number;
  collisionCooldown: number;
  /** Target heading for recovery after collision. */
  targetHeading: number;
  /** Target speed for recovery after collision. */
  targetSpeed: number;
};

export type ObstacleManager = {
  readonly obstacles: readonly ObstacleCar[];
  update(track: EndlessTrack, car: CarState, dt: number): void;
  /** Returns impact severity 0..1 if the player car overlaps any obstacle. */
  checkCollision(car: CarState): number;
  /** Shared collision response using the unified solver. */
  resolveCollisions(car: CarState, previousPose: CarPose2D, tuning?: CarTuning): CollisionResult;
  reset(): void;
};

const carHalfWidth = 1.38;
const spawnDistanceAhead = 180;
const despawnDistanceBehind = 60;
const minSpawnInterval = 2.8;
const maxObstacles = 14;

function createSeededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function createObstacleManager(seed: number): ObstacleManager {
  const random = createSeededRandom(seed ^ 0x4f3a);
  const obstacles: ObstacleCar[] = [];
  let nextId = 0;
  let spawnTimer = 1.5;

  const update = (track: EndlessTrack, _car: CarState, dt: number) => {
    const progress = track.state.progressDistance;

    // Despawn obstacles behind the car.
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      if (obs.spawnDistance + 200 < progress - despawnDistanceBehind || !obs.alive) {
        obstacles.splice(i, 1);
      }
    }

    // Spawn new obstacles ahead.
    spawnTimer -= dt;
    if (spawnTimer <= 0 && obstacles.length < maxObstacles) {
      spawnTimer = minSpawnInterval + random() * 2.5;
      const targetDistance = progress + spawnDistanceAhead + random() * 80;
      const segments = track.state.segments;
      let spawnSegment = segments[segments.length - 1];
      for (const seg of segments) {
        if (seg.distance <= targetDistance && seg.endDistance >= targetDistance) {
          spawnSegment = seg;
          break;
        }
      }
      const segT = clamp((targetDistance - spawnSegment.distance) / Math.max(spawnSegment.length, 1), 0, 1);
      const centerX = spawnSegment.a.x + (spawnSegment.b.x - spawnSegment.a.x) * segT;
      const centerZ = spawnSegment.a.z + (spawnSegment.b.z - spawnSegment.a.z) * segT;
      const tangentX = Math.sin(spawnSegment.heading);
      const tangentZ = Math.cos(spawnSegment.heading);
      const normalX = -tangentZ;
      const normalZ = tangentX;
      const halfWidth = spawnSegment.roadWidth * 0.5;
      const lateralOffset = (random() - 0.5) * (halfWidth - carHalfWidth - 1.5) * 1.6;
      const speed = 6 + random() * 8;
      obstacles.push({
        id: nextId++,
        position: {
          x: centerX + normalX * lateralOffset,
          z: centerZ + normalZ * lateralOffset,
        },
        heading: spawnSegment.heading,
        speed,
        lateralOffset,
        alive: true,
        spawnDistance: targetDistance,
        velocity: {
          x: Math.sin(spawnSegment.heading) * speed,
          z: Math.cos(spawnSegment.heading) * speed,
        },
        yawVelocity: 0,
        collisionCooldown: 0,
        targetHeading: spawnSegment.heading,
        targetSpeed: speed,
      });
    }

    // Move obstacles forward along the track.
    for (const obs of obstacles) {
      // Recover heading/speed after collision
      if (obs.collisionCooldown > 0) {
        obs.collisionCooldown -= dt;
        // Smoothly recover target heading
        const headingDiff = obs.targetHeading - obs.heading;
        obs.heading += headingDiff * Math.min(1, dt * 0.8);
        // Recover target speed
        obs.speed += (obs.targetSpeed - obs.speed) * Math.min(1, dt * 0.5);
      }

      const moveDist = obs.speed * dt;
      obs.position.x += Math.sin(obs.heading) * moveDist;
      obs.position.z += Math.cos(obs.heading) * moveDist;
      // Update velocity from heading/speed
      obs.velocity.x = Math.sin(obs.heading) * obs.speed;
      obs.velocity.z = Math.cos(obs.heading) * obs.speed;
      // Apply yaw velocity
      obs.heading += obs.yawVelocity * dt;
      obs.yawVelocity *= Math.exp(-2.0 * dt);
      // Slowly drift laterally for variety.
      const drift = Math.sin(obs.id * 1.7 + track.state.progressDistance * 0.01) * 0.3 * dt;
      const tangentX = Math.sin(obs.heading);
      const tangentZ = Math.cos(obs.heading);
      const normalX = -tangentZ;
      const normalZ = tangentX;
      obs.position.x += normalX * drift;
      obs.position.z += normalZ * drift;
    }
  };

  const resolveCollisions = (
    car: CarState,
    _previousPose: CarPose2D,
    tuning?: CarTuning,
  ): CollisionResult => {
    if (!Number.isFinite(car.position.x) || !Number.isFinite(car.position.z)) {
      return emptyCollisionResult;
    }

    let strongestSeverity = 0;
    let contactCount = 0;
    const colliderIds: string[] = [];

    for (const obs of obstacles) {
      if (!obs.alive) continue;
      if (!Number.isFinite(obs.position.x) || !Number.isFinite(obs.position.z)) continue;

      const result = resolveVehicleContact(car, obs, tuning);
      if (result.severity > 0 || result.appliedNormalDelta > 0) {
        contactCount++;
        colliderIds.push(`obstacle:${obs.id}`);
        if (result.severity > strongestSeverity) strongestSeverity = result.severity;
        // Set cooldown for recovery — obstacle stays alive
        obs.collisionCooldown = 1.5;
      }
    }

    car.speed = Math.hypot(car.velocity.x, car.velocity.z);
    return { severity: strongestSeverity, contactCount, colliderIds };
  };

  // Legacy compatibility — returns severity only
  const checkCollision = (car: CarState): number => {
    return resolveCollisions(car, captureCarPose(car)).severity;
  };

  const reset = () => {
    obstacles.length = 0;
    spawnTimer = 1.5;
  };

  return { obstacles, update, checkCollision, resolveCollisions, reset };
}
