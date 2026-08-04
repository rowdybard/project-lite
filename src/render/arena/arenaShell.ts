import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { arenaPalette } from "./palette";

export type SodiumAnchor = { position: Vector3; target: Vector3 };

export type ArenaBounds = { centerX: number; centerZ: number; width: number; depth: number };

export type ArenaShellResult = {
  group: Group;
  ceilingY: number;
  trussY: number;
  floodAnchors: Vector3[];
  sodiumAnchors: SodiumAnchor[];
};

export function createIndoorVenueSign(label: string, accent: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#151b1e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${accent.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, 20);
  ctx.fillRect(0, canvas.height - 20, canvas.width, 20);
  ctx.fillStyle = "#f1eee2";
  ctx.font = "900 72px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 3);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return new Mesh(
    new PlaneGeometry(20, 5),
    new MeshStandardMaterial({
      map: texture,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: arenaPalette.signEmissiveIntensity,
      roughness: 0.68,
      side: DoubleSide,
    }),
  );
}

// Fully-enclosed industrial stadium shell: walls, roof, truss grid, emissive fixture housings.
// Geometry only — every actual light lives in the ArenaLightRig, positioned at the anchors
// returned here so fixtures and light sources always agree.
export function buildArenaShell(bounds: ArenaBounds): ArenaShellResult {
  const group = new Group();
  const ceilingY = 25;
  const roofY = 25.2;
  const trussY = roofY - 2.05;
  const fixtureY = roofY - 2.5;
  const inset = 4.5;
  const innerWidth = bounds.width - inset * 2;
  const innerDepth = bounds.depth - inset * 2;

  const wallMaterial = new MeshStandardMaterial({ color: arenaPalette.wallColor, roughness: 0.91, metalness: 0.03, side: DoubleSide });
  const bandMaterial = new MeshStandardMaterial({ color: arenaPalette.wallBandColor, roughness: 0.86, metalness: 0.06 });
  const pilasterMaterial = new MeshStandardMaterial({ color: arenaPalette.pilasterColor, roughness: 0.82, metalness: 0.12 });
  const roofMaterial = new MeshStandardMaterial({ color: arenaPalette.roofColor, roughness: 0.8, metalness: 0.2, side: DoubleSide });
  const steelMaterial = new MeshStandardMaterial({ color: arenaPalette.steelColor, roughness: 0.58, metalness: 0.5 });
  const stripeMaterial = new MeshStandardMaterial({ color: arenaPalette.accentColor, emissive: 0x351e04, roughness: 0.54 });
  const coolFixtureMaterial = new MeshStandardMaterial({
    color: 0xf4f8ff,
    emissive: arenaPalette.fixtureCoolEmissive,
    emissiveIntensity: arenaPalette.fixtureCoolIntensity,
    roughness: 0.3,
  });
  const warmFixtureMaterial = new MeshStandardMaterial({
    color: 0xffe0b8,
    emissive: arenaPalette.fixtureWarmEmissive,
    emissiveIntensity: arenaPalette.fixtureWarmIntensity,
    roughness: 0.34,
  });

  const wallSpecs = [
    { width: innerWidth, depth: 0.8, x: bounds.centerX, z: bounds.centerZ - innerDepth / 2, spanX: true },
    { width: innerWidth, depth: 0.8, x: bounds.centerX, z: bounds.centerZ + innerDepth / 2, spanX: true },
    { width: 0.8, depth: innerDepth, x: bounds.centerX - innerWidth / 2, z: bounds.centerZ, spanX: false },
    { width: 0.8, depth: innerDepth, x: bounds.centerX + innerWidth / 2, z: bounds.centerZ, spanX: false },
  ];

  for (const wall of wallSpecs) {
    const shell = new Mesh(new BoxGeometry(wall.width, ceilingY, wall.depth), wallMaterial);
    shell.position.set(wall.x, ceilingY / 2, wall.z);
    shell.receiveShadow = true;
    const stripe = new Mesh(new BoxGeometry(wall.width + 0.04, 0.5, wall.depth + 0.05), stripeMaterial);
    stripe.position.set(wall.x, 3.1, wall.z);
    const band = new Mesh(
      new BoxGeometry(wall.spanX ? wall.width : 0.24, 7.5, wall.spanX ? 0.24 : wall.depth),
      bandMaterial,
    );
    band.position.set(
      wall.spanX ? wall.x : wall.x + (wall.x < bounds.centerX ? 0.52 : -0.52),
      ceilingY - 3.75,
      wall.spanX ? wall.z + (wall.z < bounds.centerZ ? 0.52 : -0.52) : wall.z,
    );
    group.add(shell, stripe, band);
  }

  const roof = new Mesh(new BoxGeometry(innerWidth + 0.8, 0.5, innerDepth + 0.8), roofMaterial);
  roof.position.set(bounds.centerX, roofY, bounds.centerZ);
  roof.receiveShadow = true;
  group.add(roof);
  // The ceiling should catch light, not mirror the environment bake back at the camera.
  roofMaterial.envMapIntensity = 0.22;
  wallMaterial.envMapIntensity = 0.35;
  bandMaterial.envMapIntensity = 0.2;
  pilasterMaterial.envMapIntensity = 0.3;

  // Wall pilasters: vertical ribs so the walls don't read as flat slabs at speed.
  const pilasterSpacing = 12;
  const pilasterMatrices: Matrix4[] = [];
  const matrix = new Matrix4();
  const yaw90 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const identity = new Quaternion();
  for (const wall of wallSpecs) {
    const span = (wall.spanX ? wall.width : wall.depth) - 6;
    const count = Math.max(2, Math.round(span / pilasterSpacing));
    for (let i = 0; i <= count; i++) {
      const along = -span / 2 + (i / count) * span;
      const inward = 0.62;
      const x = wall.spanX ? wall.x + along : wall.x + (wall.x < bounds.centerX ? inward : -inward);
      const z = wall.spanX ? wall.z + (wall.z < bounds.centerZ ? inward : -inward) : wall.z + along;
      matrix.compose(
        new Vector3(x, ceilingY / 2, z),
        wall.spanX ? identity : yaw90,
        new Vector3(1, 1, 1),
      );
      pilasterMatrices.push(matrix.clone());
    }
  }
  const pilasters = new InstancedMesh(
    new BoxGeometry(0.62, ceilingY, 0.4),
    pilasterMaterial,
    pilasterMatrices.length,
  );
  pilasterMatrices.forEach((m, i) => pilasters.setMatrixAt(i, m));
  pilasters.instanceMatrix.needsUpdate = true;
  group.add(pilasters);

  // Overhanging grandstands: tiered seating banks start at 6m (above anything the car can
  // reach — it can drive 53m out, the tiers only lean inward overhead) and step up + inward
  // so the volume reads enclosed while the floor stays open. One instanced draw call.
  const tierCount = 8;
  const tierRise = 1.35;
  const tierDepth = 1.5;
  const tierBaseY = 6.7;
  const segmentLength = 14;
  const gapLength = 2.4;
  const seatColors = [new Color(0x35424e), new Color(0x424e59)];
  const tierMatrices: Matrix4[] = [];
  const tierColors: Color[] = [];
  const segmentScale = new Vector3();
  for (const wall of wallSpecs) {
    const span = (wall.spanX ? wall.width : wall.depth) - 8;
    const segments = Math.max(3, Math.floor(span / (segmentLength + gapLength)));
    const segmentSpan = span / segments;
    for (let s = 0; s < segments; s++) {
      const along = -span / 2 + (s + 0.5) * segmentSpan;
      for (let tier = 0; tier < tierCount; tier++) {
        const y = tierBaseY + tier * tierRise;
        const inward = 3.2 + tier * tierDepth;
        const x = wall.spanX ? wall.x + along : wall.x + (wall.x < bounds.centerX ? inward : -inward);
        const z = wall.spanX ? wall.z + (wall.z < bounds.centerZ ? inward : -inward) : wall.z + along;
        segmentScale.set(segmentSpan - gapLength, 1, 1);
        matrix.compose(new Vector3(x, y, z), wall.spanX ? yaw90 : identity, segmentScale);
        tierMatrices.push(matrix.clone());
        tierColors.push(seatColors[tier % 2]);
      }
    }
  }
  const tierMaterial = new MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 });
  tierMaterial.envMapIntensity = 0.4;
  const stands = new InstancedMesh(new BoxGeometry(1, tierRise, tierDepth), tierMaterial, tierMatrices.length);
  tierMatrices.forEach((m, i) => {
    stands.setMatrixAt(i, m);
    stands.setColorAt(i, tierColors[i]);
  });
  stands.instanceMatrix.needsUpdate = true;
  if (stands.instanceColor) stands.instanceColor.needsUpdate = true;
  group.add(stands);

  // Truss grid: main beams across the width plus cross purlins so the ceiling reads as structure.
  const trussCount = 9;
  const trusses = new InstancedMesh(new BoxGeometry(innerWidth - 1.2, 0.24, 0.28), steelMaterial, trussCount);
  for (let i = 0; i < trussCount; i++) {
    const z = bounds.centerZ - innerDepth * 0.4 + (i / (trussCount - 1)) * innerDepth * 0.8;
    matrix.makeTranslation(bounds.centerX, trussY, z);
    trusses.setMatrixAt(i, matrix);
  }
  trusses.instanceMatrix.needsUpdate = true;
  group.add(trusses);

  const purlinCount = 15;
  const purlins = new InstancedMesh(new BoxGeometry(0.18, 0.16, innerDepth - 1.2), steelMaterial, purlinCount);
  for (let i = 0; i < purlinCount; i++) {
    const x = bounds.centerX - innerWidth * 0.44 + (i / (purlinCount - 1)) * innerWidth * 0.88;
    matrix.makeTranslation(x, trussY + 0.2, bounds.centerZ);
    purlins.setMatrixAt(i, matrix);
  }
  purlins.instanceMatrix.needsUpdate = true;
  group.add(purlins);

  // Cool flood housings on every truss (18 total); these anchors drive the rig's SpotLights.
  const floodAnchors: Vector3[] = [];
  for (let trussIndex = 0; trussIndex < trussCount; trussIndex++) {
    const z = bounds.centerZ - innerDepth * 0.4 + (trussIndex / (trussCount - 1)) * innerDepth * 0.8;
    for (const offset of [-innerWidth * 0.3, innerWidth * 0.3]) {
      floodAnchors.push(new Vector3(bounds.centerX + offset, fixtureY, z));
    }
  }
  const housings = new InstancedMesh(new BoxGeometry(4.8, 0.18, 0.88), coolFixtureMaterial, floodAnchors.length);
  const mounts = new InstancedMesh(new BoxGeometry(0.24, 0.62, 0.24), steelMaterial, floodAnchors.length);
  floodAnchors.forEach((anchor, i) => {
    matrix.makeTranslation(anchor.x, anchor.y, anchor.z);
    housings.setMatrixAt(i, matrix);
    matrix.makeTranslation(anchor.x, anchor.y + 0.4, anchor.z);
    mounts.setMatrixAt(i, matrix);
  });
  housings.instanceMatrix.needsUpdate = true;
  mounts.instanceMatrix.needsUpdate = true;
  group.add(housings, mounts);

  // Warm sodium sconces at track level around the walls; anchors carry an aim point on the course.
  const sodiumAnchors: SodiumAnchor[] = [];
  const sodiumY = 6.4;
  const sodiumSpecs = wallSpecs.flatMap((wall) => {
    const span = (wall.spanX ? wall.width : wall.depth) - 24;
    const count = wall.spanX ? 2 : 1;
    return Array.from({ length: count }, (_, i) => {
      const along = -span / 2 + ((i + 0.5) / count) * span;
      const inward = 0.78;
      const position = new Vector3(
        wall.spanX ? wall.x + along : wall.x + (wall.x < bounds.centerX ? inward : -inward),
        sodiumY,
        wall.spanX ? wall.z + (wall.z < bounds.centerZ ? inward : -inward) : wall.z + along,
      );
      const target = new Vector3().lerpVectors(position, new Vector3(bounds.centerX, 0, bounds.centerZ), 0.62);
      return { position, target };
    });
  });
  sodiumAnchors.push(...sodiumSpecs);
  const sconces = new InstancedMesh(new BoxGeometry(1.7, 0.42, 0.32), warmFixtureMaterial, sodiumAnchors.length);
  const sconceQuaternion = new Quaternion();
  sodiumAnchors.forEach((anchor, i) => {
    const yaw = Math.atan2(anchor.target.x - anchor.position.x, anchor.target.z - anchor.position.z);
    sconceQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    matrix.compose(anchor.position, sconceQuaternion, new Vector3(1, 1, 1));
    sconces.setMatrixAt(i, matrix);
  });
  sconces.instanceMatrix.needsUpdate = true;
  group.add(sconces);

  const mainSign = createIndoorVenueSign("PROJECT LITE  //  DRIFT LAB", arenaPalette.accentColor);
  mainSign.position.set(bounds.centerX, 10.5, bounds.centerZ - innerDepth / 2 + 0.46);
  mainSign.rotation.y = Math.PI;
  const farSign = createIndoorVenueSign("DRIFT ATTACK  //  ARENA", 0xb74a36);
  farSign.position.set(bounds.centerX, 10.5, bounds.centerZ + innerDepth / 2 - 0.46);
  group.add(mainSign, farSign);

  return { group, ceilingY, trussY, floodAnchors, sodiumAnchors };
}
