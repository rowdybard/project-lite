import type { CarState, CarTuning } from "../types";
import type {
  CarPose2D,
  CollisionResult,
} from "./collisionTypes";
import type { CollisionWorld } from "./collisionWorld";
import {
  getCarCollisionCircles,
  resolveStaticCollisions,
} from "./collisionSolver";

// ---------------------------------------------------------------------------
// Compatibility types — still exported for callers that reference them
// ---------------------------------------------------------------------------

export type Barrier = {
  x: number;
  z: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
  cameraObstruction?: boolean;
};

export type Cone = {
  id: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  spin: number;
  angularVelocity: number;
  radius: number;
  knocked: boolean;
};

export type TrackColliders = {
  barriers: Barrier[];
  cones: Cone[];
};

// ---------------------------------------------------------------------------
// Cone resolution — deterministic, gentle
// ---------------------------------------------------------------------------

function resolveConeContact(
  car: CarState,
  cone: Cone,
  tuning: CarTuning | undefined,
): number {
  const circles = getCarCollisionCircles(
    { x: car.position.x, z: car.position.z, heading: car.heading },
    tuning,
  );

  // Choose the closest car circle to the cone
  let bestCircle = circles[0];
  let bestDist = Infinity;
  for (const circle of circles) {
    const d = Math.hypot(circle.x - cone.x, circle.z - cone.z);
    if (d < bestDist) {
      bestDist = d;
      bestCircle = circle;
    }
  }

  const combined = bestCircle.radius + cone.radius;
  if (bestDist >= combined || bestDist <= 0.001) return 0;

  const nx = (bestCircle.x - cone.x) / bestDist;
  const nz = (bestCircle.z - cone.z) / bestDist;
  const overlap = combined - bestDist;

  // Push cone out by 90% of penetration, car by 10%
  cone.x -= nx * overlap * 0.9;
  cone.z -= nz * overlap * 0.9;
  car.position.x += nx * overlap * 0.1;
  car.position.z += nz * overlap * 0.1;

  // Relative velocity
  const relX = car.velocity.x - cone.vx;
  const relZ = car.velocity.z - cone.vz;
  // Normal pointing from cone toward car (nx, nz)
  // Contact normal for impulse: from car toward cone = (-nx, -nz)
  const relativeNormalSpeed = relX * (-nx) + relZ * (-nz);

  if (relativeNormalSpeed > 0) {
    const coneImpulse = relativeNormalSpeed * 1.35;
    cone.vx -= nx * coneImpulse;
    cone.vz -= nz * coneImpulse;

    const carNormalLoss = relativeNormalSpeed * 0.04;
    car.velocity.x += nx * carNormalLoss;
    car.velocity.z += nz * carNormalLoss;

    // Deterministic spin direction based on contact offset cross product
    const contactOffsetX = bestCircle.x - car.position.x;
    const contactOffsetZ = bestCircle.z - car.position.z;
    const cross = contactOffsetX * nz - contactOffsetZ * nx;
    const direction =
      Math.abs(cross) > 0.001
        ? Math.sign(cross)
        : cone.id.length % 2 === 0
          ? 1
          : -1;

    cone.angularVelocity += direction * relativeNormalSpeed * 0.4;
    cone.spin += direction * relativeNormalSpeed * 0.3;
    cone.knocked = true;

    return Math.min(0.52, relativeNormalSpeed / 34);
  }

  return 0;
}

function integrateCones(cones: Cone[], dt: number) {
  const velocityDamping = Math.exp(-3.5 * dt);
  const angularDamping = Math.exp(-2.0 * dt);

  for (const cone of cones) {
    if (!cone.knocked) continue;
    cone.x += cone.vx * dt;
    cone.z += cone.vz * dt;
    cone.vx *= velocityDamping;
    cone.vz *= velocityDamping;
    cone.spin *= angularDamping;
    cone.angularVelocity *= angularDamping;
    if (Math.abs(cone.vx) < 0.01 && Math.abs(cone.vz) < 0.01) {
      cone.vx = 0;
      cone.vz = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Main export — replaces updateTrackCollision()
// ---------------------------------------------------------------------------

export function resolveTrackCollisions(
  car: CarState,
  previousPose: CarPose2D,
  world: CollisionWorld,
  cones: Cone[],
  dt: number,
  tuning?: CarTuning,
): CollisionResult {
  // Query nearby static colliders
  const padding = 0.5;
  const minX = Math.min(previousPose.x, car.position.x) - 4 - padding;
  const minZ = Math.min(previousPose.z, car.position.z) - 4 - padding;
  const maxX = Math.max(previousPose.x, car.position.x) + 4 + padding;
  const maxZ = Math.max(previousPose.z, car.position.z) + 4 + padding;

  const nearby = world.queryAabb(minX, minZ, maxX, maxZ);

  // Resolve static colliders (sweep + penetration)
  const staticResult = resolveStaticCollisions(car, previousPose, nearby, tuning);

  // Resolve cones
  let coneSeverity = 0;
  let coneContactCount = 0;
  for (const cone of cones) {
    const severity = resolveConeContact(car, cone, tuning);
    if (severity > 0) {
      coneContactCount++;
      if (severity > coneSeverity) coneSeverity = severity;
    }
  }

  // Integrate cone physics
  integrateCones(cones, dt);

  // Recompute car speed
  car.speed = Math.hypot(car.velocity.x, car.velocity.z);

  const severity = Math.max(staticResult.severity, coneSeverity);
  const contactCount = staticResult.contactCount + coneContactCount;
  const colliderIds = [...staticResult.colliderIds];

  return { severity, contactCount, colliderIds };
}

// ---------------------------------------------------------------------------
// Compatibility — old createTrackColliders is now a no-op stub.
// Callers should use the view-owned collision world instead.
// ---------------------------------------------------------------------------

export function createTrackColliders(): TrackColliders {
  return { barriers: [], cones: [] };
}
