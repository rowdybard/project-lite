import { Box3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Euler } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ImportedCarDefinition = {
  id: string;
  path: string;
  rootName: string;
  fitLength: number;
};

export type ImportedWheel = {
  object: Object3D;
  front: boolean;
  baseRotation: Euler;
};

export type ImportedCarModel = {
  root: Group;
  wheels: ImportedWheel[];
};

const packPath = "/assets/cars/imports/free_low_poly_vehicles_pack.glb";

const importedCarDefinitions: Record<string, ImportedCarDefinition> = {
  "pack-suv": { id: "pack-suv", path: packPath, rootName: "SUV", fitLength: 4.5 },
  "pack-pickup": { id: "pack-pickup", path: packPath, rootName: "Pickup", fitLength: 4.65 },
  "pack-hatchback": { id: "pack-hatchback", path: packPath, rootName: "Hatchback", fitLength: 4.05 },
  "pack-sedan": { id: "pack-sedan", path: packPath, rootName: "Sedan", fitLength: 4.55 },
  "pack-muscle": { id: "pack-muscle", path: packPath, rootName: "Muscle", fitLength: 4.75 },
  "pack-muscle-2": { id: "pack-muscle-2", path: packPath, rootName: "Muscle 2", fitLength: 4.75 },
};

const loader = new GLTFLoader();
const sceneCache = new Map<string, Promise<Group>>();

export function isImportedCar(id: string) {
  return id in importedCarDefinitions;
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
    wheels.push({ object: pivot, front: wheel.front, baseRotation: pivot.rotation.clone() });
  }

  return wheels;
}

export async function createImportedCarModel(id: string): Promise<ImportedCarModel | null> {
  const definition = importedCarDefinitions[id];
  if (!definition) return null;

  const sourceScene = await loadScene(definition.path);
  sourceScene.updateMatrixWorld(true);
  const { body, wheels } = collectVehicleNodes(sourceScene, definition.rootName);
  if (!body) return null;

  const content = new Group();
  const clone = body.clone(true);
  clone.position.copy(body.getWorldPosition(new Vector3()));
  clone.quaternion.copy(body.getWorldQuaternion(clone.quaternion));
  clone.scale.copy(body.getWorldScale(new Vector3()));
  content.add(clone);

  const wheelRecords: ImportedWheel[] = [];
  for (const wheel of wheels) {
    const pivot = createWheelPivot(wheel);
    content.add(pivot);
    wheelRecords.push({
      object: pivot,
      front: normalizeName(wheel.name).includes("front"),
      baseRotation: pivot.rotation.clone(),
    });
  }

  content.updateMatrixWorld(true);

  if (wheelRecords.length < 4) {
    const bodyBounds = new Box3().setFromObject(clone);
    wheelRecords.push(...addGeneratedWheelRig(content, bodyBounds));
    content.updateMatrixWorld(true);
  }

  const finalBounds = new Box3().setFromObject(content);
  const center = finalBounds.getCenter(new Vector3());
  const size = finalBounds.getSize(new Vector3());
  content.position.set(-center.x, -finalBounds.min.y, -center.z);

  const root = new Group();
  const footprint = Math.max(size.x, size.z, 0.001);
  root.scale.setScalar(definition.fitLength / footprint);
  root.add(content);

  return { root, wheels: wheelRecords };
}
