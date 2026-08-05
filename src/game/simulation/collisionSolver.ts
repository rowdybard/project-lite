import type { CarState, CarTuning } from "../types";
import type {
  BoxCollider,
  CarPose2D,
  CircleCollider,
  CollisionContact,
  CollisionResponse,
  CollisionResult,
  StaticCollider,
} from "./collisionTypes";
import { collisionResponses, emptyCollisionResult } from "./collisionTypes";

const __DEV__ = import.meta.env?.DEV ?? false;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

// ---------------------------------------------------------------------------
// Car collision circles
// ---------------------------------------------------------------------------

export type CarCollisionCircle = {
  x: number;
  z: number;
  radius: number;
  localForwardOffset: number;
};

export function getCarCollisionCircles(
  pose: CarPose2D,
  tuning?: CarTuning,
): CarCollisionCircle[] {
  const halfLength = Math.max(
    2.35,
    (tuning?.collisionLength ?? 6.3) * 0.5,
  );
  const halfWidth = Math.max(
    1.08,
    (tuning?.collisionWidth ?? 2.76) * 0.5,
  );

  const centerRadius = halfWidth * 0.96;
  const endRadius = halfWidth * 0.90;
  const endOffset = Math.max(0, halfLength - endRadius);

  const forwardX = Math.sin(pose.heading);
  const forwardZ = Math.cos(pose.heading);

  return [
    {
      x: pose.x + forwardX * endOffset,
      z: pose.z + forwardZ * endOffset,
      radius: endRadius,
      localForwardOffset: endOffset,
    },
    {
      x: pose.x,
      z: pose.z,
      radius: centerRadius,
      localForwardOffset: 0,
    },
    {
      x: pose.x - forwardX * endOffset,
      z: pose.z - forwardZ * endOffset,
      radius: endRadius,
      localForwardOffset: -endOffset,
    },
  ];
}

export function captureCarPose(car: CarState): CarPose2D {
  return {
    x: car.position.x,
    z: car.position.z,
    heading: car.heading,
  };
}

// ---------------------------------------------------------------------------
// Contact functions
// ---------------------------------------------------------------------------

/**
 * Circle vs oriented box. Returns contact with normal pointing from box toward circle.
 * Returns null if no overlap.
 */
export function circleVsBoxContact(
  circle: { x: number; z: number; radius: number },
  box: BoxCollider,
): { normal: { x: number; z: number }; point: { x: number; z: number }; penetration: number } | null {
  const dx = circle.x - box.x;
  const dz = circle.z - box.z;
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  // World → local (box frame): localX along halfLength, localZ along halfWidth
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;

  const clampedX = clamp(localX, -box.halfLength, box.halfLength);
  const clampedZ = clamp(localZ, -box.halfWidth, box.halfWidth);

  const distX = localX - clampedX;
  const distZ = localZ - clampedZ;
  const distSq = distX * distX + distZ * distZ;

  if (distSq > 0.000001) {
    const dist = Math.sqrt(distSq);
    if (dist >= circle.radius) return null;
    // Local normal
    const lnx = distX / dist;
    const lnz = distZ / dist;
    // Transform local normal → world
    const nx = lnx * cos - lnz * sin;
    const nz = lnx * sin + lnz * cos;
    const penetration = circle.radius - dist;
    // Contact point on box surface
    const worldPointX = box.x + clampedX * cos - clampedZ * sin;
    const worldPointZ = box.z + clampedX * sin + clampedZ * cos;
    return {
      normal: { x: nx, z: nz },
      point: { x: worldPointX, z: worldPointZ },
      penetration,
    };
  }

  // Circle center is inside the box — choose nearest exit face
  const penX = box.halfLength + circle.radius - Math.abs(localX);
  const penZ = box.halfWidth + circle.radius - Math.abs(localZ);
  if (penX <= 0 && penZ <= 0) return null;

  let lnx = 0;
  let lnz = 0;
  let penetration = 0;

  if (penX < penZ || penZ <= 0) {
    lnx = localX < 0 ? -1 : 1;
    penetration = penX;
  } else {
    lnz = localZ < 0 ? -1 : 1;
    penetration = penZ;
  }

  const nx = lnx * cos - lnz * sin;
  const nz = lnx * sin + lnz * cos;
  const worldPointX = box.x + clampedX * cos - clampedZ * sin;
  const worldPointZ = box.z + clampedX * sin + clampedZ * cos;
  return {
    normal: { x: nx, z: nz },
    point: { x: worldPointX, z: worldPointZ },
    penetration,
  };
}

