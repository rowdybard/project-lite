import { PerspectiveCamera, Vector3 } from "three";
import type { CarState } from "../../game/types";

const cameraOffset = new Vector3(0, 7.6, -13.5);
const lookOffset = new Vector3(0, 2.1, 5.5);

export function createCamera() {
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 700);
  camera.position.set(0, 9, -18);
  return camera;
}

export function updateChaseCamera(camera: PerspectiveCamera, car: CarState, dt: number) {
  const sin = Math.sin(car.heading);
  const cos = Math.cos(car.heading);

  const target = new Vector3(
    car.position.x + cameraOffset.x * cos + cameraOffset.z * sin,
    cameraOffset.y,
    car.position.z - cameraOffset.x * sin + cameraOffset.z * cos,
  );

  const lookAt = new Vector3(
    car.position.x + lookOffset.x * cos + lookOffset.z * sin,
    lookOffset.y,
    car.position.z - lookOffset.x * sin + lookOffset.z * cos,
  );

  camera.position.lerp(target, 1 - Math.pow(0.001, dt));
  camera.lookAt(lookAt);
}
