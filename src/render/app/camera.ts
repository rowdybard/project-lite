import { PerspectiveCamera, Vector3 } from "three";
import type { CarState } from "../../game/types";
import type { BoxCollider } from "../../game/simulation/collisionTypes";

const position = new Vector3();
const positionVelocity = new Vector3();
const lookPosition = new Vector3();
const lookVelocity = new Vector3();
const desiredPosition = new Vector3();
const desiredLook = new Vector3();
const renderPosition = new Vector3();
const shakeOffset = new Vector3();
const collisionTarget = new Vector3();
let initialized = false;
let smoothOrbit = 0;
let orbitVelocity = 0;
let shakeEnvelope = 0;
let shakePhase = 0;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function shortestAngle(from: number, to: number) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function springScalar(current: number, velocity: number, target: number, frequency: number, dt: number) {
  const acceleration = (target - current) * frequency * frequency - velocity * frequency * 2;
  const nextVelocity = velocity + acceleration * dt;
  return { value: current + nextVelocity * dt, velocity: nextVelocity };
}

function springVector(current: Vector3, velocity: Vector3, target: Vector3, frequency: number, dt: number) {
  const decay = Math.exp(-frequency * dt);
  for (const axis of ["x", "y", "z"] as const) {
    const offset = current[axis] - target[axis];
    const combined = velocity[axis] + offset * frequency;
    current[axis] = target[axis] + (offset + combined * dt) * decay;
    velocity[axis] = (velocity[axis] - combined * frequency * dt) * decay;
  }
}

function buildTargets(car: CarState, orbitAngle: number) {
  const speedBlend = clamp(car.speed / 48, 0, 1);
  const velocityHeading = car.speed > 1.5 ? Math.atan2(car.velocity.x, car.velocity.z) : car.heading;
  const trajectoryBlend = clamp(car.slipAmount * 0.28 + speedBlend * 0.08, 0.04, 0.3);
  const chaseHeading = car.heading + shortestAngle(car.heading, velocityHeading) * trajectoryBlend + orbitAngle;
  const chaseSin = Math.sin(chaseHeading);
  const chaseCos = Math.cos(chaseHeading);
  const distance = 13.9 + speedBlend * 1.7;
  const height = 4.65 + speedBlend * 0.35;

  desiredPosition.set(
    car.position.x - chaseSin * distance,
    height,
    car.position.z - chaseCos * distance,
  );

  const velocityLength = Math.max(car.speed, 0.001);
  const velocityX = car.velocity.x / velocityLength;
  const velocityZ = car.velocity.z / velocityLength;
  const bodyX = Math.sin(car.heading);
  const bodyZ = Math.cos(car.heading);
  const lookAhead = 5.6 + speedBlend * 8.2;
  const lookX = bodyX * (1 - trajectoryBlend) + velocityX * trajectoryBlend;
  const lookZ = bodyZ * (1 - trajectoryBlend) + velocityZ * trajectoryBlend;
  desiredLook.set(car.position.x + lookX * lookAhead, 1.25 + speedBlend * 0.22, car.position.z + lookZ * lookAhead);
}

function obstructCamera(target: Vector3, cameraPosition: Vector3, barriers: readonly BoxCollider[]) {
  let nearest = 1;
  const dx = cameraPosition.x - target.x;
  const dz = cameraPosition.z - target.z;

  for (const barrier of barriers) {
    if (!barrier.cameraObstruction || (barrier.halfLength > 40 && barrier.halfWidth > 5)) continue;
    const cos = Math.cos(barrier.angle);
    const sin = Math.sin(barrier.angle);
    const startX = (target.x - barrier.x) * cos + (target.z - barrier.z) * sin;
    const startZ = -(target.x - barrier.x) * sin + (target.z - barrier.z) * cos;
    const rayX = dx * cos + dz * sin;
    const rayZ = -dx * sin + dz * cos;
    const halfX = barrier.halfLength + 0.6;
    const halfZ = barrier.halfWidth + 0.6;
    let entry = 0;
    let exit = nearest;

    for (const [origin, direction, half] of [[startX, rayX, halfX], [startZ, rayZ, halfZ]] as const) {
      if (Math.abs(direction) < 0.0001) {
        if (Math.abs(origin) > half) {
          entry = 2;
          break;
        }
        continue;
      }
      const first = (-half - origin) / direction;
      const second = (half - origin) / direction;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }

    if (entry <= exit && exit >= 0 && entry <= nearest) nearest = Math.max(0.08, entry - 0.15);
  }

  if (nearest < 1) cameraPosition.set(target.x + dx * nearest, cameraPosition.y, target.z + dz * nearest);
}

