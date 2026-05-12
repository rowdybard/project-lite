import type { CarState, TrackConfig } from "../types";
import { CatmullRomCurve3, Vector3 } from "three";

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

export function createTrackColliders(track: TrackConfig): TrackColliders {
  const barriers: Barrier[] = [];
  const cones: Cone[] = [];

  if (!track.roadPath || track.roadPath.length < 4) return { barriers, cones };

  const points = track.roadPath.map((p) => new Vector3(p.x, 0, p.z));
  const curve = new CatmullRomCurve3(points, true, "catmullrom", 0.48);
  const samples = curve.getPoints(240);
  const roadWidth = 19;

  // Barriers: every 18 samples, both sides (matches trackView)
  for (let i = 4; i < samples.length; i += 18) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
    const tangent = next.clone().sub(prev).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const angle = Math.atan2(tangent.x, tangent.z);

    for (const side of [-1, 1]) {
      const pos = samples[i].clone().addScaledVector(normal, side * (roadWidth / 2 + 1.7));
      barriers.push({
        x: pos.x,
        z: pos.z,
        angle,
        halfLength: 2.6,
        halfWidth: 0.19,
      });
    }
  }

  // Cones: every 24 samples starting at 6, both sides (matches trackView)
  for (let i = 6; i < samples.length; i += 24) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const next = samples[(i + 1) % samples.length];
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

export function updateTrackCollision(car: CarState, colliders: TrackColliders, dt: number) {
  const carRadius = 1.1;
  const carX = car.position.x;
  const carZ = car.position.z;
  const carVx = car.velocity.x;
  const carVz = car.velocity.z;

  // Barrier collision — oriented box vs circle
  for (const barrier of colliders.barriers) {
    const dx = carX - barrier.x;
    const dz = carZ - barrier.z;
    const cos = Math.cos(barrier.angle);
    const sin = Math.sin(barrier.angle);

    // Transform car position into barrier's local space
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;

    // Clamp to barrier box
    const clampedX = Math.max(-barrier.halfLength, Math.min(barrier.halfLength, localX));
    const clampedZ = Math.max(-barrier.halfWidth, Math.min(barrier.halfWidth, localZ));

    // Distance from car center to nearest point on barrier
    const distX = localX - clampedX;
    const distZ = localZ - clampedZ;
    const dist = Math.hypot(distX, distZ);

    if (dist < carRadius && dist > 0.001) {
      const overlap = carRadius - dist;
      // Push direction in local space
      const pushLocalX = distX / dist;
      const pushLocalZ = distZ / dist;
      // Transform back to world
      const pushWorldX = pushLocalX * cos - pushLocalZ * sin;
      const pushWorldZ = pushLocalX * sin + pushLocalZ * cos;

      // Push car out
      car.position.x += pushWorldX * overlap;
      car.position.z += pushWorldZ * overlap;

      // Reflect velocity component along push direction (light bounce)
      const velDot = car.velocity.x * pushWorldX + car.velocity.z * pushWorldZ;
      if (velDot < 0) {
        car.velocity.x -= velDot * 1.3 * pushWorldX;
        car.velocity.z -= velDot * 1.3 * pushWorldZ;
        // Reduce speed on impact
        car.velocity.x *= 0.92;
        car.velocity.z *= 0.92;
        // Add some yaw on offset hits
        const offsetHit = (carX - barrier.x) * pushWorldZ - (carZ - barrier.z) * pushWorldX;
        car.yawVelocity += offsetHit * 0.008 * Math.abs(velDot);
      }
    }
  }

  // Cone collision — circle vs circle, cones get knocked
  for (const cone of colliders.cones) {
    const dx = carX - cone.x;
    const dz = carZ - cone.z;
    const dist = Math.hypot(dx, dz);
    const combinedRadius = carRadius + cone.radius;

    if (dist < combinedRadius && dist > 0.001) {
      const overlap = combinedRadius - dist;
      const nx = dx / dist;
      const nz = dz / dist;

      // Push cone away from car
      cone.x -= nx * overlap * 0.9;
      cone.z -= nz * overlap * 0.9;
      // Push car slightly
      car.position.x += nx * overlap * 0.1;
      car.position.z += nz * overlap * 0.1;

      // Transfer velocity to cone
      const relVelX = carVx - cone.vx;
      const relVelZ = carVz - cone.vz;
      const impactSpeed = relVelX * (-nx) + relVelZ * (-nz);

      if (impactSpeed > 0) {
        cone.vx += -nx * impactSpeed * 1.4;
        cone.vz += -nz * impactSpeed * 1.4;
        cone.spin += (Math.random() - 0.5) * impactSpeed * 3;
        cone.knocked = true;

        // Tiny speed loss for car
        car.velocity.x *= 0.98;
        car.velocity.z *= 0.98;
      }
    }
  }

  // Update cone physics (simple friction)
  for (const cone of colliders.cones) {
    if (!cone.knocked) continue;
    cone.x += cone.vx * dt;
    cone.z += cone.vz * dt;
    cone.vx *= 1 - 3.5 * dt;
    cone.vz *= 1 - 3.5 * dt;
    cone.spin *= 1 - 2.0 * dt;
    if (Math.abs(cone.vx) < 0.01 && Math.abs(cone.vz) < 0.01) {
      cone.vx = 0;
      cone.vz = 0;
    }
  }
}
