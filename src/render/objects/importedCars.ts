import { Box3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Euler } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type ImportedCarAttachments = {
  bodyWidth: number;
  rearDeckY: number;
  rearDeckZ: number;
  roofY: number;
  frontBumperY: number;
  frontBumperZ: number;
  skirtX: number;
  skirtY: number;
  skirtZ: number;
  skirtLength: number;
  underglowX: number;
};

const defaultAttachments: ImportedCarAttachments = {
  bodyWidth: 1.9,
  rearDeckY: 0.98,
  rearDeckZ: -2.0,
  roofY: 1.3,
  frontBumperY: 0.2,
  frontBumperZ: 2.2,
  skirtX: 1.02,
  skirtY: 0.23,
  skirtZ: -0.04,
  skirtLength: 2.2,
  underglowX: 0.82,
};

type ImportedCarDefinition = {
  id: string;
  path: string;
  rootName: string;
  fitLength: number;
  attachments: ImportedCarAttachments;
  standalone?: boolean;
  wheelRadius?: number;
  wheelTrack?: number;
  wheelbaseFront?: number;
  wheelbaseRear?: number;
};

export type ImportedWheel = {
  object: Object3D;
  front: boolean;
  left: boolean;
  baseRotation: Euler;
  baseY: number;
};

export type ImportedCarModel = {
  root: Group;
  wheels: ImportedWheel[];
  bodyMeshes: Mesh[];
  rimMeshes: Mesh[];
  bodyMaterialIndices: Map<Mesh, number[]>;
};

const packPath = "/assets/cars/imports/free_low_poly_vehicles_pack.glb";

const importedCarDefinitions: Record<string, ImportedCarDefinition> = {
  "pack-suv": { id: "pack-suv", path: packPath, rootName: "SUV", fitLength: 4.5, attachments: { bodyWidth: 2.07, rearDeckY: 1.29, rearDeckZ: -2.17, roofY: 1.65, frontBumperY: 0.22, frontBumperZ: 2.15, skirtX: 1.03, skirtY: 0.33, skirtZ: -0.07, skirtLength: 2.08, underglowX: 0.82 } },
  "pack-pickup": { id: "pack-pickup", path: packPath, rootName: "Pickup", fitLength: 4.65, attachments: { ...defaultAttachments, bodyWidth: 1.95, rearDeckY: 1.48, rearDeckZ: -2.2, roofY: 1.55, frontBumperZ: 2.2, skirtX: 1.04 } },
  "pack-hatchback": { id: "pack-hatchback", path: packPath, rootName: "Hatchback", fitLength: 4.05, attachments: { ...defaultAttachments, bodyWidth: 1.78, rearDeckY: 1.08, rearDeckZ: -1.85, roofY: 1.32, frontBumperZ: 1.9, skirtX: 0.94, skirtLength: 1.9 } },
  "pack-sedan": { id: "pack-sedan", path: packPath, rootName: "Sedan", fitLength: 4.55, attachments: { ...defaultAttachments, bodyWidth: 1.88, rearDeckY: 1.05, rearDeckZ: -2.15, roofY: 1.32, frontBumperZ: 2.2, skirtX: 1.0 } },
  "pack-muscle": { id: "pack-muscle", path: packPath, rootName: "Muscle", fitLength: 4.75, attachments: { ...defaultAttachments, bodyWidth: 2.0, rearDeckY: 0.98, rearDeckZ: -2.25, roofY: 1.22, frontBumperZ: 2.3, skirtX: 1.06 } },
  "pack-muscle-2": { id: "pack-muscle-2", path: packPath, rootName: "Muscle 2", fitLength: 4.75, attachments: { ...defaultAttachments, bodyWidth: 2.0, rearDeckY: 0.98, rearDeckZ: -2.25, roofY: 1.22, frontBumperZ: 2.3, skirtX: 1.06 } },
};

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<Group>>();

export function isImportedCar(id: string) {
  return id in importedCarDefinitions;
}

export function getAttachments(id: string): ImportedCarAttachments {
  return importedCarDefinitions[id]?.attachments ?? { ...defaultAttachments };
}

export function setAttachments(id: string, attachments: ImportedCarAttachments) {
  if (importedCarDefinitions[id]) importedCarDefinitions[id].attachments = attachments;
}

function loadScene(path: string) {
  let cached = sceneCache.get(path);
  if (!cached) {
    cached = loader.loadAsync(path).then((gltf) => gltf.scene);
    sceneCache.set(path, cached);
  }
  return cached;
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function stripMaterialTextureNoise(material: MeshStandardMaterial) {
  material.map = null;
  material.normalMap = null;
  material.roughnessMap = null;
  material.metalnessMap = null;
  material.aoMap = null;
  material.displacementMap = null;
  material.bumpMap = null;
  material.emissiveMap = null;
  material.lightMap = null;
  material.vertexColors = false;
  material.flatShading = false;
  material.roughness = Math.max(material.roughness ?? 0.5, 0.42);
  material.needsUpdate = true;
}

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  const targetName = normalizeName(name);
  root.traverse((object) => {
    if (!found && normalizeName(object.name) === targetName) found = object;
  });
  return found;
}

