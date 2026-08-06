import {
  Box3,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import type {
  CollisionProfileId,
  StaticCollider,
  BoxCollider,
  CircleCollider,
} from "../../game/simulation/collisionTypes";

type ColliderMetadata =
  | {
      shape: "box";
      profile: CollisionProfileId;
      cameraObstruction?: boolean;
      padding?: number;
    }
  | {
      shape: "circle";
      profile: CollisionProfileId;
      cameraObstruction?: boolean;
      padding?: number;
    };

const COLLIDER_KEY = "driftAttackCollider";

const carCollisionMinY = 0.18;
const carCollisionMaxY = 1.65;

// Scratch objects reused across collection to avoid per-instance allocations
const _worldBox = new Box3();
const _groupLocalBox = new Box3();
const _childBox = new Box3();
const _v = new Vector3();
const _localCenter = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _instanceMatrix = new Matrix4();
const _composed = new Matrix4();
const _inverseGroupWorld = new Matrix4();
const _childToGroup = new Matrix4();

export function markBoxCollider<T extends Object3D>(
  object: T,
  options: Omit<Extract<ColliderMetadata, { shape: "box" }>, "shape">,
): T {
  object.userData[COLLIDER_KEY] = {
    shape: "box",
    ...options,
  } satisfies ColliderMetadata;
  return object;
}

export function markCircleCollider<T extends Object3D>(
  object: T,
  options: Omit<
    Extract<ColliderMetadata, { shape: "circle" }>,
    "shape"
  >,
): T {
  object.userData[COLLIDER_KEY] = {
    shape: "circle",
    ...options,
  } satisfies ColliderMetadata;
  return object;
}

/** Mark a mesh as a dynamic cone (collected separately, not as a static collider). */
export function markDynamicCone<T extends Mesh>(
  mesh: T,
  id: string,
  radius = 0.38,
): T {
  mesh.userData.dynamicCone = { id, radius };
  return mesh;
}

export function collectAuthoredColliders(
  root: Object3D,
  idPrefix: string,
): StaticCollider[] {
  root.updateMatrixWorld(true);

  const colliders: StaticCollider[] = [];
  let runningIndex = 0;

  root.traverse((object) => {
    const meta = object.userData[COLLIDER_KEY] as ColliderMetadata | undefined;
    if (!meta) return;

    if (object instanceof InstancedMesh) {
      collectInstanced(object, meta, idPrefix, colliders, () => runningIndex++);
      return;
    }

    if (object instanceof Mesh) {
      collectMesh(object, meta, idPrefix, colliders, () => runningIndex++);
      return;
    }

    // Group — use its complete world Box3
    if (object instanceof Object3D && !(object instanceof Mesh)) {
      collectGroup(object, meta, idPrefix, colliders, () => runningIndex++);
    }
  });

  return colliders;
}

function makeId(prefix: string, name: string | undefined, index: number): string {
  return `${prefix}:${name || "object"}:${index}`;
}

function passesHeightFilter(minY: number, maxY: number): boolean {
  return maxY >= carCollisionMinY && minY <= carCollisionMaxY;
}

function collectMesh(
  mesh: Mesh,
  meta: ColliderMetadata,
  idPrefix: string,
  out: StaticCollider[],
  nextIndex: () => number,
) {
  const geometry = mesh.geometry;
  if (!geometry) return;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const localBox = geometry.boundingBox;
  if (!localBox) return;

  // World-space bounds
  _worldBox.copy(localBox).applyMatrix4(mesh.matrixWorld);
  if (!passesHeightFilter(_worldBox.min.y, _worldBox.max.y)) return;

  // Use local box center (not origin) transformed to world
  localBox.getCenter(_localCenter);
  _v.copy(_localCenter).applyMatrix4(mesh.matrixWorld);

  // Extract world rotation (Y up → yaw)
  mesh.matrixWorld.decompose(_v, _q, _s);
  _e.setFromQuaternion(_q, "YXZ");
  const angle = _e.y;

  const padding = meta.padding ?? 0;

  if (meta.shape === "box") {
    const halfLength = (localBox.max.x - localBox.min.x) * 0.5 * Math.abs(_s.x) + padding;
    const halfWidth = (localBox.max.z - localBox.min.z) * 0.5 * Math.abs(_s.z) + padding;
    if (halfLength <= 0 || halfWidth <= 0) return;
    const id = makeId(idPrefix, mesh.name, nextIndex());
    const collider: BoxCollider = {
      id,
      shape: "box",
      x: _v.x,
      z: _v.z,
      angle,
      halfLength,
      halfWidth,
      profile: meta.profile,
      cameraObstruction: meta.cameraObstruction ?? false,
    };
    out.push(collider);
  } else {
    const radius = Math.max(
      (localBox.max.x - localBox.min.x) * 0.5 * Math.abs(_s.x),
      (localBox.max.z - localBox.min.z) * 0.5 * Math.abs(_s.z),
    ) + padding;
    if (radius <= 0) return;
    const id = makeId(idPrefix, mesh.name, nextIndex());
    const collider: CircleCollider = {
      id,
      shape: "circle",
      x: _v.x,
      z: _v.z,
      radius,
      profile: meta.profile,
      cameraObstruction: meta.cameraObstruction ?? false,
    };
    out.push(collider);
  }
}

function collectGroup(
  group: Object3D,
  meta: ColliderMetadata,
  idPrefix: string,
  out: StaticCollider[],
  nextIndex: () => number,
) {
  // Build aggregate bounds in group-local coordinates to avoid
  // double-rotating a world AABB by the group's yaw.
  _groupLocalBox.makeEmpty();
  _inverseGroupWorld.copy(group.matrixWorld).invert();

  group.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) return;
    _childToGroup.multiplyMatrices(_inverseGroupWorld, child.matrixWorld);
    _childBox.copy(child.geometry.boundingBox).applyMatrix4(_childToGroup);
    _groupLocalBox.union(_childBox);
  });

  if (_groupLocalBox.isEmpty()) return;

  // Check world-space height filter
  _worldBox.copy(_groupLocalBox).applyMatrix4(group.matrixWorld);
  if (!passesHeightFilter(_worldBox.min.y, _worldBox.max.y)) return;

  // Local center transformed to world
  _groupLocalBox.getCenter(_localCenter);
  _v.copy(_localCenter).applyMatrix4(group.matrixWorld);

  group.matrixWorld.decompose(_v, _q, _s);
  _e.setFromQuaternion(_q, "YXZ");
  const angle = _e.y;

  const padding = meta.padding ?? 0;

  if (meta.shape === "box") {
    const halfLength = (_groupLocalBox.max.x - _groupLocalBox.min.x) * 0.5 * Math.abs(_s.x) + padding;
    const halfWidth = (_groupLocalBox.max.z - _groupLocalBox.min.z) * 0.5 * Math.abs(_s.z) + padding;
    if (halfLength <= 0 || halfWidth <= 0) return;
    const id = makeId(idPrefix, group.name, nextIndex());
    out.push({
      id,
      shape: "box",
      x: _v.x,
      z: _v.z,
      angle,
      halfLength,
      halfWidth,
      profile: meta.profile,
      cameraObstruction: meta.cameraObstruction ?? false,
    });
  } else {
    const radius = Math.max(
      (_groupLocalBox.max.x - _groupLocalBox.min.x) * 0.5 * Math.abs(_s.x),
      (_groupLocalBox.max.z - _groupLocalBox.min.z) * 0.5 * Math.abs(_s.z),
    ) + padding;
    if (radius <= 0) return;
    const id = makeId(idPrefix, group.name, nextIndex());
    out.push({
      id,
      shape: "circle",
      x: _v.x,
      z: _v.z,
      radius,
      profile: meta.profile,
      cameraObstruction: meta.cameraObstruction ?? false,
    });
  }
}

