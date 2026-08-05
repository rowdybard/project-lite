import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { CarCustomization } from "../../game/customization";
import { createCarView } from "../objects/carView";
import { createArenaLightRig } from "../arena/lightRig";
import { bakeArenaEnvironment } from "../arena/environmentBake";
import { arenaPalette } from "../arena/palette";
import { createPreviewCarState } from "./previewCarState";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export function createGarageView(canvas: HTMLCanvasElement, renderer: WebGLRenderer, customization: CarCustomization) {
  const scene = new Scene();
  scene.background = null;
  scene.environmentIntensity = arenaPalette.environmentIntensity;

  const camera = new PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
  const carView = createCarView(1);
  const car = createPreviewCarState();
  carView.applyCustomization(customization);
  scene.add(carView.root);

  const garage = new Group();
  const concrete = new MeshStandardMaterial({ color: 0x2d3135, roughness: 0.88, envMapIntensity: 0.3 });
  const wallMaterial = new MeshStandardMaterial({ color: 0x161d25, roughness: 0.78, envMapIntensity: 0.25 });
  const doorMaterial = new MeshStandardMaterial({ color: 0x242c35, roughness: 0.72, metalness: 0.08 });
  const trimMaterial = new MeshStandardMaterial({ color: 0xd0a63e, emissive: 0x241600, roughness: 0.52 });
  const platformMaterial = new MeshStandardMaterial({
    color: 0x1a1f25,
    roughness: 0.42,
    metalness: 0.35,
    envMapIntensity: 0.55,
  });
  const platformRingMaterial = new MeshStandardMaterial({
    color: arenaPalette.accentColor,
    emissive: arenaPalette.accentColor,
    emissiveIntensity: 0.4,
    roughness: 0.4,
    metalness: 0.2,
  });

  const floor = new Mesh(new PlaneGeometry(18, 14), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  garage.add(floor);

  // Turntable platform under the car: a low disc with an emissive accent ring so the
  // car reads as the focal point and the floor reflection breaks up around it.
  const platform = new Mesh(new PlaneGeometry(4.6, 4.6), platformMaterial);
  platform.rotation.x = -Math.PI / 2;
  platform.position.set(0, 0.02, 0);
  platform.receiveShadow = true;
  garage.add(platform);
  const ring = new Mesh(new PlaneGeometry(4.8, 4.8), platformRingMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.015, 0);
  garage.add(ring);

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

  const coolStripMaterial = new MeshStandardMaterial({
    color: 0xf4f8ff,
    emissive: arenaPalette.fixtureCoolEmissive,
    emissiveIntensity: arenaPalette.fixtureCoolIntensity,
    roughness: 0.3,
  });
  for (const x of [-3.8, 3.8]) {
    const light = new Mesh(new BoxGeometry(2.4, 0.1, 0.34), coolStripMaterial);
    light.position.set(x, 4.75, -1.2);
    garage.add(light);
  }

  const warmSconceMaterial = new MeshStandardMaterial({
    color: 0xffe0b8,
    emissive: arenaPalette.fixtureWarmEmissive,
    emissiveIntensity: arenaPalette.fixtureWarmIntensity,
    roughness: 0.34,
  });
  for (const x of [-5.4, 5.4]) {
    const sconce = new Mesh(new BoxGeometry(1.1, 0.3, 0.22), warmSconceMaterial);
    sconce.position.set(x, 3.4, -5.52);
    garage.add(sconce);
  }

  scene.add(garage);
  // Tight 9m shadow frustum at 512: the garage is 18m wide and the car sits at the
  // center, so texels concentrate on the car instead of empty floor (was 50m @ 1024).
  const rig = createArenaLightRig(scene, {
    intensityScale: 0.04,
    shadowMapSize: 512,
    shadowHalfExtent: 9,
  });
  rig.update({ x: 0, z: 0 });
  scene.environment = bakeArenaEnvironment(renderer);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let targetYaw = 0.75;
  let yaw = targetYaw;
  let targetPitch = 0.18;
  let pitch = targetPitch;
  let targetDistance = 7.2;
  let distance = targetDistance;
  let pauseAutoSpinUntil = 0;
  let isActive = false;
  let disposed = false;
  const scratchPos = new Vector3();

  const pauseAutoSpin = () => {
    pauseAutoSpinUntil = performance.now() + 22000;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!isActive) return;
    pauseAutoSpin();
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!isActive || !dragging) return;
    event.preventDefault();
    pauseAutoSpin();
    targetYaw += (event.clientX - lastX) * 0.008;
    targetPitch = clamp(targetPitch + (event.clientY - lastY) * 0.003, -0.22, 0.42);
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  const onLostPointerCapture = () => {
    dragging = false;
  };
  const onWheel = (event: WheelEvent) => {
    if (!isActive) return;
    event.preventDefault();
    pauseAutoSpin();
    targetDistance = clamp(targetDistance + event.deltaY * 0.006, 4.8, 9.5);
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("lostpointercapture", onLostPointerCapture);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
    root: scene,
    camera,
    carView,
    setActive(active: boolean) {
      isActive = active;
      if (!active) dragging = false;
    },
    applyCustomization(next: CarCustomization) {
      carView.applyCustomization(next);
    },
    whenReady() {
      return carView.whenReady();
    },
    getLoadState() {
      return carView.getLoadState();
    },
    setAspect(aspect: number) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(dt: number) {
      if (disposed || !isActive) return;
      yaw = lerp(yaw, targetYaw, 1 - Math.pow(0.0005, dt));
      pitch = lerp(pitch, targetPitch, 1 - Math.pow(0.0005, dt));
      distance = lerp(distance, targetDistance, 1 - Math.pow(0.0005, dt));

      if (performance.now() > pauseAutoSpinUntil) car.heading += dt * 0.18;
      const t = performance.now() * 0.001;
      car.bodyRoll = Math.sin(t * 1.2) * 0.015;
      car.bodyPitch = Math.sin(t * 0.9) * 0.01;
      car.suspensionFL = 0.5 + Math.sin(t * 1.1) * 0.08;
      car.suspensionFR = 0.5 + Math.sin(t * 1.1 + 0.3) * 0.08;
      car.suspensionRL = 0.5 + Math.sin(t * 0.9) * 0.08;
      car.suspensionRR = 0.5 + Math.sin(t * 0.9 + 0.3) * 0.08;
      carView.sync(car);

      const height = 1.8 + pitch * 3.2;
      scratchPos.set(Math.sin(yaw) * distance, height, Math.cos(yaw) * distance);
      camera.position.copy(scratchPos);
      camera.lookAt(0, 0.8, 0);
    },
    render() {
      if (disposed) return;
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
      canvas.removeEventListener("wheel", onWheel);
      rig.dispose();
      carView.dispose();
      // Dispose garage geometries and materials
      const disposedMats = new Set<unknown>();
      const disposedGeos = new Set<unknown>();
      garage.traverse((child) => {
        if (child instanceof Mesh) {
          if (!disposedGeos.has(child.geometry)) {
            disposedGeos.add(child.geometry);
            child.geometry.dispose();
          }
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of materials) {
            if (mat && !disposedMats.has(mat)) {
              disposedMats.add(mat);
              (mat as MeshStandardMaterial).dispose();
            }
          }
        }
      });
      // Dispose arena environment
      if (scene.environment) {
        (scene.environment as unknown as { dispose?: () => void }).dispose?.();
      }
    },
  };
}