function collectVehicleNodes(source: Group, rootName: string) {
  const body = findByName(source, rootName);
  const wheels: Object3D[] = [];
  const targetPrefix = `${normalizeName(rootName)} wheel `;
  source.traverse((object) => {
    const name = normalizeName(object.name);
    const isWheelRoot =
      name.startsWith(targetPrefix) &&
      (name.endsWith("front left") ||
        name.endsWith("front right") ||
        name.endsWith("rear left") ||
        name.endsWith("rear right") ||
        name.endsWith("rear left 2") ||
        name.endsWith("rear right 2"));
    if (isWheelRoot) wheels.push(object);
  });
  return { body, wheels };
}

function createWheelPivot(sourceWheel: Object3D) {
  const wheel = sourceWheel.clone(true);
  wheel.position.copy(sourceWheel.getWorldPosition(new Vector3()));
  wheel.quaternion.copy(sourceWheel.getWorldQuaternion(wheel.quaternion));
  wheel.scale.copy(sourceWheel.getWorldScale(new Vector3()));
  wheel.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(wheel);
  const center = bounds.getCenter(new Vector3());
  const pivot = new Group();
  pivot.position.copy(center);
  wheel.position.sub(center);
  pivot.add(wheel);
  return pivot;
}

function addGeneratedWheelRig(content: Group, bounds: Box3) {
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(0.28, Math.min(size.y * 0.28, size.z * 0.1));
  const width = radius * 0.78;
  const track = Math.max(size.x * 0.45, radius * 2.4);
  const frontZ = bounds.max.z - size.z * 0.23;
  const rearZ = bounds.min.z + size.z * 0.23;
  const wheelY = bounds.min.y + radius * 0.92;
  const tireMaterial = new MeshStandardMaterial({ color: 0x111111, roughness: 0.86 });
  const rimMaterial = new MeshStandardMaterial({ color: 0x54606b, roughness: 0.42, metalness: 0.22 });
  const wheelGeometry = new CylinderGeometry(radius, radius, width, 20);
  const rimGeometry = new CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.08, 16);
  const wheels: ImportedWheel[] = [];

  for (const wheel of [
    { x: center.x - track, z: frontZ, front: true },
    { x: center.x + track, z: frontZ, front: true },
    { x: center.x - track, z: rearZ, front: false },
    { x: center.x + track, z: rearZ, front: false },
  ]) {
    const pivot = new Group();
    pivot.position.set(wheel.x, wheelY, wheel.z);

    const tire = new Mesh(wheelGeometry, tireMaterial);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    pivot.add(tire);

    const rim = new Mesh(rimGeometry, rimMaterial);
    rim.rotation.z = Math.PI / 2;
    pivot.add(rim);

    content.add(pivot);
    wheels.push({ object: pivot, front: wheel.front, left: wheel.x < center.x, baseRotation: pivot.rotation.clone(), baseY: wheelY });
  }

  return wheels;
}

function addExplicitWheelRig(content: Group, radius: number, track: number, wheelbaseFront: number, wheelbaseRear: number) {
  const width = radius * 0.78;
  const wheelY = radius * 0.92;
  const tireMaterial = new MeshStandardMaterial({ color: 0x111111, roughness: 0.86 });
  const rimMaterial = new MeshStandardMaterial({ color: 0x54606b, roughness: 0.42, metalness: 0.22 });
  const wheelGeometry = new CylinderGeometry(radius, radius, width, 20);
  const rimGeometry = new CylinderGeometry(radius * 0.5, radius * 0.5, width * 1.08, 16);
  const wheels: ImportedWheel[] = [];

  for (const wheel of [
    { x: -track, z: wheelbaseFront, front: true },
    { x: track, z: wheelbaseFront, front: true },
    { x: -track, z: wheelbaseRear, front: false },
    { x: track, z: wheelbaseRear, front: false },
  ]) {
    const pivot = new Group();
    pivot.position.set(wheel.x, wheelY, wheel.z);

    const tire = new Mesh(wheelGeometry, tireMaterial);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    pivot.add(tire);

    const rim = new Mesh(rimGeometry, rimMaterial);
    rim.rotation.z = Math.PI / 2;
    pivot.add(rim);

    content.add(pivot);
    wheels.push({ object: pivot, front: wheel.front, left: wheel.x < 0, baseRotation: pivot.rotation.clone(), baseY: wheelY });
  }

  return wheels;
}