/**
 * Circle vs circle. Normal points from other toward car circle.
 */
export function circleVsCircleContact(
  circle: { x: number; z: number; radius: number },
  other: { x: number; z: number; radius: number },
): { normal: { x: number; z: number }; point: { x: number; z: number }; penetration: number } | null {
  const dx = circle.x - other.x;
  const dz = circle.z - other.z;
  const distSq = dx * dx + dz * dz;
  const combined = circle.radius + other.radius;
  if (distSq >= combined * combined) return null;

  const dist = Math.sqrt(distSq);
  if (dist < 0.000001) {
    // Degenerate — push along +x
    return {
      normal: { x: 1, z: 0 },
      point: { x: other.x, z: other.z },
      penetration: combined,
    };
  }

  const nx = dx / dist;
  const nz = dz / dist;
  return {
    normal: { x: nx, z: nz },
    point: { x: other.x + nx * other.radius, z: other.z + nz * other.radius },
    penetration: combined - dist,
  };
}

// ---------------------------------------------------------------------------
// Sweep functions (for thin walls / high speed)
// ---------------------------------------------------------------------------

/**
 * Sweep a circle (moving from prev to cur) vs an oriented box.
 * Returns the earliest t in [0,1] where the circle first touches the box,
 * along with the contact normal (pointing from box toward circle).
 */
export function sweepCircleVsBox(
  prevX: number,
  prevZ: number,
  curX: number,
  curZ: number,
  radius: number,
  box: BoxCollider,
): { t: number; normal: { x: number; z: number }; point: { x: number; z: number } } | null {
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);

  // Transform prev/cur into box-local space
  const dpx = prevX - box.x;
  const dpz = prevZ - box.z;
  const plx = dpx * cos + dpz * sin;
  const plz = -dpx * sin + dpz * cos;

  const dcx = curX - box.x;
  const dcz = curZ - box.z;
  const clx = dcx * cos + dcz * sin;
  const clz = -dcx * sin + dcz * cos;

  // Expanded box half-extents
  const ex = box.halfLength + radius;
  const ez = box.halfWidth + radius;

  // Segment direction in local space
  const dx = clx - plx;
  const dz = clz - plz;

  // Slab intersection
  let tmin = 0;
  let tmax = 1;
  let hitAxis = 0; // 0 = X face, 1 = Z face
  let hitSign = 1;

  // X slab
  if (Math.abs(dx) < 1e-10) {
    if (plx < -ex || plx > ex) return null;
  } else {
    const t1 = (-ex - plx) / dx;
    const t2 = (ex - plx) / dx;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tmin) {
      tmin = lo;
      hitAxis = 0;
      hitSign = dx > 0 ? -1 : 1;
    }
    if (hi < tmax) tmax = hi;
    if (tmin > tmax) return null;
  }

  // Z slab
  if (Math.abs(dz) < 1e-10) {
    if (plz < -ez || plz > ez) return null;
  } else {
    const t1 = (-ez - plz) / dz;
    const t2 = (ez - plz) / dz;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tmin) {
      tmin = lo;
      hitAxis = 1;
      hitSign = dz > 0 ? -1 : 1;
    }
    if (hi < tmax) tmax = hi;
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > 1) return null;

  // Local normal
  let lnx = 0;
  let lnz = 0;
  if (hitAxis === 0) lnx = hitSign;
  else lnz = hitSign;

  // Transform normal → world
  const nx = lnx * cos - lnz * sin;
  const nz = lnx * sin + lnz * cos;

  // Contact point at the hit position in world
  const hitLx = plx + dx * tmin;
  const hitLz = plz + dz * tmin;
  const worldPointX = box.x + hitLx * cos - hitLz * sin;
  const worldPointZ = box.z + hitLx * sin + hitLz * cos;

  return { t: tmin, normal: { x: nx, z: nz }, point: { x: worldPointX, z: worldPointZ } };
}

