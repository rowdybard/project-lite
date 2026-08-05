import type { CarState } from "../types";
import type { EndlessTrack } from "./endlessTrack";
import type { Vec2 } from "../types";

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
};

export type ObstacleManager = {
  readonly obstacles: readonly ObstacleCar[];
  update(track: EndlessTrack, car: CarState, dt: number): void;
  /** Returns impact severity 0..1 if the player car overlaps any obstacle. */
  checkCollision(car: CarState): number;
  reset(): void;
};

const carHalfLength = 3.15;
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
      // Find a segment ahead on the track to spawn on.
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
      obstacles.push({
        id: nextId++,
        position: {
          x: centerX + normalX * lateralOffset,
          z: centerZ + normalZ * lateralOffset,
        },
        heading: spawnSegment.heading,
        speed: 6 + random() * 8,
        lateralOffset,
        alive: true,
        spawnDistance: targetDistance,
      });
    }

    // Move obstacles forward along the track.
    for (const obs of obstacles) {
      const moveDist = obs.speed * dt;
      // Move along heading.
      obs.position.x += Math.sin(obs.heading) * moveDist;
      obs.position.z += Math.cos(obs.heading) * moveDist;
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

  const checkCollision = (car: CarState): number => {
    let strongest = 0;
    if (!Number.isFinite(car.position.x) || !Number.isFinite(car.position.z)) return 0;
    for (const obs of obstacles) {
      if (!obs.alive) continue;
      if (!Number.isFinite(obs.position.x) || !Number.isFinite(obs.position.z)) continue;
      const dx = car.position.x - obs.position.x;
      const dz = car.position.z - obs.position.z;
      const dist = Math.hypot(dx, dz);
      const combinedRadius = carHalfLength + carHalfWidth;
      if (dist > combinedRadius * 1.4) continue;

      // OBB-ish check: project onto obstacle's heading.
      const cos = Math.cos(obs.heading);
      const sin = Math.sin(obs.heading);
      const localX = dx * sin + dz * cos;
      const localZ = -dx * cos + dz * sin;
      const overlapX = carHalfLength + carHalfLength - Math.abs(localX);
      const overlapZ = carHalfWidth + carHalfWidth - Math.abs(localZ);
      if (overlapX <= 0 || overlapZ <= 0) continue;

      // Collision! Push the player car back.
      const pushX = dx / (dist || 1);
      const pushZ = dz / (dist || 1);
      const pushAmount = Math.min(overlapX, overlapZ) * 0.5;
      car.position.x += pushX * pushAmount;
      car.position.z += pushZ * pushAmount;

      const normalSpeed = car.velocity.x * pushX + car.velocity.z * pushZ;
      if (normalSpeed < 0) {
        car.velocity.x -= normalSpeed * 1.3 * pushX;
        car.velocity.z -= normalSpeed * 1.3 * pushZ;
        car.velocity.x *= 0.82;
        car.velocity.z *= 0.82;
        const impact = Math.min(1, Math.abs(normalSpeed) / 16);
        if (impact > strongest) strongest = impact;
      }

      // Mark obstacle as hit so it despawns.
      if (strongest > 0.3) obs.alive = false;
    }
    return strongest;
  };

  const reset = () => {
    obstacles.length = 0;
    spawnTimer = 1.5;
  };

  return { obstacles, update, checkCollision, reset };
}
