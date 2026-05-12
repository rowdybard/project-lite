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

function findByName(root: Object3D, name: string) {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  return found;
}

function collectVehicleNodes(source: Group, rootName: string) {
  const body = findByName(source, rootName);
  const wheels: Object3D[] = [];
  source.traverse((object) => {
    if (object.name.startsWith(`${rootName} wheel `)) wheels.push(object);
  });
  return { body, wheels };
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
  const sourceNodes = [body, ...wheels];
  for (const sourceNode of sourceNodes) {
    const clone = sourceNode.clone(true);
    clone.position.copy(sourceNode.getWorldPosition(new Vector3()));
    clone.quaternion.copy(sourceNode.getWorldQuaternion(clone.quaternion));
    clone.scale.copy(sourceNode.getWorldScale(new Vector3()));
    raw.add(clone);

    if (sourceNode.name.includes(" wheel ")) {
      wheelRecords.push({
        object: clone,
        front: sourceNode.name.includes("front"),
        baseRotation: clone.rotation.clone(),
      });
    }
  }

  const bounds = new Box3().setFromObject(raw);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  raw.position.set(-center.x, -bounds.min.y, -center.z);

  const root = new Group();
  const footprint = Math.max(size.x, size.z, 0.001);
  root.scale.setScalar(definition.fitLength / footprint);
  root.add(raw);

  return { root, wheels: wheelRecords };
}