export async function createImportedCarModel(id: string): Promise<ImportedCarModel | null> {
  const definition = importedCarDefinitions[id];
  if (!definition) return null;

  const sourceScene = await loadScene(definition.path);
  sourceScene.updateMatrixWorld(true);

  const content = new Group();
  const wheelRecords: ImportedWheel[] = [];

  if (definition.standalone) {
    const clone = sourceScene.clone(true);
    const toRemove: Object3D[] = [];
    clone.traverse((node) => {
      const name = node.name.toLowerCase();
      if (name.includes("wheel") || name.includes("tire") || name.includes("tyre") || name.includes("rim")) {
        toRemove.push(node);
      }
    });
    for (const node of toRemove) node.removeFromParent();
    content.add(clone);
    content.updateMatrixWorld(true);
    if (definition.wheelRadius && definition.wheelTrack && definition.wheelbaseFront !== undefined && definition.wheelbaseRear !== undefined) {
      const generated = addExplicitWheelRig(content, definition.wheelRadius, definition.wheelTrack, definition.wheelbaseFront, definition.wheelbaseRear);
      wheelRecords.push(...generated);
    } else {
      const bodyBounds = new Box3().setFromObject(content);
      const generated = addGeneratedWheelRig(content, bodyBounds);
      wheelRecords.push(...generated);
    }
    content.updateMatrixWorld(true);
  } else {
    const { body, wheels } = collectVehicleNodes(sourceScene, definition.rootName);
    if (!body) return null;

    const clone = body.clone(true);
    clone.position.copy(body.getWorldPosition(new Vector3()));
    clone.quaternion.copy(body.getWorldQuaternion(clone.quaternion));
    clone.scale.copy(body.getWorldScale(new Vector3()));
    content.add(clone);

    for (const wheel of wheels) {
      const pivot = createWheelPivot(wheel);
      content.add(pivot);
      const name = normalizeName(wheel.name);
      wheelRecords.push({
        object: pivot,
        front: name.includes("front"),
        left: name.includes("left"),
        baseRotation: pivot.rotation.clone(),
        baseY: pivot.position.y,
      });
    }

    content.updateMatrixWorld(true);

    if (wheelRecords.length < 4) {
      const bodyBounds = new Box3().setFromObject(clone);
      const generated = addGeneratedWheelRig(content, bodyBounds);
      wheelRecords.push(...generated);
      content.updateMatrixWorld(true);
    }
  }

  const finalBounds = new Box3().setFromObject(content);
  const center = finalBounds.getCenter(new Vector3());
  const size = finalBounds.getSize(new Vector3());
  content.position.set(-center.x, -finalBounds.min.y, -center.z);

  const root = new Group();
  const footprint = Math.max(size.x, size.z, 0.001);
  root.scale.setScalar(definition.fitLength / footprint);
  root.add(content);

  const bodyMeshes: Mesh[] = [];
  const rimMeshes: Mesh[] = [];
  const bodyMaterialIndices: Map<Mesh, number[]> = new Map();

  const glassKeywords = ["glass", "window", "windshield", "windscreen"];
  const lightKeywords = ["light", "lamp", "headlight", "taillight", "brake", "signal", "emit", "lens"];
  const mirrorKeywords = ["mirror", "chrome"];
  const tireKeywords = ["tire", "tyre", "rubber"];
  const plateKeywords = ["plate", "license", "number"];

  content.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry = mergeVertices(node.geometry, 0.002);
    node.geometry.deleteAttribute("color");
    node.geometry.computeVertexNormals();
    node.receiveShadow = false;

    const isWheelChild = wheelRecords.some((w) => {
      let parent: Object3D | null = node;
      while (parent) { if (parent === w.object) return true; parent = parent.parent; }
      return false;
    });

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      const mat = material as MeshStandardMaterial;
      if (mat && mat.color) stripMaterialTextureNoise(mat);
    }
    const nodeName = node.name.toLowerCase();

    if (isWheelChild) {
      const isTire = tireKeywords.some((kw) => nodeName.includes(kw));
      if (!isTire) rimMeshes.push(node);
      return;
    }

    const isPlate = plateKeywords.some((kw) => nodeName.includes(kw));
    if (isPlate) return;

    const validIndices: number[] = [];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i] as MeshStandardMaterial;
      if (!mat || !mat.color) continue;
      const matName = (mat.name || "").toLowerCase();
      const combined = nodeName + " " + matName;

      const isGlass = glassKeywords.some((kw) => combined.includes(kw));
      const isLight = lightKeywords.some((kw) => combined.includes(kw));
      const isMirror = mirrorKeywords.some((kw) => combined.includes(kw));

      if (isGlass || isLight || isMirror) continue;

      const isBodyByName = combined.includes("body");
      const isTrimBlack = combined.includes("body_black") || combined.includes("black");
      const isAccentWhite = combined.includes("body_white") || combined.includes("white");

      if (isBodyByName && !isTrimBlack && !isAccentWhite) {
        validIndices.push(i);
      }
    }

    if (validIndices.length > 0) {
      bodyMeshes.push(node);
      bodyMaterialIndices.set(node, validIndices);
    }
  });

  return { root, wheels: wheelRecords, bodyMeshes, rimMeshes, bodyMaterialIndices };
}
