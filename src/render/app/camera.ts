import { PerspectiveCamera, Vector3 } from "three";
import type { CarState } from "../../game/types";

const cameraOffset = new Vector3(0, 5.9, -15.3);
const lookOffset = new Vector3(0, 1.55, 6.2);

export function createCamera() {
  const camera = new PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 6.4, -17.5);
  return camera;
}

export function updateChaseCamera(camera: PerspectiveCamera, car: CarState, dt: number, shake = 0) {
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);
  const jitter = Math.max(0, shake);
  const shakeX = (Math.random() - 0.5) * jitter * 0.42;
  const shakeY = (Math.random() - 0.5) * jitter * 0.22;

  const target = new Vector3(
    car.position.x + cameraOffset.x * cos + cameraOffset.z * sin + shakeX,
    cameraOffset.y + shakeY,
    car.position.z - cameraOffset.x * sin + cameraOffset.z * cos,
  );

  const lookAt = new Vector3(
    car.position.x + lookOffset.x * cos + lookOffset.z * sin,
    lookOffset.y,
    car.position.z - lookOffset.x * sin + lookOffset.z * cos,
  );

  camera.position.lerp(target, 1 - Math.pow(0.00002, dt));
  camera.fov += (58 + Math.min(16, car.speed * 0.34) - camera.fov) * (1 - Math.pow(0.0004, dt));
  camera.updateProjectionMatrix();
  camera.lookAt(lookAt);
}
