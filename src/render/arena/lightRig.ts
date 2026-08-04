import {
  DirectionalLight,
  HemisphereLight,
  Object3D,
  Vector3,
  type Scene,
} from "three";
import type { Vec2 } from "../../game/types";
import { arenaPalette } from "./palette";

export type ArenaLightRigConfig = {
  // Scales every intensity (small venues like the garage reuse the palette at ~0.04).
  intensityScale?: number;
  shadowMapSize?: number;
  // Half-extent of the shadow ortho frustum in world meters. The arena defaults to 25
  // (covers the car's travel); small venues like the garage pass a tighter value so the
  // shadow texels concentrate on the subject instead of empty floor.
  shadowHalfExtent?: number;
};

export type ArenaLightRig = {
  update(focus: Vec2): void;
  dispose(): void;
};

const SHADOW_HALF_EXTENT = 25;

// The ONLY module allowed to add lights to an arena scene. IBL-dominant design: the baked
// environment (environmentBake.ts) carries the ambient load, and directionals add direction
// and form — DirectionalLight has NO distance falloff, so it lights a 336m hall evenly,
// which the v1 spot array physically could not. Exactly one shadow map total, ever: a single
// cool key whose tight ortho frustum follows the car (texel-snapped to stop swimming).
export function createArenaLightRig(scene: Scene, config: ArenaLightRigConfig = {}): ArenaLightRig {
  const lights: Object3D[] = [];
  const scale = config.intensityScale ?? 1;
  const mapSize = config.shadowMapSize ?? arenaPalette.shadowMapSize;
  const shadowHalfExtent = config.shadowHalfExtent ?? SHADOW_HALF_EXTENT;

  const hemi = new HemisphereLight(arenaPalette.hemiSky, arenaPalette.hemiGround, arenaPalette.hemiIntensity);
  lights.push(hemi);

  const key = new DirectionalLight(arenaPalette.keyColor, arenaPalette.keyIntensity * scale);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(mapSize);
  key.shadow.camera.left = -shadowHalfExtent;
  key.shadow.camera.right = shadowHalfExtent;
  key.shadow.camera.top = shadowHalfExtent;
  key.shadow.camera.bottom = -shadowHalfExtent;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 90;
  key.shadow.bias = arenaPalette.keyShadowBias;
  key.shadow.normalBias = arenaPalette.keyShadowNormalBias;
  const keyTarget = new Object3D();
  key.target = keyTarget;
  lights.push(key, keyTarget);

  const fillCool = new DirectionalLight(arenaPalette.fillCoolColor, arenaPalette.fillCoolIntensity * scale);
  fillCool.position.set(60, 30, -55);
  lights.push(fillCool);

  const fillWarm = new DirectionalLight(arenaPalette.fillWarmColor, arenaPalette.fillWarmIntensity * scale);
  fillWarm.position.set(-45, 12, 60);
  lights.push(fillWarm);

  scene.add(...lights);
  console.assert(
    lights.filter((light) => light instanceof DirectionalLight && light.castShadow).length === 1,
    "ArenaLightRig: exactly one shadow-casting light is allowed",
  );

  // Fixed light direction; the frustum slides with the car. Snapping the follow point to
  // shadow-texel increments keeps the shadow edge stable while the camera moves.
  const lightDirection = new Vector3(
    arenaPalette.keyDirectionX,
    arenaPalette.keyDirectionY,
    arenaPalette.keyDirectionZ,
  ).normalize();
  const lightDistance = 48;
  const texelWorld = (shadowHalfExtent * 2) / mapSize;

  return {
    update(focus: Vec2) {
      const snappedX = Math.round(focus.x / texelWorld) * texelWorld;
      const snappedZ = Math.round(focus.z / texelWorld) * texelWorld;
      keyTarget.position.set(snappedX, 0, snappedZ);
      key.position.set(
        snappedX - lightDirection.x * lightDistance,
        -lightDirection.y * lightDistance,
        snappedZ - lightDirection.z * lightDistance,
      );
      keyTarget.updateMatrixWorld();
    },
    dispose() {
      scene.remove(...lights);
      key.shadow.map?.dispose();
    },
  };
}
