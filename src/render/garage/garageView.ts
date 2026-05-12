import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  Vector3,
  WebGLRenderer,
} from "three";
import type { CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";
import { createCarView } from "../objects/carView";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

function createPreviewCarState(): CarState {
  return {
    position: { x: 0, z: 0 },
    heading: 0,
    velocity: { x: 0, z: 0 },
    speed: 0,
    yawVelocity: 0,
    slipAmount: 0,
    slipAngle: 0,
    frontSlipAngle: 0,
    rearSlipAngle: 0,
    gripAmount: 1,
    handbrakeAmount: 0,
    driftAmount: 0,
    driftDirection: 1,
    frontWheelAngle: 0,
    wheelSpin: 0,
    rearWheelSpin: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    weightForward: 0.5,
    weightRight: 0.5,
    suspensionFL: 0.5,
    suspensionFR: 0.5,
    suspensionRL: 0.5,
    suspensionRR: 0.5,
    gear: 1,
    rpm: 850,
    shiftCooldown: 0,
    tireHeat: 0,
    rearSlipVisual: 0,
    steerAxis: 0,
    throttleAxis: 0,
    brakeAxis: 0,
  };
}

export function createGarageView(canvas: HTMLCanvasElement, renderer: WebGLRenderer, customization: CarCustomization) {
  const scene = new Scene();
  scene.background = null;

  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
  const carView = createCarView(1);
  const car = createPreviewCarState();
  carView.applyCustomization(customization);
  scene.add(carView.root);

  const garage = new Group();
  const concrete = new MeshStandardMaterial({ color: 0x2d3135, roughness: 0.88 });
  const wallMaterial = new MeshStandardMaterial({ color: 0x161d25, roughness: 0.78 });
  const doorMaterial = new MeshStandardMaterial({ color: 0x242c35, roughness: 0.72, metalness: 0.08 });
  const trimMaterial = new MeshStandardMaterial({ color: 0xd0a63e, emissive: 0x241600, roughness: 0.52 });

  const floor = new Mesh(new PlaneGeometry(18, 14), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  garage.add(floor);

  const backWall = new Mesh(new BoxGeometry(18, 5, 0.28), wallMaterial);
  backWall.position.set(0, 2.5, -5.8);
  backWall.receiveShadow = true;
  garage.add(backWall);

  const leftWall = new Mesh(new BoxGeometry(0.28, 5, 12), wallMaterial);
  leftWall.position.set(-8.9, 2.5, 0);
  garage.add(leftWall);

  const rightWall = new Mesh(new BoxGeometry(0.28, 5, 12), wallMaterial);
  rightWall.position.set(8.9, 2.5, 0);
  garage.add(rightWall);

  const door = new Mesh(new BoxGeometry(6.6, 3.3, 0.18), doorMaterial);
  door.position.set(0, 1.9, -5.6);
  garage.add(door);

  for (const x of [-2.2, 0, 2.2]) {
    const seam = new Mesh(new BoxGeometry(0.05, 3.1, 0.2), trimMaterial);
    seam.position.set(x, 1.9, -5.48);
    garage.add(seam);
  }

  for (const x of [-3.8, 3.8]) {
    const light = new Mesh(new BoxGeometry(2.4, 0.1, 0.34), trimMaterial);
    light.position.set(x, 4.75, -1.2);
    garage.add(light);
  }

  const mainLight = new SpotLight(0xffffff, 520, 18, Math.PI / 4, 0.55, 1.6);
  mainLight.position.set(0, 6.8, 2.8);
  mainLight.target.position.set(0, 0.4, 0);
  mainLight.castShadow = true;
  scene.add(mainLight, mainLight.target);

  const fillLight = new SpotLight(0x9fc8ff, 150, 18, Math.PI / 5, 0.75, 2);
  fillLight.position.set(-5, 4, 4);
  fillLight.target.position.set(0, 0.6, 0);
  scene.add(fillLight, fillLight.target);
  scene.add(garage);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let targetYaw = 0.75;
  let yaw = targetYaw;
  let targetPitch = 0.18;
  let pitch = targetPitch;
  let targetDistance = 7.2;
  let distance = targetDistance;

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    targetYaw += (event.clientX - lastX) * 0.008;
    targetPitch = clamp(targetPitch + (event.clientY - lastY) * 0.003, -0.22, 0.42);
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    targetDistance = clamp(targetDistance + event.deltaY * 0.006, 4.8, 9.5);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    root: scene,
    camera,
    carView,
    applyCustomization(next: CarCustomization) {
      carView.applyCustomization(next);
    },
    setAspect(aspect: number) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(dt: number) {
      yaw = lerp(yaw, targetYaw, 1 - Math.pow(0.0005, dt));
      pitch = lerp(pitch, targetPitch, 1 - Math.pow(0.0005, dt));
      distance = lerp(distance, targetDistance, 1 - Math.pow(0.0005, dt));

      car.heading += dt * 0.18;
      car.bodyRoll = Math.sin(performance.now() * 0.0012) * 0.05;
      carView.sync(car);

      const height = 1.8 + pitch * 3.2;
      const position = new Vector3(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
      camera.position.copy(position);
      camera.lookAt(0, 0.8, 0);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
