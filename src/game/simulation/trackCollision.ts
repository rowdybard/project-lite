import { CatmullRomCurve3, Vector3 } from "three";
import type { CarState, CarTuning, TrackConfig } from "../types";
import { getRoadWidth, isTracksideClearZone } from "./trackLayout";

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
  const cones: Cone[] = [];

  if (!track.roadPath || track.roadPath.length < 4) return { barriers, cones };

  const points = track.roadPath.map((p) => new Vector3(p.x, 0, p.z));
  const curve = new CatmullRomCurve3(points, true, "catmullrom", 0.48);
  const samples = curve.getPoints(240);
  const roadWidth = getRoadWidth(track);

  for (let i = 6; i < samples.length; i += 24) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    if (isTracksideClearZone({ x: samples[i].x, z: samples[i].z }, track)) continue;

    const tangent = next.clone().sub(prev).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);

    for (const side of [-1, 1]) {
      const pos = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 2.4));
      cones.push({
        x: pos.x,
        z: pos.z,
        vx: 0,
        vz: 0,
        spin: 0,
        radius: 0.38,
        knocked: false,
      });
    }
  }

  return { barriers, cones };
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
    if (dist >= circle.radius) return;
    pushLocalX = distX / dist;
    pushLocalZ = distZ / dist;
    overlap = circle.radius - dist;
  } else {
    const xPenetration = barrier.halfLength + circle.radius - Math.abs(localX);
    const zPenetration = barrier.halfWidth + circle.radius - Math.abs(localZ);
    if (xPenetration <= 0 || zPenetration <= 0) return;

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
  }
}

export function updateTrackCollision(car: CarState, colliders: TrackColliders, dt: number, tuning?: CarTuning) {
  for (const barrier of colliders.barriers) {
    for (const circle of getCarCollisionCircles(car, tuning)) {
      resolveBarrierCircle(car, barrier, circle);
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
}
