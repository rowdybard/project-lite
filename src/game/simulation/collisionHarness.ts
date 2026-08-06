import type { CarState, CarTuning } from "../types";
import type { BoxCollider, CircleCollider, CollisionResult } from "./collisionTypes";
import { createCollisionWorld, type CollisionWorld } from "./collisionWorld";
import {
  captureCarPose,
  circleVsBoxContact,
  circleVsCircleContact,
  getCarCollisionCircles,
  resolveStaticCollisions,
  resolveVehicleContact,
} from "./collisionSolver";
import { resolveTrackCollisions, type Cone } from "./trackCollision";

// Deterministic in-browser collision harness — no test framework required.
// Activated via ?collisionHarness URL parameter.

export type HarnessScenarioResult = {
  name: string;
  passed: boolean;
  expectations: { name: string; passed: boolean; actual: string }[];
  before: { speed: number; normalSpeed: number; tangentSpeed: number; yaw: number; penetration: number };
  after: { speed: number; normalSpeed: number; tangentSpeed: number; yaw: number; penetration: number };
  severity: number;
};

export type CollisionHarnessReport = {
  scenarios: HarnessScenarioResult[];
  summary: { passed: number; failed: number; total: number };
  energyAudit: { steps: number; maxEnergyGain: number; passed: boolean };
  timings: { samples: number; meanMicros: number; maxMicros: number };
};

const FIXED_STEP = 1 / 60;

function makeCarState(
  x: number,
  z: number,
  heading: number,
  vx: number,
  vz: number,
): CarState {
  return {
    position: { x, z },
    heading,
    velocity: { x: vx, z: vz },
    speed: Math.hypot(vx, vz),
    yawVelocity: 0,
    slipAmount: 0,
    slipAngle: 0,
    frontSlipAngle: 0,
    rearSlipAngle: 0,
    gripAmount: 0,
    handbrakeAmount: 0,
    driftAmount: 0,
    driftDirection: 0,
    frontWheelAngle: 0,
    wheelSpin: 0,
    rearWheelSpin: 0,
    powerSlip: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    weightForward: 0.5,
    weightRight: 0.5,
    suspensionFL: 0.5,
    suspensionFR: 0.5,
    suspensionRL: 0.5,
    suspensionRR: 0.5,
    gear: 1,
    rpm: 900,
    shiftCooldown: 0,
    tireHeat: 0,
    rearSlipVisual: 0,
    rearReleaseMemory: 0,
    lowSpeedTurnCommitment: 0,
    steerAxis: 0,
    correctionTimer: 0,
    correctionRightX: 0,
    correctionRightZ: 0,
    correctionSideSpeed: 0,
    correctionDirection: 0,
    throttleAxis: 0,
    brakeAxis: 0,
    reverseEngageTimer: 0,
    filteredLongitudinalAcceleration: 0,
    filteredLateralAcceleration: 0,
    offTrackAmount: 0,
  };
}

const defaultTuning: CarTuning = {
  maxForwardSpeed: 60,
  maxReverseSpeed: 12,
  acceleration: 18,
  brakeForce: 28,
  reverseAcceleration: 10,
  drag: 0.42,
  rollingResistance: 0.18,
  steeringAtSpeed: 0.6,
  steerResponse: 6,
  throttleResponse: 4,
  idleRpm: 900,
  redlineRpm: 7200,
  shiftUpRpm: 6000,
  shiftDownRpm: 3000,
  finalDrive: 4.2,
  wheelRadius: 0.34,
  engineTorque: 240,
  gearRatios: [3.5, 2.1, 1.4, 1.0, 0.8],
  maxSteerAngle: 0.6,
  frontAxle: 1.4,
  rearAxle: -1.4,
  yawInertia: 1.8,
  frontGrip: 1.1,
  rearGrip: 1.0,
  handbrakeRearGrip: 0.4,
  frontCorneringStiffness: 5.0,
  rearCorneringStiffness: 4.6,
  throttleGripLoss: 0.3,
  counterSteerAssist: 0.5,
  offTrackGrip: 0.7,
  offTrackDrag: 1.4,
  driftMinSpeed: 8,
  driftDrag: 0.6,
  slideDrag: 0.5,
  handbrakeDrag: 1.2,
  yawDamping: 0.85,
  collisionLength: 6.3,
  collisionWidth: 2.76,
};

