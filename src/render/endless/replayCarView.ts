import { CircleGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import type { CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";
import { createCarView } from "../objects/carView";

export function createReplayCarView(scale = 1) {
  const root = new Group();
  const carView = createCarView(scale);
  const replayMarker = new Mesh(
    new CircleGeometry(2.45, 40),
    new MeshBasicMaterial({
      color: 0x35c9ff,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );
  replayMarker.rotation.x = -Math.PI / 2;
  replayMarker.position.y = 0.105;
  root.add(replayMarker, carView.root);

  return {
    root,
    sync(car: CarState) {
      carView.sync(car);
      replayMarker.position.x = car.position.x;
      replayMarker.position.z = car.position.z;
    },
    applyCustomization(customization: CarCustomization) {
      carView.applyCustomization(customization);
    },
    whenReady() {
      return carView.whenReady();
    },
    dispose() {
      replayMarker.geometry.dispose();
      (replayMarker.material as MeshBasicMaterial).dispose();
      carView.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
