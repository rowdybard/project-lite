import {
  Material,
  Mesh,
  Object3D,
  Texture,
  type BufferGeometry,
} from "three";

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "normalMap",
  "displacementMap",
  "emissiveMap",
  "metalnessMap",
  "roughnessMap",
  "lightMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "transmissionMap",
  "thicknessMap",
] as const;

const OWNER_DISPOSE_KEY = "disposeWithOwner";

export function markOwnerTexture<T extends Texture>(texture: T): T {
  texture.userData[OWNER_DISPOSE_KEY] = true;
  return texture;
}

function disposeOwnedMaterialTextures(
  material: Material,
  disposedTextures: Set<Texture>,
) {
  const record = material as Material & Record<string, unknown>;

  for (const key of MATERIAL_TEXTURE_KEYS) {
    const texture = record[key];

    if (
      texture instanceof Texture &&
      texture.userData[OWNER_DISPOSE_KEY] === true &&
      !disposedTextures.has(texture)
    ) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  }
}

export function disposeObject3D(root: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;

    if (!geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }

    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      disposeOwnedMaterialTextures(material, textures);
      material.dispose();
    }
  });

  root.removeFromParent();
  root.clear();
}