function makeBoxCollider(
  id: string,
  x: number,
  z: number,
  halfLength: number,
  halfWidth: number,
  angle = 0,
  profile: BoxCollider["profile"] = "wall",
): BoxCollider {
  return {
    id,
    shape: "box",
    x,
    z,
    angle,
    halfLength,
    halfWidth,
    profile,
    cameraObstruction: false,
  };
}

function makeCircleCollider(
  id: string,
  x: number,
  z: number,
  radius: number,
  profile: CircleCollider["profile"] = "post",
): CircleCollider {
  return {
    id,
    shape: "circle",
    x,
    z,
    radius,
    profile,
    cameraObstruction: false,
  };
}

function measureState(car: CarState, normal: { x: number; z: number }) {
  const speed = Math.hypot(car.velocity.x, car.velocity.z);
  const normalSpeed = car.velocity.x * normal.x + car.velocity.z * normal.z;
  const tangentX = car.velocity.x - normalSpeed * normal.x;
  const tangentZ = car.velocity.z - normalSpeed * normal.z;
  const tangentSpeed = Math.hypot(tangentX, tangentZ);
  return {
    speed,
    normalSpeed,
    tangentSpeed,
    yaw: car.yawVelocity,
    penetration: 0,
  };
}

function maxPenetration(car: CarState, world: CollisionWorld): number {
  // Use the same gameplay circles as the solver — all three must be checked.
  const circles = getCarCollisionCircles(
    { x: car.position.x, z: car.position.z, heading: car.heading },
    defaultTuning,
  );
  let maxPen = 0;
  const nearby = world.queryAabb(
    car.position.x - 4,
    car.position.z - 4,
    car.position.x + 4,
    car.position.z + 4,
  );
  for (const c of nearby) {
    for (const circle of circles) {
      const hit =
        c.shape === "box"
          ? circleVsBoxContact(circle, c as BoxCollider)
          : circleVsCircleContact(circle, {
              x: (c as CircleCollider).x,
              z: (c as CircleCollider).z,
              radius: (c as CircleCollider).radius,
            });
      if (hit) {
        maxPen = Math.max(maxPen, hit.penetration);
      }
    }
  }
  return maxPen;
}

function isFiniteState(car: CarState): boolean {
  return (
    Number.isFinite(car.position.x) &&
    Number.isFinite(car.position.z) &&
    Number.isFinite(car.velocity.x) &&
    Number.isFinite(car.velocity.z) &&
    Number.isFinite(car.heading) &&
    Number.isFinite(car.yawVelocity) &&
    Number.isFinite(car.speed)
  );
}

function runScenario(
  name: string,
  car: CarState,
  colliders: BoxCollider[] | CircleCollider[],
  normal: { x: number; z: number },
  steps: number,
  expectations: (result: { car: CarState; result: CollisionResult; before: ReturnType<typeof measureState>; after: ReturnType<typeof measureState>; penetration: number }) => { name: string; passed: boolean; actual: string }[],
): HarnessScenarioResult {
  const world = createCollisionWorld(colliders);
  const before = measureState(car, normal);

  let lastResult: CollisionResult = { severity: 0, contactCount: 0, colliderIds: [] };
  for (let i = 0; i < steps; i++) {
    // Capture pose BEFORE integrating movement — sweep needs motion delta.
    const previousPose = captureCarPose(car);
    // Integrate velocity into position (simple Euler — harness doesn't need full car physics)
    car.position.x += car.velocity.x * FIXED_STEP;
    car.position.z += car.velocity.z * FIXED_STEP;
    car.heading += car.yawVelocity * FIXED_STEP;
    lastResult = resolveStaticCollisions(car, previousPose, world.queryAabb(
      Math.min(previousPose.x, car.position.x) - 4,
      Math.min(previousPose.z, car.position.z) - 4,
      Math.max(previousPose.x, car.position.x) + 4,
      Math.max(previousPose.z, car.position.z) + 4,
    ), defaultTuning);
  }

  const after = measureState(car, normal);
  const penetration = maxPenetration(car, world);
  const expResults = expectations({ car, result: lastResult, before, after, penetration });

  return {
    name,
    passed: expResults.every((e) => e.passed),
    expectations: expResults,
    before,
    after,
    severity: lastResult.severity,
  };
}

