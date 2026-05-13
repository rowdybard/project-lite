import { PerspectiveCamera, Vector3 } from "three";
import type { CarState } from "../../game/types";

const cameraOffset = new Vector3(0, 6.7, -17.6);
const lookOffset = new Vector3(0, 1.9, 7.2);
let smoothOrbit = 0;

export function createCamera() {
  const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 7.0, -18.2);
  return camera;
}

export function updateChaseCamera(camera: PerspectiveCamera, car: CarState, dt: number, shake = 0, orbitAngle = 0) {
  smoothOrbit += (orbitAngle - smoothOrbit) * (1 - Math.pow(0.0001, dt));
  const heading = car.heading + smoothOrbit;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const jitter = Math.max(0, shake);
  const shakeX = (Math.random() - 0.5) * jitter * 0.42;
  const shakeY = (Math.random() - 0.5) * jitter * 0.22;

  const target = new Vector3(
    car.position.x + cameraOffset.x * cos + cameraOffset.z * sin + shakeX,
    cameraOffset.y + shakeY,
    car.position.z - cameraOffset.x * sin + cameraOffset.z * cos,
  );

  const lookSin = Math.sin(car.heading);
  const lookCos = Math.cos(car.heading);
  const lookAt = new Vector3(
    car.position.x + lookOffset.x * lookCos + lookOffset.z * lookSin,
    lookOffset.y,
    car.position.z - lookOffset.x * lookSin + lookOffset.z * lookCos,
  );

  camera.position.lerp(target, 1 - Math.pow(0.00002, dt));
  camera.fov += (55 + Math.min(13, car.speed * 0.28) - camera.fov) * (1 - Math.pow(0.0004, dt));
  camera.updateProjectionMatrix();
  camera.lookAt(lookAt);
}
