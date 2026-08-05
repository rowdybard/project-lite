import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from "three";
import type { ObstacleCar } from "../../game/endless/endlessObstacles";

// Simple box-car renderer for obstacle traffic. Reuses the procedural car
// aesthetic but stripped down — no paint detail, no shadow blob, just a
// readable silhouette at speed.

const roofMaterial = new MeshStandardMaterial({ color: 0x2a323a, roughness: 0.7, metalness: 0.2 });
const lightMaterial = new MeshStandardMaterial({
  color: 0xffcc66,
  emissive: 0xff9933,
  emissiveIntensity: 1.5,
  roughness: 0.4,
});

const bodyGeo = new BoxGeometry(2.6, 0.8, 5.6);
const roofGeo = new BoxGeometry(2.3, 0.7, 2.8);
const lightGeo = new BoxGeometry(0.3, 0.2, 0.1);

const carColors = [0x8a3a3a, 0x3a5a8a, 0x5a7a4a, 0x7a7a3a, 0x6a4a7a, 0x4a6a6a];

export type ObstacleCarView = {
  root: Group;
  update(obstacles: readonly ObstacleCar[]): void;
  reset(): void;
};

export function createObstacleCarView(scene: Scene): ObstacleCarView {
  const root = new Group();
  root.name = "obstacle-cars";
  scene.add(root);

  const pool: { group: Group; body: Mesh }[] = [];
  const maxCars = 14;

  for (let i = 0; i < maxCars; i++) {
    const group = new Group();
    const color = carColors[i % carColors.length];
    const mat = new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 });
    const body = new Mesh(bodyGeo, mat);
    body.position.y = 0.55;
    body.castShadow = true;
    group.add(body);
    const roof = new Mesh(roofGeo, roofMaterial);
    roof.position.set(0, 1.15, -0.2);
    roof.castShadow = true;
    group.add(roof);
    const headlightL = new Mesh(lightGeo, lightMaterial);
    headlightL.position.set(-0.85, 0.55, 2.8);
    group.add(headlightL);
    const headlightR = new Mesh(lightGeo, lightMaterial);
    headlightR.position.set(0.85, 0.55, 2.8);
    group.add(headlightR);
    group.visible = false;
    root.add(group);
    pool.push({ group, body });
  }

  const update = (obstacles: readonly ObstacleCar[]) => {
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      const obs = obstacles[i];
      if (obs && obs.alive) {
        slot.group.visible = true;
        slot.group.position.set(obs.position.x, 0, obs.position.z);
        slot.group.rotation.y = obs.heading;
      } else {
        slot.group.visible = false;
      }
    }
  };

  const reset = () => {
    for (const slot of pool) slot.group.visible = false;
  };

  return { root, update, reset };
}