function collectInstanced(
  mesh: InstancedMesh,
  meta: ColliderMetadata,
  idPrefix: string,
  out: StaticCollider[],
  nextIndex: () => number,
) {
  const geometry = mesh.geometry;
  if (!geometry) return;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const localBox = geometry.boundingBox;
  if (!localBox) return;

  const padding = meta.padding ?? 0;
  localBox.getCenter(_localCenter);
  const localHalfX = (localBox.max.x - localBox.min.x) * 0.5 + padding;
  const localHalfZ = (localBox.max.z - localBox.min.z) * 0.5 + padding;

  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _instanceMatrix);
    _composed.multiplyMatrices(mesh.matrixWorld, _instanceMatrix);
    _worldBox.copy(localBox).applyMatrix4(_composed);
    if (!passesHeightFilter(_worldBox.min.y, _worldBox.max.y)) continue;

    // Use local box center (not origin) transformed to world
    _v.copy(_localCenter).applyMatrix4(_composed);
    _composed.decompose(_v, _q, _s);
    _e.setFromQuaternion(_q, "YXZ");
    const angle = _e.y;

    if (meta.shape === "box") {
      const halfLength = localHalfX * Math.abs(_s.x);
      const halfWidth = localHalfZ * Math.abs(_s.z);
      if (halfLength <= 0 || halfWidth <= 0) continue;
      const id = makeId(idPrefix, mesh.name, nextIndex());
      out.push({
        id,
        shape: "box",
        x: _v.x,
        z: _v.z,
        angle,
        halfLength,
        halfWidth,
        profile: meta.profile,
        cameraObstruction: meta.cameraObstruction ?? false,
      });
    } else {
      const radius = Math.max(localHalfX * Math.abs(_s.x), localHalfZ * Math.abs(_s.z));
      if (radius <= 0) continue;
      const id = makeId(idPrefix, mesh.name, nextIndex());
      out.push({
        id,
        shape: "circle",
        x: _v.x,
        z: _v.z,
        radius,
        profile: meta.profile,
        cameraObstruction: meta.cameraObstruction ?? false,
      });
    }
  }
}

/** Collect dynamic cone meshes marked with markDynamicCone. */
export function collectDynamicCones(
  root: Object3D,
): { meshes: Mesh[]; cones: import("../../game/simulation/trackCollision").Cone[] } {
  root.updateMatrixWorld(true);

  const meshes: Mesh[] = [];
  const cones: import("../../game/simulation/trackCollision").Cone[] = [];
  let idx = 0;

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const meta = object.userData.dynamicCone as { id: string; radius: number } | undefined;
    if (!meta) return;

    _v.set(0, 0, 0);
    object.getWorldPosition(_v);

    meshes.push(object);
    cones.push({
      id: meta.id,
      x: _v.x,
      z: _v.z,
      vx: 0,
      vz: 0,
      spin: 0,
      angularVelocity: 0,
      radius: meta.radius,
      knocked: false,
    });
    idx++;
  });

  return { meshes, cones };
}