export function createCamera() {
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 5.2, -15.2);
  return camera;
}

export function resetChaseCamera(camera: PerspectiveCamera, car: CarState) {
  smoothOrbit = 0;
  orbitVelocity = 0;
  shakeEnvelope = 0;
  shakePhase = 0;
  buildTargets(car, 0);
  position.copy(desiredPosition);
  lookPosition.copy(desiredLook);
  positionVelocity.set(0, 0, 0);
  lookVelocity.set(0, 0, 0);
  camera.position.copy(position);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookPosition);
  initialized = true;
}

export function updateChaseCamera(
  camera: PerspectiveCamera,
  car: CarState,
  dt: number,
  shake = 0,
  orbitAngle = 0,
  barriers: readonly BoxCollider[] = [],
) {
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  if (!initialized) resetChaseCamera(camera, car);

  const orbitSpring = springScalar(smoothOrbit, orbitVelocity, orbitAngle, 8.5, safeDt);
  smoothOrbit = orbitSpring.value;
  orbitVelocity = orbitSpring.velocity;
  buildTargets(car, smoothOrbit);

  springVector(position, positionVelocity, desiredPosition, 7.2, safeDt);
  springVector(lookPosition, lookVelocity, desiredLook, 8.2, safeDt);

  const chaseError = position.distanceTo(desiredPosition);
  if (chaseError > 2.6) {
    position.sub(desiredPosition).multiplyScalar(2.6 / chaseError).add(desiredPosition);
    positionVelocity.multiplyScalar(0.45);
  }

  const fromCarX = position.x - car.position.x;
  const fromCarZ = position.z - car.position.z;
  const horizontalDistance = Math.hypot(fromCarX, fromCarZ);
  if (horizontalDistance > 18.2) {
    const scale = 18.2 / horizontalDistance;
    position.x = car.position.x + fromCarX * scale;
    position.z = car.position.z + fromCarZ * scale;
    positionVelocity.multiplyScalar(0.35);
  }

  shakeEnvelope += (Math.max(0, shake) - shakeEnvelope) * (1 - Math.exp(-12 * safeDt));
  shakePhase += safeDt * (13 + car.speed * 0.05);
  const shakeX = (Math.sin(shakePhase * 1.73) + Math.sin(shakePhase * 2.31) * 0.35) * shakeEnvelope * 0.16;
  const shakeY = (Math.sin(shakePhase * 2.07 + 1.4) + Math.sin(shakePhase * 1.21) * 0.3) * shakeEnvelope * 0.08;
  shakeOffset.set(shakeX, shakeY, -shakeX * 0.35);
  renderPosition.copy(position).add(shakeOffset);
  collisionTarget.set(car.position.x, 1.15, car.position.z);
  obstructCamera(collisionTarget, renderPosition, barriers);
  // Ground clamp: never let the camera dip below the terrain
  if (renderPosition.y < 1.4) renderPosition.y = 1.4;
  camera.position.copy(renderPosition);

  const speedFov = Math.min(9, car.speed * 0.19);
  camera.fov += (55 + speedFov - camera.fov) * (1 - Math.exp(-5.4 * safeDt));
  camera.up.set(-car.bodyRoll * 0.018, 1, 0).normalize();
  camera.updateProjectionMatrix();
  camera.lookAt(lookPosition);
}
