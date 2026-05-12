import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import type { CarState } from "../../game/types";

type TrackPoint = {
  x: number;
  z: number;
};

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;
const maxMarks = 520;

export function createTireTracks() {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: 0x08090a,
    depthWrite: false,
    opacity: 0.42,
    transparent: true,
  });
  const marks: Mesh[] = [];
  let previous: TrackPoint[] | null = null;

  function rearWheelPositions(car: CarState): TrackPoint[] {
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);

    return rearOffsets.map((x) => ({
      x: car.position.x + x * cos + rearAxleZ * sin,
      z: car.position.z - x * sin + rearAxleZ * cos,
    }));
  }

  function addMark(from: TrackPoint, to: TrackPoint, strength: number) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.1) return;

    const mark = new Mesh(new BoxGeometry(0.28 + strength * 0.18, 0.012, length), material.clone());
    mark.position.set((from.x + to.x) * 0.5, 0.095, (from.z + to.z) * 0.5);
    mark.rotation.y = Math.atan2(dx, dz);
    mark.receiveShadow = false;
    (mark.material as MeshBasicMaterial).opacity = 0.18 + strength * 0.42;
    root.add(mark);
    marks.push(mark);

    while (marks.length > maxMarks) {
      const oldest = marks.shift();
      if (!oldest) break;
      root.remove(oldest);
      oldest.geometry.dispose();
      (oldest.material as MeshBasicMaterial).dispose();
    }
  }

  return {
    root,
    reset() {
      previous = null;
      for (const mark of marks.splice(0)) {
        root.remove(mark);
        mark.geometry.dispose();
        (mark.material as MeshBasicMaterial).dispose();
      }
    },
    update(car: CarState, onTrack: boolean) {
      const current = rearWheelPositions(car);
      const strength = Math.max(car.rearSlipVisual, car.handbrakeAmount * 0.72, car.slipAmount * 0.55);

      if (previous && onTrack && car.speed > 1.4 && strength > 0.08) {
        addMark(previous[0], current[0], strength);
        addMark(previous[1], current[1], strength);
      }

      previous = current;
    },
  };
}
