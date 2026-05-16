import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
} from "three";
import { createAsphaltMaterial, createConcreteMaterial, createRoadPaintMaterial } from "../materials/surfaceMaterials";

type QueueSlabCenter = {
  x: number;
  z: number;
  heading: number;
};

const disposeGroup = (group: Group) => {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
};

function roomAccent(roomCode: string) {
  const colors = [0xf1c75b, 0x68d8ff, 0x75d47f, 0xb088ff, 0xff8b5f, 0xf25f7c];
  let hash = 0;
  for (const char of roomCode) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length];
}

function makeLabel(text: string, width: number, depth: number, accent: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 192;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#101820";
  context.globalAlpha = 0.78;
  context.fillRect(24, 24, canvas.width - 48, canvas.height - 48);
  context.globalAlpha = 1;
  context.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
  context.lineWidth = 10;
  context.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);
  context.fillStyle = "#fff4d4";
  context.font = "900 58px Arial Black, Impact, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new Mesh(new PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 24;
  return mesh;
}

function addSlot(group: Group, index: number, accentMaterial: MeshStandardMaterial) {
  const angle = -Math.PI / 2 + (index / 6) * Math.PI * 2;
  const slot = new Mesh(new BoxGeometry(0.55, 0.025, 5.7), accentMaterial);
  slot.position.set(Math.cos(angle) * 10.3, 0.35, Math.sin(angle) * 10.3);
  slot.rotation.y = -angle;
  slot.renderOrder = 22;
  group.add(slot);
}

function addPerimeter(group: Group, accent: number) {
  const postMaterial = new MeshStandardMaterial({ color: 0x151b22, roughness: 0.7, metalness: 0.18 });
  const accentMaterial = new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.2, roughness: 0.5 });
  for (const x of [-18, 18]) {
    for (const z of [-17, 17]) {
      const post = new Mesh(new CylinderGeometry(0.2, 0.25, 2.5, 10), postMaterial);
      post.position.set(x, 1.42, z);
      post.castShadow = true;
      group.add(post);

      const cap = new Mesh(new BoxGeometry(1.1, 0.16, 0.16), accentMaterial);
      cap.position.set(x, 2.75, z);
      cap.rotation.y = x < 0 ? 0.26 : -0.26;
      cap.castShadow = true;
      group.add(cap);
    }
  }
}

export function createQueueSlab() {
  const root = new Group();
  root.name = "online-drift-queue-slab";
  root.visible = false;

  return {
    root,
    setRoom(roomCode: string, center: QueueSlabCenter) {
      disposeGroup(root);
      root.clear();
      root.visible = true;
      root.position.set(center.x, 0, center.z);
      root.rotation.y = center.heading;

      const accent = roomAccent(roomCode);
      const accentMaterial = createRoadPaintMaterial({ x: 1, y: 1 }, accent, 0.9);
      const concrete = createConcreteMaterial({ x: 4, y: 4 });
      const asphalt = createAsphaltMaterial({ x: 2.2, y: 2.2 });

      const slabBase = new Mesh(new BoxGeometry(41, 0.44, 41), concrete);
      slabBase.position.y = 0.08;
      slabBase.receiveShadow = true;
      slabBase.castShadow = true;
      root.add(slabBase);

      const asphaltTop = new Mesh(new CircleGeometry(18.4, 128), asphalt);
      asphaltTop.rotation.x = -Math.PI / 2;
      asphaltTop.position.y = 0.32;
      asphaltTop.receiveShadow = true;
      root.add(asphaltTop);

      const outerRing = new Mesh(new RingGeometry(12.25, 12.8, 128), accentMaterial);
      outerRing.rotation.x = -Math.PI / 2;
      outerRing.position.y = 0.35;
      outerRing.renderOrder = 20;
      root.add(outerRing);

      const readyLine = new Mesh(new BoxGeometry(15.5, 0.025, 0.58), accentMaterial);
      readyLine.position.set(0, 0.36, -15.5);
      readyLine.renderOrder = 21;
      root.add(readyLine);

      for (let i = 0; i < 6; i++) addSlot(root, i, accentMaterial);

      const label = makeLabel(`DRIFT QUEUE ${roomCode}`, 19.5, 4.8, accent);
      label.position.set(0, 0.37, 15.2);
      root.add(label);

      const roomPlate = makeLabel("PRIVATE PAD", 11.4, 3, accent);
      roomPlate.position.set(0, 0.38, -7.3);
      root.add(roomPlate);

      addPerimeter(root, accent);
    },
    hide() {
      root.visible = false;
      disposeGroup(root);
      root.clear();
    },
  };
}
