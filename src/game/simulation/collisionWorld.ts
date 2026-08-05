import type { BoxCollider, CircleCollider, StaticCollider } from "./collisionTypes";

const CELL_SIZE = 16;
const __DEV__ = import.meta.env?.DEV ?? false;

type CellKey = number; // packed y * 1000000 + x

function packCell(cx: number, cz: number): CellKey {
  // Offset to keep indices positive; cells range roughly -32768..32767
  return (cz + 32768) * 65536 + (cx + 32768);
}

function boxAabb(box: BoxCollider): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const cos = Math.abs(Math.cos(box.angle));
  const sin = Math.abs(Math.sin(box.angle));
  const extentX = cos * box.halfLength + sin * box.halfWidth;
  const extentZ = sin * box.halfLength + cos * box.halfWidth;
  return {
    minX: box.x - extentX,
    minZ: box.z - extentZ,
    maxX: box.x + extentX,
    maxZ: box.z + extentZ,
  };
}

function circleAabb(c: CircleCollider): { minX: number; minZ: number; maxX: number; maxZ: number } {
  return {
    minX: c.x - c.radius,
    minZ: c.z - c.radius,
    maxX: c.x + c.radius,
    maxZ: c.z + c.radius,
  };
}

export type CollisionWorld = {
  readonly colliders: readonly StaticCollider[];
  readonly cameraObstructions: readonly BoxCollider[];
  queryAabb(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): readonly StaticCollider[];
};

export function createCollisionWorld(
  colliders: readonly StaticCollider[],
): CollisionWorld {
  const cells = new Map<CellKey, StaticCollider[]>();
  const cameraObstructions: BoxCollider[] = [];

  for (const collider of colliders) {
    if (__DEV__) {
      if (!Number.isFinite(collider.x) || !Number.isFinite(collider.z)) {
        console.warn("[collisionWorld] Non-finite collider position", collider);
        continue;
      }
    }

    const aabb =
      collider.shape === "box" ? boxAabb(collider) : circleAabb(collider);

    if (__DEV__) {
      if (aabb.maxX - aabb.minX <= 0 || aabb.maxZ - aabb.minZ <= 0) {
        throw new Error(`[collisionWorld] Zero/negative dimensions on collider ${collider.id}`);
      }
    } else {
      if (aabb.maxX - aabb.minX <= 0 || aabb.maxZ - aabb.minZ <= 0) continue;
    }

    if (collider.shape === "box" && collider.cameraObstruction) {
      cameraObstructions.push(collider);
    }

    const minCx = Math.floor(aabb.minX / CELL_SIZE);
    const maxCx = Math.floor(aabb.maxX / CELL_SIZE);
    const minCz = Math.floor(aabb.minZ / CELL_SIZE);
    const maxCz = Math.floor(aabb.maxZ / CELL_SIZE);

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = packCell(cx, cz);
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(collider);
      }
    }
  }

  function queryAabb(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): readonly StaticCollider[] {
    const minCx = Math.floor(minX / CELL_SIZE);
    const maxCx = Math.floor(maxX / CELL_SIZE);
    const minCz = Math.floor(minZ / CELL_SIZE);
    const maxCz = Math.floor(maxZ / CELL_SIZE);

    const seen = new Set<string>();
    const result: StaticCollider[] = [];

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = packCell(cx, cz);
        const bucket = cells.get(key);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (seen.has(collider.id)) continue;
          seen.add(collider.id);
          result.push(collider);
        }
      }
    }

    return result;
  }

  return {
    colliders,
    cameraObstructions,
    queryAabb,
  };
}
