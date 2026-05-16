import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from "three";
import type { MapEditStamp } from "../../game/editor/mapEdits";
import {
  createAsphaltMaterial,
  createConcreteMaterial,
  createGrassMaterial,
  createGravelMaterial,
  createProceduralStainMaterial,
  createRoadPaintMaterial,
  createRubberMaterial,
} from "../materials/surfaceMaterials";

const groundY = 0.13;

function applyGroundUvs(geometry: BufferGeometry, scale = 7.5) {
  const position = geometry.attributes.position;
  const uvs: number[] = [];
  for (let i = 0; i < position.count; i++) uvs.push(position.getX(i) / scale, position.getZ(i) / scale);
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

function prepOverlay(material: MeshStandardMaterial) {
  material.depthWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -10;
  material.polygonOffsetUnits = -10;
  return material;
}

function surfaceStamp(stamp: MapEditStamp) {
  const geometry = applyGroundUvs(new CircleGeometry(stamp.radius, 64));
  geometry.rotateX(-Math.PI / 2);
  const material = prepOverlay(
    stamp.tool === "road"
      ? createAsphaltMaterial({ x: 1, y: 1 })
      : createGrassMaterial({ x: Math.max(1.2, stamp.radius / 6), y: Math.max(1.2, stamp.radius / 6) }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.position.set(stamp.x, groundY, stamp.z);
  mesh.renderOrder = stamp.tool === "grass" ? 18 : 17;
  mesh.receiveShadow = true;
  return mesh;
}

function addWheel(group: Group, x: number, z: number, scale: number) {
  const tire = new Mesh(new TorusGeometry(0.42 * scale, 0.13 * scale, 8, 18), createRubberMaterial({ x: 1, y: 1 }, 1));
  tire.position.set(x, 0.45 * scale, z);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);
}

function createAsset(stamp: MapEditStamp) {
  const group = new Group();
  const scale = Math.max(0.35, stamp.radius / 10);
  group.position.set(stamp.x, 0, stamp.z);
  group.rotation.y = stamp.rotation ?? 0;
  group.scale.setScalar(scale);

  const concrete = createConcreteMaterial({ x: 2, y: 1 });
  const dark = new MeshStandardMaterial({ color: 0x151a20, roughness: 0.76, metalness: 0.12 });
  const metal = new MeshStandardMaterial({ color: 0x7c8588, roughness: 0.52, metalness: 0.34 });
  const orange = new MeshStandardMaterial({ color: 0xe68a2e, roughness: 0.72 });
  const whitePaint = createRoadPaintMaterial({ x: 1, y: 1 }, 0xd8d2bf, 0.9);
  const redPaint = createRoadPaintMaterial({ x: 1, y: 1 }, 0xa33a32, 0.9);
  const goldPaint = createRoadPaintMaterial({ x: 1, y: 1 }, 0xf1c75b, 0.9);

  switch (stamp.asset) {
    case "asphalt-pad": {
      const pad = new Mesh(applyGroundUvs(new CircleGeometry(7.6, 96), 7.5), prepOverlay(createAsphaltMaterial({ x: 1.2, y: 1.2 })));
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = groundY;
      pad.receiveShadow = true;
      pad.renderOrder = 16;
      group.add(pad);
      break;
    }
    case "paint-line": {
      const line = new Mesh(new BoxGeometry(1.1, 0.025, 10), prepOverlay(createRoadPaintMaterial({ x: 1, y: 2.4 }, 0xd8d2bf, 0.84)));
      line.position.y = groundY + 0.02;
      line.receiveShadow = true;
      line.renderOrder = 20;
      group.add(line);
      break;
    }
    case "road-wear": {
      const stain = prepOverlay(createProceduralStainMaterial(0x111315, 0.31));
      const rubber = prepOverlay(createRubberMaterial({ x: 2.2, y: 1.2 }, 0.34));
      for (let i = -1; i <= 1; i++) {
        const patch = new Mesh(new BoxGeometry(2.2 + Math.abs(i) * 0.7, 0.018, 7.4 - Math.abs(i) * 1.2), i === 0 ? rubber : stain);
        patch.position.set(i * 1.55, groundY + 0.018, i * 0.28);
        patch.rotation.y = i * 0.08;
        patch.receiveShadow = true;
        patch.renderOrder = 21;
        group.add(patch);
      }
      break;
    }
    case "gravel-runoff": {
      const gravel = new Mesh(new BoxGeometry(12, 0.02, 8), prepOverlay(createGravelMaterial({ x: 3.4, y: 2.2 })));
      gravel.position.y = groundY + 0.01;
      gravel.receiveShadow = true;
      gravel.renderOrder = 15;
      group.add(gravel);
      break;
    }
    case "cone": {
      const cone = new Mesh(new CylinderGeometry(0.15, 0.38, 0.8, 12), orange);
      cone.position.y = 0.4;
      cone.castShadow = true;
      group.add(cone);
      break;
    }
    case "drift-pole": {
      const base = new Mesh(new CylinderGeometry(0.22, 0.28, 0.08, 14), concrete);
      const pole = new Mesh(new CylinderGeometry(0.05, 0.06, 2.6, 10), new MeshStandardMaterial({ color: 0xc52e3d, roughness: 0.55 }));
      const cap = new Mesh(new BoxGeometry(0.56, 0.08, 0.12), goldPaint);
      base.position.y = 0.04;
      pole.position.y = 1.34;
      cap.position.y = 2.68;
      base.castShadow = pole.castShadow = cap.castShadow = true;
      group.add(base, pole, cap);
      break;
    }
    case "tire-stack": {
      for (let x = -2; x <= 2; x++) {
        for (let y = 0; y < 2; y++) {
          const tire = new Mesh(new TorusGeometry(0.42, 0.13, 8, 18), createRubberMaterial({ x: 1, y: 1 }, 1));
          tire.position.set(x * 0.52, 0.44 + y * 0.52, 0);
          tire.rotation.y = Math.PI / 2;
          tire.castShadow = true;
          group.add(tire);
        }
      }
      break;
    }
    case "guardrail": {
      const rail = new Mesh(new BoxGeometry(7.8, 0.22, 0.18), metal);
      rail.position.y = 0.82;
      rail.castShadow = true;
      group.add(rail);
      for (const x of [-3.1, 0, 3.1]) {
        const post = new Mesh(new BoxGeometry(0.16, 1.18, 0.22), dark);
        post.position.set(x, 0.58, 0);
        post.castShadow = true;
        group.add(post);
      }
      break;
    }
    case "jersey-barrier": {
      const base = new Mesh(new BoxGeometry(4.2, 0.34, 0.82), concrete);
      base.position.y = 0.2;
      const upper = new Mesh(new BoxGeometry(4.2, 0.5, 0.42), concrete);
      upper.position.y = 0.62;
      base.castShadow = true;
      upper.castShadow = true;
      group.add(base, upper);
      break;
    }
    case "light-pole": {
      const pole = new Mesh(new CylinderGeometry(0.16, 0.2, 7.6, 12), dark);
      pole.position.y = 3.8;
      const lamp = new Mesh(new BoxGeometry(1.3, 0.34, 0.72), new MeshStandardMaterial({ color: 0xf6edd2, emissive: 0xe5bf55, roughness: 0.35 }));
      lamp.position.set(0.58, 7.35, 0);
      pole.castShadow = true;
      lamp.castShadow = true;
      group.add(pole, lamp);
      break;
    }
    case "sign-board": {
      const board = new Mesh(new BoxGeometry(6.4, 1.55, 0.18), dark);
      board.position.y = 2.55;
      board.castShadow = true;
      group.add(board);
      for (const x of [-2.6, 2.6]) {
        const post = new Mesh(new BoxGeometry(0.14, 2.5, 0.14), dark);
        post.position.set(x, 1.28, 0);
        post.castShadow = true;
        group.add(post);
      }
      break;
    }
    case "direction-chevron": {
      const board = new Mesh(new BoxGeometry(5.4, 1.6, 0.18), goldPaint);
      board.position.y = 2.08;
      board.castShadow = true;
      group.add(board);
      for (const x of [-1.55, 0, 1.55]) {
        const slash = new Mesh(new BoxGeometry(0.44, 1.92, 0.2), dark);
        slash.position.set(x, 2.08, -0.02);
        slash.rotation.z = -0.54;
        group.add(slash);
      }
      for (const x of [-2.1, 2.1]) {
        const post = new Mesh(new BoxGeometry(0.14, 2.1, 0.14), dark);
        post.position.set(x, 1.04, 0.05);
        post.castShadow = true;
        group.add(post);
      }
      break;
    }
    case "tree": {
      const trunk = new Mesh(new CylinderGeometry(0.18, 0.3, 3.6, 7), new MeshStandardMaterial({ color: 0x4a3425, roughness: 0.95 }));
      const leavesA = new Mesh(new IcosahedronGeometry(1, 1), new MeshStandardMaterial({ color: 0x4f7038, roughness: 1 }));
      const leavesB = new Mesh(new IcosahedronGeometry(1, 1), new MeshStandardMaterial({ color: 0x6f8642, roughness: 1 }));
      trunk.position.y = 1.75;
      leavesA.position.y = 4;
      leavesA.scale.set(1.65, 0.92, 1.35);
      leavesB.position.set(0.78, 4.68, 0.2);
      leavesB.scale.set(1.18, 0.72, 1.08);
      trunk.castShadow = leavesA.castShadow = leavesB.castShadow = true;
      group.add(trunk, leavesA, leavesB);
      break;
    }
    case "shrub": {
      const shrub = new Mesh(new IcosahedronGeometry(0.72, 1), new MeshStandardMaterial({ color: 0x5f7b3c, roughness: 1 }));
      shrub.position.y = 0.54;
      shrub.scale.set(1.55, 0.66, 1.18);
      shrub.castShadow = true;
      group.add(shrub);
      break;
    }
    case "grass-tuft": {
      const blade = new BoxGeometry(0.06, 0.72, 0.18);
      const tuftMaterial = new MeshStandardMaterial({ color: 0x78924a, roughness: 1 });
      for (let i = 0; i < 9; i++) {
        const grass = new Mesh(blade, tuftMaterial);
        const angle = i * 1.37;
        grass.position.set(Math.cos(angle) * 0.22, 0.35, Math.sin(angle) * 0.22);
        grass.rotation.set(0.12 + (i % 3) * 0.08, angle, (i % 2 ? 1 : -1) * 0.18);
        grass.castShadow = true;
        group.add(grass);
      }
      break;
    }
    case "pit-building": {
      const building = new Mesh(new BoxGeometry(10, 4.2, 9), new MeshStandardMaterial({ color: 0x1d252d, roughness: 0.72, metalness: 0.14 }));
      building.position.y = 2.1;
      const door = new Mesh(new BoxGeometry(6.8, 2.3, 0.24), new MeshStandardMaterial({ color: 0x5e7e92, roughness: 0.24, metalness: 0.2 }));
      door.position.set(0, 1.25, 4.62);
      building.castShadow = true;
      group.add(building, door);
      break;
    }
    case "garage-bay": {
      const bay = new Mesh(new BoxGeometry(12, 4.4, 8), new MeshStandardMaterial({ color: 0x202a32, roughness: 0.72, metalness: 0.1 }));
      const door = new Mesh(new BoxGeometry(8.2, 2.55, 0.2), new MeshStandardMaterial({ color: 0x6f8792, roughness: 0.3, metalness: 0.18 }));
      const fascia = new Mesh(new BoxGeometry(12.8, 0.42, 8.6), goldPaint);
      bay.position.y = 2.2;
      door.position.set(0, 1.45, 4.12);
      fascia.position.y = 4.58;
      bay.castShadow = door.castShadow = fascia.castShadow = true;
      group.add(bay, door, fascia);
      break;
    }
    case "grandstand": {
      const standMaterial = new MeshStandardMaterial({ color: 0x252d35, roughness: 0.76, metalness: 0.08 });
      const seatMaterial = new MeshStandardMaterial({ color: 0xbd9f42, roughness: 0.68 });
      const base = new Mesh(new BoxGeometry(13, 1.7, 6.8), standMaterial);
      base.position.y = 0.85;
      base.castShadow = true;
      group.add(base);
      for (let row = 0; row < 4; row++) {
        const seats = new Mesh(new BoxGeometry(11.8, 0.24, 0.76), seatMaterial);
        seats.position.set(0, 1.85 + row * 0.42, -2.1 + row * 1.15);
        seats.castShadow = true;
        group.add(seats);
      }
      break;
    }
    case "start-gantry": {
      for (const x of [-4.8, 4.8]) {
        const post = new Mesh(new BoxGeometry(0.26, 6.4, 0.26), dark);
        post.position.set(x, 3.2, 0);
        post.castShadow = true;
        group.add(post);
      }
      const beam = new Mesh(new BoxGeometry(10.4, 0.24, 0.32), dark);
      beam.position.y = 6.15;
      beam.castShadow = true;
      group.add(beam);
      for (let i = -2; i <= 2; i++) {
        const lightBox = new Mesh(new BoxGeometry(0.58, 0.32, 0.18), i === -2 ? goldPaint : new MeshStandardMaterial({ color: 0x191f25, roughness: 0.5 }));
        lightBox.position.set(i * 0.78, 5.66, -0.16);
        group.add(lightBox);
      }
      break;
    }
    case "curb-stripe": {
      for (let i = -2; i <= 2; i++) {
        const curb = new Mesh(new BoxGeometry(1.85, 0.1, 0.72), i % 2 === 0 ? redPaint : whitePaint);
        curb.position.set(i * 1.8, 0.12, 0);
        curb.castShadow = true;
        group.add(curb);
      }
      break;
    }
    case "portal-gate": {
      const glow = new MeshStandardMaterial({ color: 0x68d8ff, emissive: 0x3eb8ff, roughness: 0.3, transparent: true, opacity: 0.72 });
      for (const x of [-3.4, 3.4]) {
        const post = new Mesh(new BoxGeometry(0.34, 4.7, 0.38), dark);
        post.position.set(x, 2.35, 0);
        post.castShadow = true;
        group.add(post);
      }
      const top = new Mesh(new BoxGeometry(7.2, 0.34, 0.42), dark);
      top.position.y = 4.7;
      const ring = new Mesh(new TorusGeometry(2.15, 0.07, 10, 48), glow);
      ring.position.y = 2.65;
      ring.scale.y = 0.74;
      const beam = new Mesh(new CylinderGeometry(1.8, 0.9, 15, 24, 1, true), glow);
      beam.position.y = 8.5;
      top.castShadow = true;
      group.add(top, ring, beam);
      break;
    }
    case "queue-ring": {
      const asphalt = new Mesh(applyGroundUvs(new CircleGeometry(6, 96), 7.5), prepOverlay(createAsphaltMaterial({ x: 1, y: 1 })));
      const ring = new Mesh(new TorusGeometry(5.05, 0.1, 6, 96), goldPaint);
      asphalt.rotation.x = -Math.PI / 2;
      asphalt.position.y = groundY;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = groundY + 0.08;
      asphalt.receiveShadow = ring.receiveShadow = true;
      asphalt.renderOrder = 16;
      ring.renderOrder = 21;
      group.add(asphalt, ring);
      break;
    }
    case "flatbed-hauler": {
      const cab = new Mesh(new BoxGeometry(3.4, 2.25, 3.2), new MeshStandardMaterial({ color: 0x23313b, roughness: 0.58, metalness: 0.16 }));
      const trailer = new Mesh(new BoxGeometry(5.8, 0.28, 10.8), metal);
      const deck = new Mesh(new BoxGeometry(5.35, 0.04, 10.2), dark);
      cab.position.set(0, 1.3, 5.5);
      trailer.position.set(0, 0.44, -1.15);
      deck.position.set(0, 0.62, -1.15);
      cab.castShadow = trailer.castShadow = deck.receiveShadow = true;
      group.add(cab, trailer, deck);
      for (const x of [-2.2, 2.2]) {
        for (const z of [-3.6, -1.4, 5.4]) addWheel(group, x, z, 0.86);
      }
      break;
    }
    default:
      addWheel(group, -0.7, 0, 1);
      addWheel(group, 0.7, 0, 1);
  }

  return group;
}

export function createMapEditStampObject(stamp: MapEditStamp): Object3D {
  return stamp.tool === "asset" ? createAsset(stamp) : surfaceStamp(stamp);
}
