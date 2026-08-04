import type { CarState, CarTuning, TrackConfig } from "../types";

export type Barrier = {
  x: number;
  z: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
};

export type Cone = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  spin: number;
  radius: number;
  knocked: boolean;
};

export type TrackColliders = {
  barriers: Barrier[];
  cones: Cone[];
};

type CollisionCircle = {
  x: number;
  z: number;
  radius: number;
};

const defaultCarHalfLength = 3.15;
const defaultCarHalfWidth = 1.38;

export function createTrackColliders(track: TrackConfig): TrackColliders {
  const barriers: Barrier[] = [];
  if (track.id === "indoor-drift-lab" && track.roadPath?.length) {
    const padding = Math.max(48, track.roadWidth + track.boundaryMargin * 0.86);
    const minX = Math.min(...track.roadPath.map((point) => point.x)) - padding;
    const maxX = Math.max(...track.roadPath.map((point) => point.x)) + padding;
    const minZ = Math.min(...track.roadPath.map((point) => point.z)) - padding;
    const maxZ = Math.max(...track.roadPath.map((point) => point.z)) + padding;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const innerWidth = maxX - minX - 9;
    const innerDepth = maxZ - minZ - 9;
    barriers.push(
      { x: centerX, z: centerZ - innerDepth / 2, angle: 0, halfLength: innerWidth / 2, halfWidth: 0.4 },
      { x: centerX, z: centerZ + innerDepth / 2, angle: 0, halfLength: innerWidth / 2, halfWidth: 0.4 },
      { x: centerX - innerWidth / 2, z: centerZ, angle: Math.PI / 2, halfLength: innerDepth / 2, halfWidth: 0.4 },
      { x: centerX + innerWidth / 2, z: centerZ, angle: Math.PI / 2, halfLength: innerDepth / 2, halfWidth: 0.4 },
    );

    const pit = track.practiceAreas?.find((area) => area.type === "rect");
    if (pit?.type === "rect") {
      const angle = pit.heading ?? 0;
      const normalX = Math.sin(angle);
      const normalZ = Math.cos(angle);
      const depth = 12.2;
      const width = Math.min(96, pit.width - 18);
      const offset = -(pit.depth / 2 - depth / 2 - 1.2);
      barriers.push({
        x: pit.x + normalX * offset,
        z: pit.z + normalZ * offset,
        angle,
        halfLength: width / 2,
        halfWidth: depth / 2,
      });
    }

    const start = track.roadPath[0];
    const next = track.roadPath[1];
    const length = Math.hypot(next.x - start.x, next.z - start.z) || 1;
    const tangentX = (next.x - start.x) / length;
    const tangentZ = (next.z - start.z) / length;
    const normalX = -tangentZ;
    const normalZ = tangentX;
    const angle = Math.atan2(-tangentZ, tangentX);
    for (const side of [-1, 1]) {
      barriers.push({
        x: track.start.x + tangentX * 13 + normalX * side * (track.roadWidth / 2 + 1.55),
        z: track.start.z + tangentZ * 13 + normalZ * side * (track.roadWidth / 2 + 1.55),
        angle,
        halfLength: 0.32,
        halfWidth: 0.32,
      });
    }
  }

  // Cones and corner markers remain visual-only so they cannot create phantom blockers.
  return { barriers, cones: [] };
}

function getCarCollisionCircles(car: CarState, tuning?: CarTuning): CollisionCircle[] {
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const carHalfLength = Math.max(2.35, (tuning?.collisionLength ?? defaultCarHalfLength * 2) / 2);
  const carHalfWidth = Math.max(1.08, (tuning?.collisionWidth ?? defaultCarHalfWidth * 2) / 2);
  const bumperOffset = carHalfLength * 0.7;

  return [
    {
      x: car.position.x + forwardX * bumperOffset,
      z: car.position.z + forwardZ * bumperOffset,
      radius: carHalfWidth * 0.94,
    },
    {
      x: car.position.x,
      z: car.position.z,
      radius: carHalfWidth,
    },
    {
      x: car.position.x - forwardX * bumperOffset,
      z: car.position.z - forwardZ * bumperOffset,
      radius: carHalfWidth * 0.94,
    },
  ];
}

