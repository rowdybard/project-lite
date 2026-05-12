import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import type { CarState } from "../../game/types";

type Puff = {
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  life: number;
  maxLife: number;
};

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;
const maxPuffs = 90;

export function createTireSmoke() {
  const root = new Group();
  const puffs: Puff[] = [];
  let spawnDebt = 0;

  function rearWheelPositions(car: CarState) {
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    return rearOffsets.map((x) => ({
      x: car.position.x + x * cos + rearAxleZ * sin,
      z: car.position.z - x * sin + rearAxleZ * cos,
    }));
  }

  function spawn(car: CarState, strength: number) {
    for (const point of rearWheelPositions(car)) {
      const material = new MeshBasicMaterial({
        color: 0xc6c8c5,
        depthWrite: false,
        opacity: 0.18 + strength * 0.24,
        transparent: true,
      });
      const mesh = new Mesh(new SphereGeometry(0.34 + strength * 0.36, 10, 8), material);
      mesh.position.set(point.x, 0.28, point.z);
      mesh.scale.set(1.25, 0.32, 1);
      root.add(mesh);
      puffs.push({ mesh, life: 0.75 + strength * 0.45, maxLife: 0.75 + strength * 0.45 });
    }

    while (puffs.length > maxPuffs) {
      const puff = puffs.shift();
      if (!puff) break;
      root.remove(puff.mesh);
      puff.mesh.geometry.dispose();
      puff.mesh.material.dispose();
    }
  }

  return {
    root,
    reset() {
      spawnDebt = 0;
      for (const puff of puffs.splice(0)) {
        root.remove(puff.mesh);
        puff.mesh.geometry.dispose();
        puff.mesh.material.dispose();
      }
    },
    update(car: CarState, onTrack: boolean, dt: number) {
      const strength = Math.max(car.tireHeat * 0.9, car.rearSlipVisual * 0.65) * (onTrack ? 1 : 0.35);
      spawnDebt += strength * car.speed * dt * 0.22;

      while (spawnDebt > 1 && strength > 0.18) {
        spawn(car, strength);
        spawnDebt -= 1;
      }

      for (let i = puffs.length - 1; i >= 0; i--) {
        const puff = puffs[i];
        puff.life -= dt;
        puff.mesh.position.y += dt * 0.44;
        puff.mesh.scale.multiplyScalar(1 + dt * 0.75);
        puff.mesh.material.opacity = Math.max(0, (puff.life / puff.maxLife) * 0.35);

        if (puff.life <= 0) {
          puffs.splice(i, 1);
          root.remove(puff.mesh);
          puff.mesh.geometry.dispose();
          puff.mesh.material.dispose();
        }
      }
    },
  };
}