/**
 * Sweep a circle (moving from prev to cur) vs another circle.
 */
export function sweepCircleVsCircle(
  prevX: number,
  prevZ: number,
  curX: number,
  curZ: number,
  radius: number,
  other: { x: number; z: number; radius: number },
): { t: number; normal: { x: number; z: number }; point: { x: number; z: number } } | null {
  const dx = curX - prevX;
  const dz = curZ - prevZ;
  const fx = prevX - other.x;
  const fz = prevZ - other.z;

  const combined = radius + other.radius;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) {
    // No movement — check static overlap
    const distSq = fx * fx + fz * fz;
    if (distSq < combined * combined) {
      const dist = Math.sqrt(distSq) || 0.0001;
      return {
        t: 0,
        normal: { x: fx / dist, z: fz / dist },
        point: { x: other.x, z: other.z },
      };
    }
    return null;
  }

  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - combined * combined;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  if (t1 < 0 || t1 > 1) return null;

  // Contact point on other circle surface
  const hitX = prevX + dx * t1;
  const hitZ = prevZ + dz * t1;
  const nx = (hitX - other.x);
  const nz = (hitZ - other.z);
  const nlen = Math.hypot(nx, nz) || 0.0001;

  return {
    t: t1,
    normal: { x: nx / nlen, z: nz / nlen },
    point: { x: other.x + (nx / nlen) * other.radius, z: other.z + (nz / nlen) * other.radius },
  };
}

// ---------------------------------------------------------------------------
// Velocity response
// ---------------------------------------------------------------------------

type VelocityResponseResult = {
  closingSpeed: number;
  appliedNormalDelta: number;
};

function applyGentleVelocityResponse(
  car: CarState,
  contact: CollisionContact,
  response: CollisionResponse,
): VelocityResponseResult {
  const relativeX = car.velocity.x - contact.otherVelocity.x;
  const relativeZ = car.velocity.z - contact.otherVelocity.z;

  const normalSpeed =
    relativeX * contact.normal.x + relativeZ * contact.normal.z;

  // Separating or resting: position correction only.
  if (normalSpeed >= -0.05) {
    return { closingSpeed: 0, appliedNormalDelta: 0 };
  }

  const closingSpeed = -normalSpeed;

  const bounceSpeed =
    closingSpeed >= response.bounceThreshold
      ? Math.min(
          response.maxBounceSpeed,
          closingSpeed * response.restitution,
        )
      : 0;

  const tangentX = relativeX - normalSpeed * contact.normal.x;
  const tangentZ = relativeZ - normalSpeed * contact.normal.z;

  // New relative velocity: tangent (retained) + normal (bounce outward)
  const newRelX = tangentX * response.tangentRetention + contact.normal.x * bounceSpeed;
  const newRelZ = tangentZ * response.tangentRetention + contact.normal.z * bounceSpeed;

  // Delta to apply to car velocity
  const deltaX = newRelX - relativeX;
  const deltaZ = newRelZ - relativeZ;

  car.velocity.x += deltaX;
  car.velocity.z += deltaZ;

  // appliedNormalDelta = how much normal velocity changed (positive = outward)
  const newNormalSpeed = car.velocity.x * contact.normal.x + car.velocity.z * contact.normal.z - contact.otherVelocity.x * contact.normal.x - contact.otherVelocity.z * contact.normal.z;
  const appliedNormalDeltaActual = newNormalSpeed - normalSpeed;

  return { closingSpeed, appliedNormalDelta: Math.max(0, appliedNormalDeltaActual) };
}

// ---------------------------------------------------------------------------
// Full solver: static colliders
// ---------------------------------------------------------------------------