function resolveBarrierCircle(car: CarState, barrier: Barrier, circle: CollisionCircle) {
  const dx = circle.x - barrier.x;
  const dz = circle.z - barrier.z;
  const cos = Math.cos(barrier.angle);
  const sin = Math.sin(barrier.angle);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const clampedX = Math.max(-barrier.halfLength, Math.min(barrier.halfLength, localX));
  const clampedZ = Math.max(-barrier.halfWidth, Math.min(barrier.halfWidth, localZ));
  const distX = localX - clampedX;
  const distZ = localZ - clampedZ;
  const dist = Math.hypot(distX, distZ);

  let pushLocalX = 0;
  let pushLocalZ = 0;
  let overlap = 0;

  if (dist > 0.001) {
    if (dist >= circle.radius) return 0;
    pushLocalX = distX / dist;
    pushLocalZ = distZ / dist;
    overlap = circle.radius - dist;
  } else {
    const xPenetration = barrier.halfLength + circle.radius - Math.abs(localX);
    const zPenetration = barrier.halfWidth + circle.radius - Math.abs(localZ);
    if (xPenetration <= 0 || zPenetration <= 0) return 0;

    if (xPenetration < zPenetration) {
      pushLocalX = localX < 0 ? -1 : 1;
      overlap = xPenetration;
    } else {
      pushLocalZ = localZ < 0 ? -1 : 1;
      overlap = zPenetration;
    }
  }

  const pushWorldX = pushLocalX * cos - pushLocalZ * sin;
  const pushWorldZ = pushLocalX * sin + pushLocalZ * cos;
  car.position.x += pushWorldX * overlap * 0.72;
  car.position.z += pushWorldZ * overlap * 0.72;

  const normalSpeed = car.velocity.x * pushWorldX + car.velocity.z * pushWorldZ;
  if (normalSpeed < 0) {
    car.velocity.x -= normalSpeed * 1.18 * pushWorldX;
    car.velocity.z -= normalSpeed * 1.18 * pushWorldZ;
    car.velocity.x *= 0.86;
    car.velocity.z *= 0.86;

    const leverX = circle.x - car.position.x;
    const leverZ = circle.z - car.position.z;
    const hitOffset = leverX * pushWorldZ - leverZ * pushWorldX;
    car.yawVelocity += hitOffset * Math.abs(normalSpeed) * 0.012;
    return Math.min(1, Math.abs(normalSpeed) / 18);
  }
  return 0;
}

export function updateTrackCollision(car: CarState, colliders: TrackColliders, dt: number, tuning?: CarTuning) {
  let strongestImpact = 0;
  for (const barrier of colliders.barriers) {
    for (const circle of getCarCollisionCircles(car, tuning)) {
      strongestImpact = Math.max(strongestImpact, resolveBarrierCircle(car, barrier, circle));
    }
  }

  for (const cone of colliders.cones) {
    let bestCircle: CollisionCircle | null = null;
    let bestDistance = Infinity;

    for (const circle of getCarCollisionCircles(car, tuning)) {
      const distance = Math.hypot(circle.x - cone.x, circle.z - cone.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCircle = circle;
      }
    }

    if (!bestCircle) continue;
    const combinedRadius = bestCircle.radius + cone.radius;
    if (bestDistance >= combinedRadius || bestDistance <= 0.001) continue;

    const nx = (bestCircle.x - cone.x) / bestDistance;
    const nz = (bestCircle.z - cone.z) / bestDistance;
    const overlap = combinedRadius - bestDistance;

    cone.x -= nx * overlap * 0.9;
    cone.z -= nz * overlap * 0.9;
    car.position.x += nx * overlap * 0.06;
    car.position.z += nz * overlap * 0.06;

    const relVelX = car.velocity.x - cone.vx;
    const relVelZ = car.velocity.z - cone.vz;
    const impactSpeed = relVelX * (-nx) + relVelZ * (-nz);

    if (impactSpeed > 0) {
      cone.vx += -nx * impactSpeed * 1.4;
      cone.vz += -nz * impactSpeed * 1.4;
      cone.spin += (Math.random() - 0.5) * impactSpeed * 3;
      cone.knocked = true;
      car.velocity.x *= 0.985;
      car.velocity.z *= 0.985;
      strongestImpact = Math.max(strongestImpact, Math.min(0.52, impactSpeed / 26));
    }
  }

  for (const cone of colliders.cones) {
    if (!cone.knocked) continue;
    cone.x += cone.vx * dt;
    cone.z += cone.vz * dt;
    cone.vx *= 1 - 3.5 * dt;
    cone.vz *= 1 - 3.5 * dt;
    cone.spin *= 1 - 2 * dt;
    if (Math.abs(cone.vx) < 0.01 && Math.abs(cone.vz) < 0.01) {
      cone.vx = 0;
      cone.vz = 0;
    }
  }

  car.speed = Math.hypot(car.velocity.x, car.velocity.z);
  return strongestImpact;
}
