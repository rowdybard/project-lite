import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  Vector3,
} from "three";
import type { CarState } from "../../game/types";

// Skid marks v2: a continuous ribbon mesh per rear wheel.
//
// Each wheel keeps a ring buffer of path samples (position + width + strength).
// Every frame we rebuild a triangle strip from the live samples: two vertices per
// sample (left/right edge of the tire contact patch), oriented perpendicular to the
// travel direction, with per-vertex color carrying darkness and alpha carrying fade.
// A small tread alpha texture tiles along the ribbon so the marks read as rubber,
// not as a flat black stripe.

type Sample = {
  x: number;
  z: number;
  // Perpendicular axis (unit) — the direction across the tire contact patch.
  nx: number;
  nz: number;
  width: number;
  strength: number;
  age: number;
};

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;
const maxSamplesPerWheel = 220;
const ribbonY = 0.096;
const tireWidth = 0.24;

function buildTreadTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Mostly opaque rubber with faint lateral tread grooves so the mark breaks up
  // slightly along its length. Alpha is high — the ribbon color/alpha do the heavy lifting.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  for (let y = 0; y < size; y += 12) {
    ctx.fillRect(0, y, size, 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

export function createTireTracks() {
  const root = new Group();
  const treadTexture = buildTreadTexture();
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    transparent: true,
    vertexColors: true,
    side: DoubleSide,
    alphaMap: treadTexture,
  });
  // Two ribbons (left + right rear wheel). Each sample -> 2 vertices -> 2 triangles.
  // Preallocate vertex/index buffers for the max; indices are rewritten contiguously
  // each frame so a single drawRange covers both wheels' live strips with no gaps.
  const maxVertsPerWheel = maxSamplesPerWheel * 2;
  const totalVerts = maxVertsPerWheel * 2;
  const totalIndices = (maxSamplesPerWheel - 1) * 6 * 2;
  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint16Array(totalIndices);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 11;
  root.add(mesh);

  // Per-wheel ring buffer of samples.
  const wheels: {
    samples: Sample[];
    head: number;
    count: number;
  }[] = [
    { samples: new Array(maxSamplesPerWheel), head: 0, count: 0 },
    { samples: new Array(maxSamplesPerWheel), head: 0, count: 0 },
  ];
  const previousPos: (Vector3 | null)[] = [null, null];
  const color = new Color();

  function rearWheelPositions(car: CarState): { x: number; z: number; nx: number; nz: number }[] {
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    // Forward axis (unit) in world space — used to derive the perpendicular (nx, nz).
    const fx = sin;
    const fz = cos;
    // Perpendicular (right of travel) — rotate forward by -90°.
    const px = -fz;
    const pz = fx;
    return rearOffsets.map((x) => ({
      x: car.position.x + x * cos + rearAxleZ * sin,
      z: car.position.z - x * sin + rearAxleZ * cos,
      nx: px,
      nz: pz,
    }));
  }

  function pushSample(wheelIndex: number, pos: { x: number; z: number; nx: number; nz: number }, strength: number) {
    const w = wheels[wheelIndex];
    const prev = previousPos[wheelIndex];
    if (prev) {
      const dx = pos.x - prev.x;
      const dz = pos.z - prev.z;
      if (Math.hypot(dx, dz) < 0.06) return; // dedupe tiny moves
    }
    const width = tireWidth * (0.85 + Math.min(0.4, strength * 0.5));
    w.samples[w.head] = { x: pos.x, z: pos.z, nx: pos.nx, nz: pos.nz, width, strength, age: 0 };
    w.head = (w.head + 1) % maxSamplesPerWheel;
    if (w.count < maxSamplesPerWheel) w.count++;
    previousPos[wheelIndex] = new Vector3(pos.x, 0, pos.z);
  }

  function rebuild() {
    let indexCursor = 0;
    let vertCursor = 0;
    for (let wheelIndex = 0; wheelIndex < 2; wheelIndex++) {
      const w = wheels[wheelIndex];
      if (w.count < 2) continue;
      // Walk the ring buffer from oldest to newest; write vertices contiguously.
      const start = (w.head - w.count + maxSamplesPerWheel) % maxSamplesPerWheel;
      const wheelVertBase = vertCursor;
      let localVerts = 0;
      for (let i = 0; i < w.count; i++) {
        const idx = (start + i) % maxSamplesPerWheel;
        const s = w.samples[idx]!;
        // Fade alpha with age: full strength at head, fades to 0 over the buffer length.
        const ageNorm = i / Math.max(1, w.count - 1);
        const fade = 1 - ageNorm * 0.85;
        const intensity = Math.min(1, s.strength) * fade;
        const darkness = 0.06 + (1 - intensity) * 0.04; // near-black when laying down
        const alpha = intensity * 0.62;
        const halfW = s.width * 0.5;
        const lx = s.x - s.nx * halfW;
        const lz = s.z - s.nz * halfW;
        const rx = s.x + s.nx * halfW;
        const rz = s.z + s.nz * halfW;
        const vBase = wheelVertBase + localVerts * 2;
        positions[vBase * 3] = lx;
        positions[vBase * 3 + 1] = ribbonY;
        positions[vBase * 3 + 2] = lz;
        positions[(vBase + 1) * 3] = rx;
        positions[(vBase + 1) * 3 + 1] = ribbonY;
        positions[(vBase + 1) * 3 + 2] = rz;
        // Vertex color carries darkness; alpha is baked via a separate trick —
        // MeshBasicMaterial with vertexColors multiplies color, and we use the alphaMap
        // for tread. To get per-vertex alpha we encode it into the color's luminance
        // (since the material is transparent and we want fade). We use a dark color
        // scaled by (darkness * alpha) so faded marks blend out against the asphalt.
        const lum = darkness * alpha;
        color.setRGB(lum, lum, lum);
        colors[vBase * 3] = color.r;
        colors[vBase * 3 + 1] = color.g;
        colors[vBase * 3 + 2] = color.b;
        colors[(vBase + 1) * 3] = color.r;
        colors[(vBase + 1) * 3 + 1] = color.g;
        colors[(vBase + 1) * 3 + 2] = color.b;
        // UV: U across width (0..1), V along length (accumulate distance).
        uvs[vBase * 2] = 0;
        uvs[vBase * 2 + 1] = i * 0.5;
        uvs[(vBase + 1) * 2] = 1;
        uvs[(vBase + 1) * 2 + 1] = i * 0.5;
        localVerts++;
      }
      // Write the strip indices for this wheel contiguously into the shared index buffer.
      for (let i = 0; i < w.count - 1; i++) {
        const a = wheelVertBase + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices[indexCursor++] = a;
        indices[indexCursor++] = b;
        indices[indexCursor++] = c;
        indices[indexCursor++] = c;
        indices[indexCursor++] = b;
        indices[indexCursor++] = d;
      }
      vertCursor += localVerts * 2;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    const idxAttr = geometry.index;
    if (idxAttr) idxAttr.needsUpdate = true;
    geometry.setDrawRange(0, indexCursor);
    geometry.computeBoundingSphere();
  }

  return {
    root,
    reset() {
      for (const w of wheels) {
        w.head = 0;
        w.count = 0;
      }
      previousPos[0] = null;
      previousPos[1] = null;
      geometry.setDrawRange(0, 0);
    },
    update(car: CarState, onTrack: boolean) {
      const positions2 = rearWheelPositions(car);
      const strength = Math.max(car.rearSlipVisual, car.handbrakeAmount * 0.72, car.slipAmount * 0.55);
      if (onTrack && car.speed > 1.4 && strength > 0.08) {
        pushSample(0, positions2[0]!, strength);
        pushSample(1, positions2[1]!, strength);
      } else {
        // When not slipping, break the ribbon by resetting the previous-pos link so the
        // next slip starts a fresh strip rather than drawing a connecting segment.
        previousPos[0] = null;
        previousPos[1] = null;
      }
      // Age existing samples so old marks fade even while still slipping.
      for (const w of wheels) {
        if (w.count === 0) continue;
        const start = (w.head - w.count + maxSamplesPerWheel) % maxSamplesPerWheel;
        for (let i = 0; i < w.count; i++) {
          const idx = (start + i) % maxSamplesPerWheel;
          const s = w.samples[idx];
          if (s) s.age += 1;
        }
      }
      rebuild();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      treadTexture.dispose();
    },
  };
}