// Scratch contact — reused to avoid per-step allocation
const _contact: CollisionContact = {
  colliderId: "",
  normal: { x: 0, z: 0 },
  point: { x: 0, z: 0 },
  penetration: 0,
  carCircleOffset: 0,
  profile: "wall",
  otherVelocity: { x: 0, z: 0 },
  swept: false,
};

function fillContact(
  colliderId: string,
  nx: number,
  nz: number,
  px: number,
  pz: number,
  penetration: number,
  circleOffset: number,
  profile: CollisionContact["profile"],
  swept: boolean,
): CollisionContact {
  _contact.colliderId = colliderId;
  _contact.normal.x = nx;
  _contact.normal.z = nz;
  _contact.point.x = px;
  _contact.point.z = pz;
  _contact.penetration = penetration;
  _contact.carCircleOffset = circleOffset;
  _contact.profile = profile;
  _contact.swept = swept;
  _contact.otherVelocity.x = 0;
  _contact.otherVelocity.z = 0;
  return _contact;
}

const MAX_POSITION_ITERATIONS = 4;

/**
 * Resolve static collider contacts for the car.
 * Returns the strongest severity and contact count.
 */
export function resolveStaticCollisions(
  car: CarState,
  previousPose: CarPose2D,
  colliders: readonly StaticCollider[],
  tuning?: CarTuning,
): CollisionResult {
  if (colliders.length === 0) return emptyCollisionResult;

  let strongestSeverity = 0;
  const contactedIds = new Set<string>();
  let contactCount = 0;

  // --- Sweep phase (only when moving fast enough) ---
  const moveDist = Math.hypot(
    car.position.x - previousPose.x,
    car.position.z - previousPose.z,
  );

  if (moveDist > 0.08) {
    let earliestT = 1;
    let earliestHit: {
      collider: StaticCollider;
      normal: { x: number; z: number };
      point: { x: number; z: number };
    } | null = null;

    for (const collider of colliders) {
      if (collider.shape === "box") {
        // Sweep the front circle (most likely to hit first)
        const circles = getCarCollisionCircles(previousPose, tuning);
        // Use the front circle for sweep
        const front = circles[0];
        const hit = sweepCircleVsBox(
          previousPose.x + Math.sin(previousPose.heading) * front.localForwardOffset,
          previousPose.z + Math.cos(previousPose.heading) * front.localForwardOffset,
          car.position.x + Math.sin(car.heading) * front.localForwardOffset,
          car.position.z + Math.cos(car.heading) * front.localForwardOffset,
          front.radius,
          collider as BoxCollider,
        );
        if (hit && hit.t < earliestT) {
          earliestT = hit.t;
          earliestHit = { collider, normal: hit.normal, point: hit.point };
        }
      } else {
        const circles = getCarCollisionCircles(previousPose, tuning);
        const front = circles[0];
        const hit = sweepCircleVsCircle(
          previousPose.x + Math.sin(previousPose.heading) * front.localForwardOffset,
          previousPose.z + Math.cos(previousPose.heading) * front.localForwardOffset,
          car.position.x + Math.sin(car.heading) * front.localForwardOffset,
          car.position.z + Math.cos(car.heading) * front.localForwardOffset,
          front.radius,
          collider as CircleCollider,
        );
        if (hit && hit.t < earliestT) {
          earliestT = hit.t;
          earliestHit = { collider, normal: hit.normal, point: hit.point };
        }
      }
    }

    if (earliestHit) {
      const safeT = Math.max(0, earliestT - 0.002);
      const dx = car.position.x - previousPose.x;
      const dz = car.position.z - previousPose.z;
      car.position.x = previousPose.x + dx * safeT;
      car.position.z = previousPose.z + dz * safeT;

      // Apply velocity response for the swept contact
      const response = collisionResponses[earliestHit.collider.profile];
      const contact = fillContact(
        earliestHit.collider.id,
        earliestHit.normal.x,
        earliestHit.normal.z,
        earliestHit.point.x,
        earliestHit.point.z,
        0, // penetration unknown for sweep
        0,
        earliestHit.collider.profile,
        true,
      );
      const result = applyGentleVelocityResponse(car, contact, response);
      if (result.closingSpeed > 0) {
        contactedIds.add(earliestHit.collider.id);
        contactCount++;
        const severity = clamp(
          (result.closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
          0,
          1,
        );
        if (severity > strongestSeverity) strongestSeverity = severity;
      }
    }
  }

  // --- Position correction iterations ---
  for (let iter = 0; iter < MAX_POSITION_ITERATIONS; iter++) {
    for (const collider of colliders) {
      if (contactedIds.has(collider.id) && iter > 0) continue; // Already responded this step

      const circles = getCarCollisionCircles(
        { x: car.position.x, z: car.position.z, heading: car.heading },
        tuning,
      );

      // Find deepest contact for this collider across all 3 circles
      let deepest: {
        normal: { x: number; z: number };
        point: { x: number; z: number };
        penetration: number;
        circleOffset: number;
      } | null = null;

      for (const circle of circles) {
        const hit =
          collider.shape === "box"
            ? circleVsBoxContact(circle, collider as BoxCollider)
            : circleVsCircleContact(circle, {
                x: (collider as CircleCollider).x,
                z: (collider as CircleCollider).z,
                radius: (collider as CircleCollider).radius,
              });

        if (!hit) continue;
        if (!deepest || hit.penetration > deepest.penetration) {
          deepest = {
            normal: hit.normal,
            point: hit.point,
            penetration: hit.penetration,
            circleOffset: circle.localForwardOffset,
          };
        }
      }

      if (!deepest) continue;

      const response = collisionResponses[collider.profile];

      // Position correction
      const correction = Math.min(
        response.maxCorrection,
        Math.max(0, deepest.penetration - response.correctionSlop) * response.correctionPercent,
      );
      car.position.x += deepest.normal.x * correction;
      car.position.z += deepest.normal.z * correction;

      // Velocity response — only once per collider per step
      if (!contactedIds.has(collider.id)) {
        const contact = fillContact(
          collider.id,
          deepest.normal.x,
          deepest.normal.z,
          deepest.point.x,
          deepest.point.z,
          deepest.penetration,
          deepest.circleOffset,
          collider.profile,
          false,
        );
        const result = applyGentleVelocityResponse(car, contact, response);
        if (result.closingSpeed > 0 || result.appliedNormalDelta > 0) {
          contactedIds.add(collider.id);
          contactCount++;

          const severity = clamp(
            (result.closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
            0,
            1,
          );
          if (severity > strongestSeverity) strongestSeverity = severity;

          // Gentle yaw impulse
          const contactOffsetX = deepest.point.x - car.position.x;
          const contactOffsetZ = deepest.point.z - car.position.z;
          const lever = contactOffsetX * deepest.normal.z - contactOffsetZ * deepest.normal.x;
          const yawDelta = clamp(
            lever * result.appliedNormalDelta * response.yawImpulseScale,
            -response.maxYawImpulse,
            response.maxYawImpulse,
          );
          car.yawVelocity += yawDelta;
        }
      }
    }
  }

  // Recompute speed
  car.speed = Math.hypot(car.velocity.x, car.velocity.z);

  if (__DEV__) {
    assertFiniteCar(car);
  }

  return {
    severity: strongestSeverity,
    contactCount,
    colliderIds: [...contactedIds],
  };
}

function assertFiniteCar(car: CarState) {
  if (!Number.isFinite(car.position.x) || !Number.isFinite(car.position.z)) {
    throw new Error("[collision] Non-finite car position after solve");
  }
  if (!Number.isFinite(car.velocity.x) || !Number.isFinite(car.velocity.z)) {
    throw new Error("[collision] Non-finite car velocity after solve");
  }
  if (!Number.isFinite(car.heading)) {
    throw new Error("[collision] Non-finite car heading after solve");
  }
  if (!Number.isFinite(car.yawVelocity)) {
    throw new Error("[collision] Non-finite car yawVelocity after solve");
  }
  if (!Number.isFinite(car.speed)) {
    throw new Error("[collision] Non-finite car speed after solve");
  }
}

// ---------------------------------------------------------------------------
// Vehicle-vs-vehicle solver (for obstacle cars)
// ---------------------------------------------------------------------------

export function resolveVehicleContact(
  car: CarState,
  obstacle: { position: { x: number; z: number }; heading: number; velocity: { x: number; z: number }; yawVelocity: number },
  tuning?: CarTuning,
): { severity: number; appliedNormalDelta: number; normal: { x: number; z: number }; point: { x: number; z: number } } {
  const playerCircles = getCarCollisionCircles(
    { x: car.position.x, z: car.position.z, heading: car.heading },
    tuning,
  );
  const obstacleCircles = getCarCollisionCircles(
    { x: obstacle.position.x, z: obstacle.position.z, heading: obstacle.heading },
    { collisionLength: 6.3, collisionWidth: 2.76 } as CarTuning,
  );

  let deepest: {
    normal: { x: number; z: number };
    point: { x: number; z: number };
    penetration: number;
    circleOffset: number;
  } | null = null;
  let mostNegativeNormalSpeed = Infinity;

  for (const pc of playerCircles) {
    for (const oc of obstacleCircles) {
      const hit = circleVsCircleContact(pc, oc);
      if (!hit) continue;

      const relX = car.velocity.x - obstacle.velocity.x;
      const relZ = car.velocity.z - obstacle.velocity.z;
      const normalSpeed = relX * hit.normal.x + relZ * hit.normal.z;

      if (
        !deepest ||
        hit.penetration > deepest.penetration ||
        (Math.abs(hit.penetration - deepest.penetration) < 0.01 && normalSpeed < mostNegativeNormalSpeed)
      ) {
        deepest = {
          normal: hit.normal,
          point: hit.point,
          penetration: hit.penetration,
          circleOffset: pc.localForwardOffset,
        };
        mostNegativeNormalSpeed = normalSpeed;
      }
    }
  }

  if (!deepest) return { severity: 0, appliedNormalDelta: 0, normal: { x: 0, z: 0 }, point: { x: 0, z: 0 } };

  const response = collisionResponses.vehicle;

  // Position correction — split between player and obstacle
  const correction = Math.min(
    response.maxCorrection,
    Math.max(0, deepest.penetration - response.correctionSlop) * response.correctionPercent,
  );
  car.position.x += deepest.normal.x * correction * 0.5;
  car.position.z += deepest.normal.z * correction * 0.5;
  obstacle.position.x -= deepest.normal.x * correction * 0.5;
  obstacle.position.z -= deepest.normal.z * correction * 0.5;

  // Velocity response
  const contact: CollisionContact = {
    colliderId: "vehicle",
    normal: deepest.normal,
    point: deepest.point,
    penetration: deepest.penetration,
    carCircleOffset: deepest.circleOffset,
    profile: "vehicle",
    otherVelocity: { x: obstacle.velocity.x, z: obstacle.velocity.z },
    swept: false,
  };

  const result = applyGentleVelocityResponse(car, contact, response);

  // Apply opposite impulse to obstacle
  obstacle.velocity.x -= deepest.normal.x * result.appliedNormalDelta * 0.55;
  obstacle.velocity.z -= deepest.normal.z * result.appliedNormalDelta * 0.55;

  // Capped obstacle yaw impulse
  const contactOffsetX = deepest.point.x - obstacle.position.x;
  const contactOffsetZ = deepest.point.z - obstacle.position.z;
  const lever = contactOffsetX * deepest.normal.z - contactOffsetZ * deepest.normal.x;
  const obstacleYawDelta = clamp(
    -lever * result.appliedNormalDelta * response.yawImpulseScale * 0.5,
    -response.maxYawImpulse * 0.5,
    response.maxYawImpulse * 0.5,
  );
  obstacle.yawVelocity += obstacleYawDelta;

  const severity = clamp(
    (result.closingSpeed - response.bounceThreshold) / response.severityReferenceSpeed,
    0,
    1,
  );

  return {
    severity,
    appliedNormalDelta: result.appliedNormalDelta,
    normal: deepest.normal,
    point: deepest.point,
  };
}
