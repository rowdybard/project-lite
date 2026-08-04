import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { CarState } from "../../game/types";

type TrackPoint = { x: number; z: number };

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;
const maxMarks = 520;

export function createTireTracks() {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    opacity: 0.44,
    transparent: true,
    vertexColors: true,
  });
  const marks = new InstancedMesh(new BoxGeometry(1, 0.012, 1), material, maxMarks);
  marks.count = 0;
  marks.instanceMatrix.setUsage(DynamicDrawUsage);
  marks.renderOrder = 11;
  root.add(marks);

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const color = new Color();
  let previous: TrackPoint[] | null = null;
  let nextMark = 0;

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

    position.set((from.x + to.x) * 0.5, 0.095, (from.z + to.z) * 0.5);
    quaternion.setFromAxisAngle(up, Math.atan2(dx, dz));
    scale.set(0.28 + strength * 0.18, 1, length);
    matrix.compose(position, quaternion, scale);
    marks.setMatrixAt(nextMark, matrix);
    color.setScalar(0.2 - Math.min(0.11, strength * 0.09));
    marks.setColorAt(nextMark, color);
    nextMark = (nextMark + 1) % maxMarks;
    marks.count = Math.min(maxMarks, marks.count + 1);
    marks.instanceMatrix.needsUpdate = true;
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
  }

  return {
    root,
    reset() {
      previous = null;
      nextMark = 0;
      marks.count = 0;
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