export function runCollisionHarness(): CollisionHarnessReport {
  const scenarios: HarnessScenarioResult[] = [];

  // 1. Head-on wall
  {
    const car = makeCarState(0, 5, 0, 0, -20);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    scenarios.push(
      runScenario("head-on-wall", car, [wall], { x: 0, z: 1 }, 20, ({ car, after, penetration }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "outside penetration",
          passed: penetration < 0.05,
          actual: `pen=${penetration.toFixed(3)}`,
        },
        {
          name: "normal speed outward",
          passed: after.normalSpeed > 0,
          actual: `normalSpeed=${after.normalSpeed.toFixed(2)}`,
        },
        {
          name: "speed > 0.5",
          passed: after.speed > 0.5,
          actual: `speed=${after.speed.toFixed(2)}`,
        },
        {
          name: "speed < 5",
          passed: after.speed < 5,
          actual: `speed=${after.speed.toFixed(2)}`,
        },
      ]),
    );
  }

  // 2. 45-degree wall scrape
  {
    const car = makeCarState(0, 5, 0, 14, -14);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    scenarios.push(
      runScenario("45-degree-scrape", car, [wall], { x: 0, z: -1 }, 20, ({ car, before, after }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "tangential retention >= 96%",
          passed: after.tangentSpeed >= before.tangentSpeed * 0.96,
          actual: `before=${before.tangentSpeed.toFixed(2)}, after=${after.tangentSpeed.toFixed(2)}`,
        },
        {
          name: "total speed nonzero",
          passed: after.speed > 1,
          actual: `speed=${after.speed.toFixed(2)}`,
        },
      ]),
    );
  }

  // 3. Near-parallel wall scrape
  {
    const car = makeCarState(0, 5, 0, 20, -0.5);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    scenarios.push(
      runScenario("near-parallel-scrape", car, [wall], { x: 0, z: -1 }, 20, ({ car, before, after, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "tangent retained >= 98%",
          passed: after.tangentSpeed >= before.tangentSpeed * 0.98,
          actual: `before=${before.tangentSpeed.toFixed(2)}, after=${after.tangentSpeed.toFixed(2)}`,
        },
        {
          name: "severity < 0.08",
          passed: result.severity < 0.08,
          actual: `severity=${result.severity.toFixed(3)}`,
        },
      ]),
    );
  }

  // 4. Low-speed resting contact
  {
    const car = makeCarState(0, 5, 0, 0, -1.5);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    const world = createCollisionWorld([wall]);
    let lastPen = 0;
    let lastSev = 0;
    let bounces = 0;
    let lastNormalSign = 0;
    for (let i = 0; i < 240; i++) {
      // Light continuous push toward wall (negative z)
      car.velocity.z = Math.max(car.velocity.z - 0.5 * FIXED_STEP, -1.5);
      // Capture pose BEFORE integrating movement
      const previousPose = captureCarPose(car);
      // Integrate position
      car.position.x += car.velocity.x * FIXED_STEP;
      car.position.z += car.velocity.z * FIXED_STEP;
      const result = resolveStaticCollisions(car, previousPose, world.queryAabb(
        car.position.x - 4, car.position.z - 4, car.position.x + 4, car.position.z + 4,
      ), defaultTuning);
      lastPen = maxPenetration(car, world);
      lastSev = result.severity;
      const sign = Math.sign(car.velocity.z);
      if (sign !== 0 && lastNormalSign !== 0 && sign !== lastNormalSign) bounces++;
      lastNormalSign = sign;
    }
    scenarios.push({
      name: "low-speed-resting",
      passed: lastPen < 0.03 && bounces < 3 && lastSev < 0.01 && isFiniteState(car),
      expectations: [
        { name: "penetration < 0.03", passed: lastPen < 0.03, actual: `pen=${lastPen.toFixed(3)}` },
        { name: "no alternating bounce", passed: bounces < 3, actual: `bounces=${bounces}` },
        { name: "severity returns to zero", passed: lastSev < 0.01, actual: `sev=${lastSev.toFixed(3)}` },
        { name: "position finite", passed: isFiniteState(car), actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}` },
      ],
      before: { speed: 1.5, normalSpeed: -1.5, tangentSpeed: 0, yaw: 0, penetration: 0 },
      after: { speed: car.speed, normalSpeed: car.velocity.z, tangentSpeed: car.velocity.x, yaw: car.yawVelocity, penetration: lastPen },
      severity: lastSev,
    });
  }

  // 5. Box corner
  {
    const car = makeCarState(5, 5, 0, 10, 10);
    const wall1 = makeBoxCollider("wall1", 0, 10, 10, 0.5);
    const wall2 = makeBoxCollider("wall2", 10, 0, 0.5, 10);
    scenarios.push(
      runScenario("box-corner", car, [wall1, wall2], { x: 0.707, z: 0.707 }, 20, ({ car, before, after, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "no energy gain",
          passed: after.speed <= before.speed + 0.5,
          actual: `before=${before.speed.toFixed(2)}, after=${after.speed.toFixed(2)}`,
        },
        {
          name: "at most one response per collider",
          passed: result.colliderIds.length <= 2,
          actual: `contacts=${result.colliderIds.length}`,
        },
      ]),
    );
  }

  // 6. Circular post
  {
    const car = makeCarState(5, 0, 0, 10, 0);
    const post = makeCircleCollider("post", 0, 0, 0.3, "post");
    scenarios.push(
      runScenario("circular-post", car, [post], { x: -1, z: 0 }, 20, ({ car, after }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "car does not stick (speed > 0.5)",
          passed: after.speed > 0.5,
          actual: `speed=${after.speed.toFixed(2)}`,
        },
        {
          name: "yaw impulse below cap (0.48)",
          passed: Math.abs(after.yaw) < 0.5,
          actual: `yaw=${after.yaw.toFixed(3)}`,
        },
      ]),
    );
  }

  // 7. High-speed thin wall
  {
    const car = makeCarState(0, 5, 0, 0, -50);
    const wall = makeBoxCollider("thin-wall", 0, 0, 50, 0.15);
    scenarios.push(
      runScenario("high-speed-thin-wall", car, [wall], { x: 0, z: -1 }, 20, ({ car, after, penetration, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "no tunnel (penetration < 0.5)",
          passed: penetration < 0.5,
          actual: `pen=${penetration.toFixed(3)}`,
        },
        {
          name: "contact registered",
          passed: result.contactCount > 0 || result.colliderIds.includes("thin-wall"),
          actual: `contacts=${result.contactCount}, ids=${JSON.stringify(result.colliderIds)}`,
        },
        {
          name: "car stays on legal side (z > 0)",
          passed: car.position.z > 0,
          actual: `z=${car.position.z.toFixed(2)}`,
        },
        {
          name: "rebound capped (< 6)",
          passed: after.speed < 6,
          actual: `speed=${after.speed.toFixed(2)}`,
        },
      ]),
    );
  }

  // 7b. Reverse thin-wall — rear circle reaches wall first
  {
    const car = makeCarState(0, -5, Math.PI, 0, -45);
    const wall = makeBoxCollider("thin-wall-rear", 0, 0, 50, 0.15);
    scenarios.push(
      runScenario("reverse-thin-wall", car, [wall], { x: 0, z: 1 }, 20, ({ car, penetration, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "no tunnel (penetration < 0.5)",
          passed: penetration < 0.5,
          actual: `pen=${penetration.toFixed(3)}`,
        },
        {
          name: "contact registered",
          passed: result.contactCount > 0 || result.colliderIds.includes("thin-wall-rear"),
          actual: `contacts=${result.contactCount}, ids=${JSON.stringify(result.colliderIds)}`,
        },
        {
          name: "car stays on legal side (z < 0)",
          passed: car.position.z < 0,
          actual: `z=${car.position.z.toFixed(2)}`,
        },
      ]),
    );
  }

  // 7c. Lateral thin-post — high side velocity, car heading perpendicular to travel
  {
    const car = makeCarState(-5, 0, Math.PI / 2, 45, 0);
    const post = makeCircleCollider("thin-post", 0, 0, 0.3, "post");
    scenarios.push(
      runScenario("lateral-thin-post", car, [post], { x: -1, z: 0 }, 20, ({ car, penetration, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "no tunnel (penetration < 0.5)",
          passed: penetration < 0.5,
          actual: `pen=${penetration.toFixed(3)}`,
        },
        {
          name: "contact registered",
          passed: result.contactCount > 0 || result.colliderIds.includes("thin-post"),
          actual: `contacts=${result.contactCount}, ids=${JSON.stringify(result.colliderIds)}`,
        },
        {
          name: "car stays on legal side (x < 0)",
          passed: car.position.x < 0,
          actual: `x=${car.position.x.toFixed(2)}`,
        },
      ]),
    );
  }

  // 7d. Spin contact — non-zero yaw and diagonal movement
  {
    const car = makeCarState(5, 5, 0.3, 18, -18);
    car.yawVelocity = 1.5;
    const wall = makeBoxCollider("spin-wall", 0, 0, 50, 0.5);
    scenarios.push(
      runScenario("spin-contact", car, [wall], { x: 0, z: 1 }, 20, ({ car, penetration, result }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "no tunnel (penetration < 0.5)",
          passed: penetration < 0.5,
          actual: `pen=${penetration.toFixed(3)}`,
        },
        {
          name: "contact registered",
          passed: result.contactCount > 0,
          actual: `contacts=${result.contactCount}`,
        },
      ]),
    );
  }

  // 7e. Deep-overlap correction — spawn deeply inside a collider
  {
    const car = makeCarState(0, 0.2, 0, 0, 0);
    const wall = makeBoxCollider("deep-wall", 0, 0, 50, 2);
    const world = createCollisionWorld([wall]);
    let lastResult: CollisionResult = { severity: 0, contactCount: 0, colliderIds: [] };
    let lastPen = 0;
    // Run a few iterations to let the position solver push the car out
    for (let i = 0; i < 4; i++) {
      const previousPose = captureCarPose(car);
      lastResult = resolveStaticCollisions(
        car,
        previousPose,
        world.queryAabb(car.position.x - 4, car.position.z - 4, car.position.x + 4, car.position.z + 4),
        defaultTuning,
      );
      lastPen = maxPenetration(car, world);
    }
    scenarios.push({
      name: "deep-overlap-correction",
      passed: lastPen < 0.03 && lastResult.contactCount <= 1 && isFiniteState(car),
      expectations: [
        { name: "penetration converges (< 0.03)", passed: lastPen < 0.03, actual: `pen=${lastPen.toFixed(3)}` },
        { name: "at most one velocity response", passed: lastResult.contactCount <= 1, actual: `contacts=${lastResult.contactCount}` },
        { name: "no NaN", passed: isFiniteState(car), actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}` },
      ],
      before: { speed: 0, normalSpeed: 0, tangentSpeed: 0, yaw: 0, penetration: 2 },
      after: { speed: car.speed, normalSpeed: car.velocity.z, tangentSpeed: car.velocity.x, yaw: car.yawVelocity, penetration: lastPen },
      severity: lastResult.severity,
    });
  }

  // 8. Safety boundary
  {
    const car = makeCarState(0, 100, 0, 15, -20);
    // Use a synthetic track-like boundary via a large box ring
    const wall = makeBoxCollider("boundary", 0, 50, 200, 0.5);
    scenarios.push(
      runScenario("safety-boundary", car, [wall], { x: 0, z: 1 }, 20, ({ car, after }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "inward correction (z > 50.5)",
          passed: car.position.z > 50.5,
          actual: `z=${car.position.z.toFixed(2)}`,
        },
        {
          name: "tangent preserved",
          passed: after.tangentSpeed > 0,
          actual: `tangent=${after.tangentSpeed.toFixed(2)}`,
        },
      ]),
    );
  }

  // 9. Endless guardrail — simulated via two parallel walls
  {
    const car = makeCarState(10, 0, 0, 20, 0);
    const leftWall = makeBoxCollider("left-guardrail", 0, 0, 50, 0.28, 0, "guardrail");
    const rightWall = makeBoxCollider("right-guardrail", 20, 0, 50, 0.28, 0, "guardrail");
    scenarios.push(
      runScenario("endless-guardrail-left", car, [leftWall, rightWall], { x: 1, z: 0 }, 4, ({ car }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "correction inward (x > 0.5)",
          passed: car.position.x > 0.5,
          actual: `x=${car.position.x.toFixed(2)}`,
        },
      ]),
    );

    const car2 = makeCarState(10, 0, 0, -20, 0);
    scenarios.push(
      runScenario("endless-guardrail-right", car2, [leftWall, rightWall], { x: -1, z: 0 }, 4, ({ car }) => [
        {
          name: "no NaN",
          passed: isFiniteState(car),
          actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}`,
        },
        {
          name: "correction inward (x < 19.5)",
          passed: car.position.x < 19.5,
          actual: `x=${car.position.x.toFixed(2)}`,
        },
      ]),
    );
  }

  // 10. Vehicle-to-vehicle
  {
    const car = makeCarState(0, 5, 0, 0, -15);
    const obstacle = {
      position: { x: 0, z: 0 },
      heading: 0,
      velocity: { x: 0, z: 0 },
      yawVelocity: 0,
    };
    const before = measureState(car, { x: 0, z: -1 });
    const result = resolveVehicleContact(car, obstacle, defaultTuning);
    const after = measureState(car, { x: 0, z: -1 });
    scenarios.push({
      name: "vehicle-to-vehicle",
      passed: isFiniteState(car) && after.speed > 0.5 && Number.isFinite(obstacle.position.x),
      expectations: [
        { name: "no NaN", passed: isFiniteState(car), actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}` },
        { name: "player retains motion", passed: after.speed > 0.5, actual: `speed=${after.speed.toFixed(2)}` },
        { name: "obstacle receives displacement", passed: Math.abs(obstacle.position.z - 0) > 0.01, actual: `obs.z=${obstacle.position.z.toFixed(3)}` },
      ],
      before,
      after,
      severity: result.severity,
    });
  }

  // 11. Cone
  {
    const car = makeCarState(5, 0, 0, -10, 0);
    const cones: Cone[] = [{
      id: "test-cone",
      x: 0, z: 0, vx: 0, vz: 0, spin: 0, angularVelocity: 0, radius: 0.38, knocked: false,
    }];
    const world = createCollisionWorld([]);
    const before = measureState(car, { x: -1, z: 0 });
    // Run enough steps for the car to reach the cone
    let result = { severity: 0, contactCount: 0, colliderIds: [] as string[] };
    for (let i = 0; i < 20; i++) {
      // Capture pose BEFORE integrating movement
      const previousPose = captureCarPose(car);
      // Integrate position
      car.position.x += car.velocity.x * FIXED_STEP;
      car.position.z += car.velocity.z * FIXED_STEP;
      result = resolveTrackCollisions(car, previousPose, world, cones, FIXED_STEP, defaultTuning);
    }
    const after = measureState(car, { x: -1, z: 0 });
    const coneSpeed = Math.hypot(cones[0].vx, cones[0].vz);
    scenarios.push({
      name: "cone",
      passed: coneSpeed > 0 && after.speed > before.speed * 0.95 && isFiniteState(car),
      expectations: [
        { name: "cone gains velocity", passed: coneSpeed > 0, actual: `coneSpeed=${coneSpeed.toFixed(2)}` },
        { name: "player loses < 5% speed", passed: after.speed > before.speed * 0.95, actual: `before=${before.speed.toFixed(2)}, after=${after.speed.toFixed(2)}` },
        { name: "no NaN", passed: isFiniteState(car), actual: `pos=${car.position.x.toFixed(2)},${car.position.z.toFixed(2)}` },
      ],
      before,
      after,
      severity: result.severity,
    });

    // Determinism check — run identical scenario
    const car2 = makeCarState(5, 0, 0, -10, 0);
    const cones2: Cone[] = [{
      id: "test-cone",
      x: 0, z: 0, vx: 0, vz: 0, spin: 0, angularVelocity: 0, radius: 0.38, knocked: false,
    }];
    for (let i = 0; i < 20; i++) {
      const prev2 = captureCarPose(car2);
      car2.position.x += car2.velocity.x * FIXED_STEP;
      car2.position.z += car2.velocity.z * FIXED_STEP;
      resolveTrackCollisions(car2, prev2, world, cones2, FIXED_STEP, defaultTuning);
    }
    const deterministic = car2.position.x === car.position.x && car2.position.z === car.position.z;
    scenarios[scenarios.length - 1].expectations.push({
      name: "deterministic on repeat",
      passed: deterministic,
      actual: `pos1=${car.position.x.toFixed(3)},${car.position.z.toFixed(3)} pos2=${car2.position.x.toFixed(3)},${car2.position.z.toFixed(3)}`,
    });
    if (!deterministic) scenarios[scenarios.length - 1].passed = false;
  }

  // 12. Energy audit
  let maxEnergyGain = 0;
  {
    const car = makeCarState(0, 5, 0, 0, -12);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    const world = createCollisionWorld([wall]);
    const initialSpeed = car.speed;
    for (let i = 0; i < 600; i++) {
      // Capture pose BEFORE integrating movement
      const previousPose = captureCarPose(car);
      // Integrate position
      car.position.x += car.velocity.x * FIXED_STEP;
      car.position.z += car.velocity.z * FIXED_STEP;
      resolveStaticCollisions(car, previousPose, world.queryAabb(
        car.position.x - 4, car.position.z - 4, car.position.x + 4, car.position.z + 4,
      ), defaultTuning);
      const gain = car.speed - initialSpeed;
      if (gain > maxEnergyGain) maxEnergyGain = gain;
    }
  }

  // Timings
  let totalMicros = 0;
  let maxMicros = 0;
  const timingSamples = 1000;
  {
    const car = makeCarState(0, 5, 0, 0, -20);
    const wall = makeBoxCollider("wall", 0, 0, 50, 0.5);
    const world = createCollisionWorld([wall]);
    for (let i = 0; i < timingSamples; i++) {
      // Reset car each iteration to keep it near the wall
      car.position.x = 0;
      car.position.z = 5;
      car.velocity.x = 0;
      car.velocity.z = -20;
      car.heading = 0;
      car.yawVelocity = 0;
      // Capture pose BEFORE integrating movement
      const previousPose = captureCarPose(car);
      // Integrate position to create a collision scenario
      car.position.x += car.velocity.x * FIXED_STEP;
      car.position.z += car.velocity.z * FIXED_STEP;
      const start = performance.now();
      resolveStaticCollisions(car, previousPose, world.queryAabb(
        car.position.x - 4, car.position.z - 4, car.position.x + 4, car.position.z + 4,
      ), defaultTuning);
      const elapsed = (performance.now() - start) * 1000;
      totalMicros += elapsed;
      if (elapsed > maxMicros) maxMicros = elapsed;
    }
  }

  const passed = scenarios.filter((s) => s.passed).length;
  const failed = scenarios.length - passed;

  return {
    scenarios,
    summary: { passed, failed, total: scenarios.length },
    energyAudit: {
      steps: 600,
      maxEnergyGain,
      passed: maxEnergyGain < 0.05,
    },
    timings: {
      samples: timingSamples,
      meanMicros: totalMicros / timingSamples,
      maxMicros,
    },
  };
}

export function mountCollisionHarnessReport(report: CollisionHarnessReport) {
  const root = document.createElement("pre");
  root.className = "collision-harness";
  root.textContent = `COLLISION HARNESS\n${JSON.stringify(report, null, 2)}`;
  document.body.append(root);
}
