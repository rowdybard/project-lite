import { Box3, Group, Object3D, Vector3, type Euler } from "three";
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

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

function collectVehicleNodes(source: Group, rootName: string) {
  const body = findByName(source, rootName);
  const wheels: Object3D[] = [];
  const wheelRootPattern = new RegExp(`^${rootName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} wheel (front|rear) (left|right)( 2)?$`);
  source.traverse((object) => {
    if (wheelRootPattern.test(object.name)) wheels.push(object);
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

export async function createImportedCarModel(id: string): Promise<ImportedCarModel | null> {
  const definition = importedCarDefinitions[id];
  if (!definition) return null;

  const sourceScene = await loadScene(definition.path);
  sourceScene.updateMatrixWorld(true);
  const { body, wheels } = collectVehicleNodes(sourceScene, definition.rootName);
  if (!body) return null;

  const raw = new Group();
  const wheelRecords: ImportedWheel[] = [];
  const clone = body.clone(true);
  clone.position.copy(body.getWorldPosition(new Vector3()));
  clone.quaternion.copy(body.getWorldQuaternion(clone.quaternion));
  clone.scale.copy(body.getWorldScale(new Vector3()));
  raw.add(clone);

  for (const wheel of wheels) {
    const pivot = createWheelPivot(wheel);
    raw.add(pivot);
    wheelRecords.push({
      object: pivot,
      front: wheel.name.includes("front"),
      baseRotation: pivot.rotation.clone(),
    });
  }

  const finalBounds = new Box3().setFromObject(raw);
  const center = finalBounds.getCenter(new Vector3());
  const size = finalBounds.getSize(new Vector3());
  raw.position.set(-center.x, -finalBounds.min.y, -center.z);

  const root = new Group();
  const sourceForwardIsX = size.x > size.z;
  if (sourceForwardIsX) raw.rotation.y = -Math.PI / 2;
  const footprint = Math.max(size.x, size.z, 0.001);
  root.scale.setScalar(definition.fitLength / footprint);
  root.add(raw);

  return { root, wheels: wheelRecords };
}
