import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  type BufferGeometry,
  type Material,
} from "three";
import { paintColors, resolveUnderglowColor, wheelColors, type CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";
import { applyProceduralPaint } from "../materials/carPaint";
import { createImportedCarModel, getAttachments, isImportedCar, type ImportedCarAttachments, type ImportedCarModel, type ImportedWheel } from "./importedCars";

export type CarReadyResult =
  | { ok: true; carId: string }
  | { ok: false; carId: string; error: Error };

export type CarLoadState = {
  requestedCarId: string;
  loadingCarId: string;
  loadedCarId: string;
  loading: boolean;
  error: Error | null;
};

type WheelCorner = "fl" | "fr" | "rl" | "rr";
type CarProfileId = "lite-coupe" | "street-sedan";

const carProfiles: Record<
  CarProfileId,
  {
    body: { width: number; length: number; height: number; y: number };
    hood: { width: number; length: number; height: number; y: number; z: number };
    rearDeck: { width: number; length: number; height: number; y: number; z: number; visible: boolean };
    cabin: { width: number; length: number; height: number; y: number; z: number };
    hatchRoof: { width: number; length: number; height: number; y: number; z: number; rotation: number; visible: boolean };
    frontBumperZ: number;
    rearBumperZ: number;
    visualStyle: "coupe" | "sedan";
    wheelbaseFront: number;
    wheelbaseRear: number;
    wheelTrack: number;
    wheelRadius: number;
  }
> = {
  "lite-coupe": {
    body: { width: 1.96, length: 4.62, height: 0.52, y: 0.56 },
    hood: { width: 1.78, length: 1.34, height: 0.13, y: 0.9, z: 0.95 },
    rearDeck: { width: 1.78, length: 0.9, height: 0.15, y: 0.86, z: -1.42, visible: true },
    cabin: { width: 1.28, length: 1.36, height: 0.54, y: 0.98, z: -0.36 },
    hatchRoof: { width: 1.46, length: 1.02, height: 0.22, y: 0.9, z: -1.12, rotation: -0.2, visible: false },
    frontBumperZ: 2.18,
    rearBumperZ: -2.18,
    visualStyle: "coupe",
    wheelbaseFront: 1.34,
    wheelbaseRear: -1.48,
    wheelTrack: 1.08,
    wheelRadius: 0.38,
  },
  "street-sedan": {
    body: { width: 1.9, length: 4.95, height: 0.58, y: 0.58 },
    hood: { width: 1.7, length: 1.42, height: 0.11, y: 0.93, z: 1.12 },
    rearDeck: { width: 1.72, length: 1.18, height: 0.16, y: 0.9, z: -1.58, visible: true },
    cabin: { width: 1.34, length: 1.8, height: 0.58, y: 1.02, z: -0.3 },
    hatchRoof: { width: 1.52, length: 0.24, height: 0.18, y: 0.98, z: -1.2, rotation: 0, visible: false },
    frontBumperZ: 2.36,
    rearBumperZ: -2.36,
    visualStyle: "sedan",
    wheelbaseFront: 1.5,
    wheelbaseRear: -1.62,
    wheelTrack: 1.02,
    wheelRadius: 0.35,
  },
};

const hide = (...objects: (Mesh | Group | PointLight | null)[]) => {
  for (const object of objects) if (object) object.visible = false;
};

const setBox = (mesh: Mesh, width: number, height: number, depth: number) => {
  mesh.scale.set(width, height, depth);
};

const setVisible = (visible: boolean, ...objects: (Mesh | Group)[]) => {
  for (const object of objects) object.visible = visible;
};

function prepPaintMaterial(material: MeshStandardMaterial, paintHex: number) {
  material.color.setHex(paintHex);
  material.map = null;
  material.roughnessMap = null;
  material.metalnessMap = null;
  material.aoMap = null;
  material.displacementMap = null;
  material.bumpMap = null;
  material.emissiveMap = null;
  material.lightMap = null;
  material.vertexColors = false;
  material.flatShading = false;
  material.roughness = 0.38;
  material.metalness = 0.06;
  material.envMapIntensity = 0.55;
  if (material instanceof MeshPhysicalMaterial) {
    material.clearcoat = 0.75;
    material.clearcoatRoughness = 0.22;
    applyProceduralPaint(material, paintHex);
  } else {
    // Strip the procedural normal map on non-physical materials so it doesn't leak.
    material.normalMap = null;
    material.normalScale.set(0, 0);
  }
  material.needsUpdate = true;
}

function createContactShadowMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  // Dense core under the chassis with a soft falloff — the car must read grounded indoors
  // even where the single key spot doesn't reach.
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.95)");
  gradient.addColorStop(0.42, "rgba(0, 0, 0, 0.72)");
  gradient.addColorStop(0.72, "rgba(0, 0, 0, 0.3)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new MeshBasicMaterial({
    color: 0x050607,
    map: new CanvasTexture(canvas),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
}

export function createCarView(scale = 1) {
  const root = new Group();
  root.scale.setScalar(scale);
  const bodyGroup = new Group();
  root.add(bodyGroup);
  const contactShadow = new Mesh(
    new CircleGeometry(1, 36),
    createContactShadowMaterial(),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.14;
  contactShadow.scale.set(1.25, 2.75, 1);
  root.add(contactShadow);

  const frontWheelPivots: Group[] = [];
  const frontWheelMeshes: Mesh[] = [];
  const rearWheelMeshes: Mesh[] = [];
  const suspensionPivots: { pivot: Group; corner: WheelCorner; baseY: number }[] = [];
  const bodyParts: Mesh[] = [];
  const rimParts: Mesh[] = [];
  const customParts = new Group();
  bodyGroup.add(customParts);
  const importedRoot = new Group();
  root.add(importedRoot);

  let stanceDrop = 0;
  // Load state machine — explicit IDs and generation for race-free loading
  let requestedCarId = "";
  let loadingCarId = "";
  let loadedCarId = "";
  let loadGeneration = 0;
  let loadError: Error | null = null;
  let latestCustomization: CarCustomization | null = null;
  let readyPromise: Promise<CarReadyResult> = Promise.resolve({ ok: true, carId: "" });
  let importedWheels: ImportedWheel[] = [];
  let activeImportedModel: ImportedCarModel | null = null;
  // Owned materials created for the current imported model (paint/rim overrides)
  let ownedImportedMaterials: Material[] = [];
  let disposed = false;
  importedRoot.scale.setScalar(1.15);
  const paintMaterial = new MeshPhysicalMaterial({
    color: 0xbfc3be,
    roughness: 0.38,
    metalness: 0.06,
    clearcoat: 0.75,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.55,
  });
  const wheelSideMaterial = new MeshStandardMaterial({ color: 0x2d3338, roughness: 0.55, metalness: 0.08 });
  const trimMaterial = new MeshStandardMaterial({ color: 0x242c34, roughness: 0.56, metalness: 0.08 });

  const addBodyPart = (mesh: Mesh) => {
    mesh.castShadow = true;
    bodyParts.push(mesh);
    bodyGroup.add(mesh);
    return mesh;
  };

  const body = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));
  const hood = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));
  const rearDeck = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));
  const frontBumper = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));
  const rearBumper = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));

  const cabin = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0x1d2733, roughness: 0.32, metalness: 0.08 }),
  );
  cabin.castShadow = true;
  bodyGroup.add(cabin);

  const hatchRoof = addBodyPart(new Mesh(new BoxGeometry(1, 1, 1), paintMaterial));

  const headlightMaterial = new MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd98a, emissiveIntensity: 1.45, roughness: 0.28 });
  const tailMaterial = new MeshStandardMaterial({ color: 0xb42732, emissive: 0x2c0507, emissiveIntensity: 0.45, roughness: 0.45 });
  const glassMaterial = new MeshStandardMaterial({ color: 0x111923, roughness: 0.24, metalness: 0.08, envMapIntensity: 0.42 });
  const cutlineMaterial = new MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.72 });
  const leftHeadlight = new Mesh(new BoxGeometry(0.54, 0.08, 0.06), headlightMaterial);
  leftHeadlight.position.set(-0.55, 0.64, 2.43);
  const rightHeadlight = leftHeadlight.clone();
  rightHeadlight.position.x = 0.55;
  const leftTail = new Mesh(new BoxGeometry(0.55, 0.08, 0.06), tailMaterial);
  leftTail.position.set(-0.56, 0.62, -2.42);
  const rightTail = leftTail.clone();
  rightTail.position.x = 0.56;
  bodyGroup.add(leftHeadlight, rightHeadlight, leftTail, rightTail);

  const lightRig = new Group();
  root.add(lightRig);
  const headGlowMaterial = new MeshStandardMaterial({
    color: 0xfff4cf,
    emissive: 0xffe1a2,
    emissiveIntensity: 1.5,
    roughness: 0.22,
  });
  const brakeGlowMaterial = new MeshBasicMaterial({
    color: 0xb42732,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  const rigHeadLeft = new Mesh(new BoxGeometry(0.46, 0.08, 0.055), headGlowMaterial);
  const rigHeadRight = rigHeadLeft.clone();
  const rigBrakeLeft = new Mesh(new BoxGeometry(0.66, 0.14, 0.06), brakeGlowMaterial);
  const rigBrakeRight = rigBrakeLeft.clone();
  const rigBrakeCenter = new Mesh(new BoxGeometry(0.72, 0.075, 0.055), brakeGlowMaterial);
  lightRig.add(rigHeadLeft, rigHeadRight, rigBrakeLeft, rigBrakeRight, rigBrakeCenter);

  const windshield = new Mesh(new BoxGeometry(1.16, 0.08, 0.5), glassMaterial);
  const rearGlass = new Mesh(new BoxGeometry(1.16, 0.08, 0.48), glassMaterial);
  const leftSideGlass = new Mesh(new BoxGeometry(0.05, 0.34, 1.05), glassMaterial);
  const rightSideGlass = leftSideGlass.clone();
  const leftRearSideGlass = new Mesh(new BoxGeometry(0.05, 0.3, 0.62), glassMaterial);
  const rightRearSideGlass = leftRearSideGlass.clone();
  const leftDoorCut = new Mesh(new BoxGeometry(0.035, 0.42, 0.04), cutlineMaterial);
  const rightDoorCut = leftDoorCut.clone();
  const leftBpillar = new Mesh(new BoxGeometry(0.055, 0.42, 0.05), cutlineMaterial);
  const rightBpillar = leftBpillar.clone();
  const sedanGrille = new Mesh(new BoxGeometry(0.74, 0.18, 0.05), cutlineMaterial);
  const coupeNoseVent = new Mesh(new BoxGeometry(0.42, 0.08, 0.05), cutlineMaterial);
  bodyGroup.add(
    windshield,
    rearGlass,
    leftSideGlass,
    rightSideGlass,
    leftRearSideGlass,
    rightRearSideGlass,
    leftDoorCut,
    rightDoorCut,
    leftBpillar,
    rightBpillar,
    sedanGrille,
    coupeNoseVent,
  );

  const wheelMaterial = new MeshStandardMaterial({ color: 0x151515, roughness: 0.86 });
  const wheelGeometry = new CylinderGeometry(0.38, 0.38, 0.34, 24);
  const wheelPositions = [
    { x: -1.08, z: 1.34, front: true, corner: "fl" as const },
    { x: 1.08, z: 1.34, front: true, corner: "fr" as const },
    { x: -1.08, z: -1.48, front: false, corner: "rl" as const },
    { x: 1.08, z: -1.48, front: false, corner: "rr" as const },
  ];

  for (const wheelPosition of wheelPositions) {
    const pivot = new Group();
    pivot.position.set(wheelPosition.x, 0.38, wheelPosition.z);
    suspensionPivots.push({ pivot, corner: wheelPosition.corner, baseY: 0.38 });

    const wheel = new Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    pivot.add(wheel);

    const hub = new Mesh(new CylinderGeometry(0.18, 0.18, 0.38, 18), wheelSideMaterial);
    hub.rotation.z = Math.PI / 2;
    pivot.add(hub);
    rimParts.push(hub);

    if (wheelPosition.front) {
      frontWheelPivots.push(pivot);
      frontWheelMeshes.push(wheel);
    } else {
      rearWheelMeshes.push(wheel);
    }

    root.add(pivot);
  }

  const ducktail = new Mesh(new BoxGeometry(1.62, 0.16, 0.18), paintMaterial);
  ducktail.position.set(0, 0.98, -2.0);
  ducktail.rotation.x = -0.22;
  const streetWing = new Group();
  const streetBlade = new Mesh(new BoxGeometry(1.72, 0.1, 0.24), trimMaterial);
  streetBlade.position.set(0, 1.24, -2.05);
  const streetPostL = new Mesh(new BoxGeometry(0.08, 0.38, 0.08), trimMaterial);
  streetPostL.position.set(-0.55, 1.02, -1.94);
  const streetPostR = streetPostL.clone();
  streetPostR.position.x = 0.55;
  streetWing.add(streetBlade, streetPostL, streetPostR);

  const gtWing = new Group();
  const gtBlade = new Mesh(new BoxGeometry(2.15, 0.1, 0.34), trimMaterial);
  gtBlade.position.set(0, 1.42, -2.04);
  const gtEndL = new Mesh(new BoxGeometry(0.08, 0.34, 0.42), trimMaterial);
  gtEndL.position.set(-1.12, 1.42, -2.04);
  const gtEndR = gtEndL.clone();
  gtEndR.position.x = 1.12;
  const gtPostL = new Mesh(new BoxGeometry(0.08, 0.56, 0.08), trimMaterial);
  gtPostL.position.set(-0.62, 1.12, -1.94);
  const gtPostR = gtPostL.clone();
  gtPostR.position.x = 0.62;
  gtWing.add(gtBlade, gtEndL, gtEndR, gtPostL, gtPostR);

  const streetLip = new Mesh(new BoxGeometry(1.86, 0.1, 0.2), trimMaterial);
  streetLip.position.set(0, 0.2, 2.52);
  const splitter = new Mesh(new BoxGeometry(2.12, 0.06, 0.62), trimMaterial);
  splitter.position.set(0, 0.15, 2.58);

  const streetSkirtL = new Mesh(new BoxGeometry(0.1, 0.09, 2.22), trimMaterial);
  streetSkirtL.position.set(-1.02, 0.23, -0.04);
  const streetSkirtR = streetSkirtL.clone();
  streetSkirtR.position.x = 1.02;
  const wideSkirtL = new Mesh(new BoxGeometry(0.16, 0.1, 2.48), trimMaterial);
  wideSkirtL.position.set(-1.08, 0.22, -0.04);
  const wideSkirtR = wideSkirtL.clone();
  wideSkirtR.position.x = 1.08;

  const underglowFL = new PointLight(0x2f8fff, 0, 7, 3.6);
  underglowFL.position.set(-0.82, 0.14, 2.1);
  const underglowFR = new PointLight(0x2f8fff, 0, 7, 3.6);
  underglowFR.position.set(0.82, 0.14, 2.1);
  const underglowRL = new PointLight(0x2f8fff, 0, 7, 3.6);
  underglowRL.position.set(-0.82, 0.14, -2.1);
  const underglowRR = new PointLight(0x2f8fff, 0, 7, 3.6);
  underglowRR.position.set(0.82, 0.14, -2.1);

  customParts.add(
    ducktail,
    streetWing,
    gtWing,
    streetLip,
    splitter,
    streetSkirtL,
    streetSkirtR,
    wideSkirtL,
    wideSkirtR,
    underglowFL,
    underglowFR,
    underglowRL,
    underglowRR,
  );
  customParts.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  function repositionKit(att: ImportedCarAttachments) {
    ducktail.position.set(0, att.rearDeckY, att.rearDeckZ);
    ducktail.scale.x = att.bodyWidth / 1.62;

    streetBlade.position.set(0, att.roofY + 0.02, att.rearDeckZ - 0.05);
    streetBlade.scale.x = att.bodyWidth / 1.72;
    streetPostL.position.set(-att.bodyWidth * 0.32, att.roofY - 0.2, att.rearDeckZ + 0.06);
    streetPostR.position.set(att.bodyWidth * 0.32, att.roofY - 0.2, att.rearDeckZ + 0.06);

    gtBlade.position.set(0, att.roofY + 0.2, att.rearDeckZ - 0.04);
    gtBlade.scale.x = att.bodyWidth / 2.15;
    gtEndL.position.set(-att.bodyWidth * 0.52, att.roofY + 0.2, att.rearDeckZ - 0.04);
    gtEndR.position.set(att.bodyWidth * 0.52, att.roofY + 0.2, att.rearDeckZ - 0.04);
    gtPostL.position.set(-att.bodyWidth * 0.33, att.roofY - 0.1, att.rearDeckZ + 0.06);
    gtPostR.position.set(att.bodyWidth * 0.33, att.roofY - 0.1, att.rearDeckZ + 0.06);

    streetLip.position.set(0, att.frontBumperY, att.frontBumperZ);
    streetLip.scale.x = att.bodyWidth / 1.86;
    splitter.position.set(0, att.frontBumperY - 0.05, att.frontBumperZ + 0.06);
    splitter.scale.x = att.bodyWidth / 2.12;

    streetSkirtL.position.set(-att.skirtX, att.skirtY, att.skirtZ);
    streetSkirtR.position.set(att.skirtX, att.skirtY, att.skirtZ);
    streetSkirtL.scale.z = att.skirtLength / 2.22;
    streetSkirtR.scale.z = att.skirtLength / 2.22;
    wideSkirtL.position.set(-att.skirtX - 0.06, att.skirtY - 0.01, att.skirtZ);
    wideSkirtR.position.set(att.skirtX + 0.06, att.skirtY - 0.01, att.skirtZ);
    wideSkirtL.scale.z = att.skirtLength / 2.48;
    wideSkirtR.scale.z = att.skirtLength / 2.48;

    underglowFL.position.set(-att.underglowX, 0.14, att.skirtLength * 0.42);
    underglowFR.position.set(att.underglowX, 0.14, att.skirtLength * 0.42);
    underglowRL.position.set(-att.underglowX, 0.14, -att.skirtLength * 0.42);
    underglowRR.position.set(att.underglowX, 0.14, -att.skirtLength * 0.42);
  }

  function positionLightRig(width: number, frontZ: number, rearZ: number, headY: number, tailY: number) {
    const headX = Math.min(width * 0.32, 0.78);
    const tailX = Math.min(width * 0.34, 0.82);
    rigHeadLeft.position.set(-headX, headY, frontZ);
    rigHeadRight.position.set(headX, headY, frontZ);
    rigBrakeLeft.position.set(-tailX, tailY, rearZ);
    rigBrakeRight.position.set(tailX, tailY, rearZ);
    rigBrakeCenter.position.set(0, tailY + 0.23, rearZ + 0.015);
    contactShadow.scale.set(width * 0.72, Math.max(2.2, Math.abs(frontZ - rearZ) * 0.58), 1);
  }

  function updateBrakeLights(brakeAxis: number) {
    const braking = Math.max(0, Math.min(1, brakeAxis));
    tailMaterial.emissive.setHex(braking > 0.04 ? 0xff151c : 0x2c0507);
    tailMaterial.emissiveIntensity = 0.35 + braking * 2.2;
    brakeGlowMaterial.color.setHex(braking > 0.04 ? 0xff151c : 0xb42732);
    brakeGlowMaterial.opacity = 0.32 + braking * 0.68;
  }

  // Explicit ownership-based disposal: disposes only owned geometries/materials
  // from the imported model, never shared GLTF source materials.
  function disposeImportedModelResources(model: ImportedCarModel) {
    for (const geometry of model.ownedGeometries) geometry.dispose();
    for (const material of model.ownedMaterials) material.dispose();
  }

  // Dispose car-view-owned paint/rim override materials
  function disposeImportedOverrides() {
    for (const material of ownedImportedMaterials) material.dispose();
    ownedImportedMaterials = [];
  }

  // Complete active-model teardown
  function removeActiveImportedModel() {
    if (!activeImportedModel) return;
    activeImportedModel.root.removeFromParent();
    disposeImportedOverrides();
    disposeImportedModelResources(activeImportedModel);
    activeImportedModel = null;
    importedWheels = [];
    loadedCarId = "";
  }

  function invalidatePendingLoad() {
    loadGeneration += 1;
    loadingCarId = "";
  }

  function installProceduralFallback(customization: CarCustomization | null) {
    importedRoot.visible = false;
    bodyGroup.visible = true;
    for (const wheel of suspensionPivots) wheel.pivot.visible = true;
    if (customParts.parent !== bodyGroup) {
      customParts.removeFromParent();
      bodyGroup.add(customParts);
    }
    if (customization) {
      const fallbackCustomization = { ...customization, selectedCar: "lite-coupe" as const };
      applyProceduralCustomization(fallbackCustomization);
    }
  }

  function applyImportedCustomization(customization: CarCustomization, model: ImportedCarModel) {
    const paintHex = paintColors[customization.paint] ?? paintColors.silver;
    const wheelHex = wheelColors[customization.wheelColor] ?? wheelColors["dark-alloy"];

    // Create owned body-paint override materials once, then mutate in place.
    // On subsequent calls, we update the existing owned materials instead of creating new ones.
    const needsRebuild = ownedImportedMaterials.length === 0;

    if (needsRebuild) {
      // First time applying customization to this model — create owned override materials
      for (const mesh of model.bodyMeshes) {
        const indices = model.bodyMaterialIndices.get(mesh) ?? [];
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const newMaterials = materials.map((m, i) => {
          if (!indices.includes(i)) return m;
          const source = m as MeshStandardMaterial;
          const paint = new MeshPhysicalMaterial({
            color: paintHex,
            roughness: 0.34,
            metalness: 0.08,
            clearcoat: 0.72,
            clearcoatRoughness: 0.2,
            envMapIntensity: 0.82,
            side: source.side,
          });
          prepPaintMaterial(paint, paintHex);
          paint.roughnessMap = source.roughnessMap;
          paint.metalnessMap = source.metalnessMap;
          paint.aoMap = source.aoMap;
          paint.aoMapIntensity = source.aoMapIntensity;
          paint.needsUpdate = true;
          ownedImportedMaterials.push(paint as Material);
          return paint;
        });
        mesh.material = Array.isArray(mesh.material) ? newMaterials : newMaterials[0];
      }
      for (const mesh of model.rimMeshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const newMaterials = materials.map((m) => {
          const mat = m as MeshStandardMaterial;
          if (!mat || !mat.color) return m;
          const cloned = mat.clone() as MeshStandardMaterial;
          cloned.map = null;
          cloned.normalMap = null;
          cloned.roughnessMap = null;
          cloned.metalnessMap = null;
          cloned.aoMap = null;
          cloned.displacementMap = null;
          cloned.bumpMap = null;
          cloned.vertexColors = false;
          cloned.flatShading = false;
          cloned.color.setHex(wheelHex);
          cloned.roughness = 0.5;
          cloned.metalness = 0.08;
          cloned.needsUpdate = true;
          ownedImportedMaterials.push(cloned as Material);
          return cloned;
        });
        mesh.material = Array.isArray(mesh.material) ? newMaterials : newMaterials[0];
      }
    } else {
      // Subsequent customization changes — mutate owned materials in place, don't recreate
      for (const mat of ownedImportedMaterials) {
        if (mat instanceof MeshPhysicalMaterial && mat.clearcoat > 0) {
          // Paint material — update color
          prepPaintMaterial(mat, paintHex);
        } else if (mat instanceof MeshStandardMaterial) {
          // Rim material — update color
          mat.color.setHex(wheelHex);
        }
      }
    }

    stanceDrop = customization.stance === "low" ? 0.11 : customization.stance === "drift" ? 0.08 : 0;

    if (customParts.parent !== importedRoot) {
      customParts.removeFromParent();
      importedRoot.add(customParts);
    }

    const att = getAttachments(customization.selectedCar);
    repositionKit(att);
    positionLightRig(att.bodyWidth, att.frontBumperZ + 0.28, att.rearDeckZ - 0.3, att.frontBumperY + 0.42, Math.max(0.62, att.rearDeckY - 0.36));

    hide(ducktail, streetWing, gtWing, streetLip, splitter, streetSkirtL, streetSkirtR, wideSkirtL, wideSkirtR);
    if (customization.spoiler === "ducktail") ducktail.visible = true;
    if (customization.spoiler === "street-wing") streetWing.visible = true;
    if (customization.spoiler === "gt-wing") gtWing.visible = true;
    if (customization.frontLip === "street-lip") streetLip.visible = true;
    if (customization.frontLip === "splitter") splitter.visible = true;
    if (customization.sideSkirts === "street-skirts") {
      streetSkirtL.visible = true;
      streetSkirtR.visible = true;
    }
    if (customization.sideSkirts === "wide-skirts") {
      wideSkirtL.visible = true;
      wideSkirtR.visible = true;
    }

    const color = resolveUnderglowColor(customization);
    const glowIntensity = customization.underglow === "off" ? 0 : 6;
    underglowFL.color.setHex(color);
    underglowFR.color.setHex(color);
    underglowRL.color.setHex(color);
    underglowRR.color.setHex(color);
    underglowFL.intensity = glowIntensity;
    underglowFR.intensity = glowIntensity;
    underglowRL.intensity = glowIntensity;
    underglowRR.intensity = glowIntensity;
  }

  function beginImportedLoad(carId: string) {
    const generation = ++loadGeneration;
    loadingCarId = carId;
    loadError = null;

    removeActiveImportedModel();
    importedRoot.clear();
    importedRoot.add(customParts);

    readyPromise = createImportedCarModel(carId)
      .then((model): CarReadyResult => {
        if (!model) {
          throw new Error(`No imported model definition for ${carId}`);
        }

        if (
          disposed ||
          generation !== loadGeneration ||
          requestedCarId !== carId
        ) {
          disposeImportedModelResources(model);
          return {
            ok: false,
            carId,
            error: new Error("Vehicle request was superseded"),
          };
        }

        activeImportedModel = model;
        importedRoot.add(model.root);
        importedWheels = model.wheels;
        loadedCarId = carId;
        loadingCarId = "";

        model.root.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = false;
          }
        });

        if (latestCustomization) {
          applyImportedCustomization(latestCustomization, model);
        }

        return { ok: true, carId };
      })
      .catch((cause): CarReadyResult => {
        if (generation !== loadGeneration || disposed) {
          return {
            ok: false,
            carId,
            error: new Error("Vehicle request was superseded"),
          };
        }

        const error =
          cause instanceof Error
            ? cause
            : new Error(String(cause));

        loadingCarId = "";
        loadedCarId = "";
        loadError = error;

        installProceduralFallback(latestCustomization);
        return { ok: false, carId, error };
      });
  }

  function applyCustomization(customization: CarCustomization) {
    latestCustomization = { ...customization };

    if (isImportedCar(customization.selectedCar)) {
      const carId = customization.selectedCar;
      requestedCarId = carId;
      loadError = null;

      bodyGroup.visible = false;
      for (const wheel of suspensionPivots) wheel.pivot.visible = false;
      importedRoot.visible = true;

      // Already loaded — just update customization in place
      if (loadedCarId === carId && activeImportedModel) {
        applyImportedCustomization(latestCustomization, activeImportedModel);
        return;
      }

      // Critical: customization changes while the same model is loading
      // must update latestCustomization only. Do not launch another request.
      if (loadingCarId === carId) {
        return;
      }

      beginImportedLoad(carId);
      return;
    }

    // Switching imported → procedural — invalidate pending load and remove model
    invalidatePendingLoad();
    requestedCarId = "";
    loadError = null;
    removeActiveImportedModel();
    importedRoot.clear();
    importedRoot.add(customParts);
    importedRoot.visible = false;
    bodyGroup.visible = true;
    for (const wheel of suspensionPivots) wheel.pivot.visible = true;

    if (customParts.parent !== bodyGroup) {
      customParts.removeFromParent();
      bodyGroup.add(customParts);
    }

    applyProceduralCustomization(customization);
  }

  // Extracted procedural customization logic so it can be called from the fallback path
  function applyProceduralCustomization(customization: CarCustomization) {
    const profile = carProfiles[(customization.selectedCar as CarProfileId) in carProfiles ? (customization.selectedCar as CarProfileId) : "lite-coupe"];
    const paint = paintColors[customization.paint] ?? paintColors.silver;
    const wheel = wheelColors[customization.wheelColor] ?? wheelColors["dark-alloy"];
    prepPaintMaterial(paintMaterial, paint);
    wheelSideMaterial.color.setHex(wheel);
    for (const part of bodyParts) part.material = paintMaterial;
    for (const rim of rimParts) rim.material = wheelSideMaterial;

    setBox(body, profile.body.width, profile.body.height, profile.body.length);
    body.position.y = profile.body.y;
    setBox(hood, profile.hood.width, profile.hood.height, profile.hood.length);
    hood.position.set(0, profile.hood.y, profile.hood.z);
    setBox(rearDeck, profile.rearDeck.width, profile.rearDeck.height, profile.rearDeck.length);
    rearDeck.position.set(0, profile.rearDeck.y, profile.rearDeck.z);
    rearDeck.visible = profile.rearDeck.visible;
    setBox(frontBumper, profile.body.width + 0.02, 0.34, 0.48);
    frontBumper.position.set(0, 0.42, profile.frontBumperZ);
    setBox(rearBumper, profile.body.width + 0.02, 0.34, 0.42);
    rearBumper.position.set(0, 0.42, profile.rearBumperZ);
    setBox(cabin, profile.cabin.width, profile.cabin.height, profile.cabin.length);
    cabin.position.set(0, profile.cabin.y, profile.cabin.z);
    setBox(hatchRoof, profile.hatchRoof.width, profile.hatchRoof.height, profile.hatchRoof.length);
    hatchRoof.position.set(0, profile.hatchRoof.y, profile.hatchRoof.z);
    hatchRoof.rotation.x = profile.hatchRoof.rotation;
    hatchRoof.visible = profile.hatchRoof.visible;

    const sedan = profile.visualStyle === "sedan";
    windshield.position.set(0, profile.cabin.y + 0.13, profile.cabin.z + profile.cabin.length * 0.39);
    windshield.rotation.x = sedan ? -0.22 : -0.35;
    rearGlass.position.set(0, profile.cabin.y + 0.09, profile.cabin.z - profile.cabin.length * 0.42);
    rearGlass.rotation.x = sedan ? 0.18 : 0.34;
    leftSideGlass.position.set(-profile.cabin.width * 0.52, profile.cabin.y + 0.03, profile.cabin.z + 0.14);
    rightSideGlass.position.set(profile.cabin.width * 0.52, profile.cabin.y + 0.03, profile.cabin.z + 0.14);
    leftRearSideGlass.position.set(-profile.cabin.width * 0.52, profile.cabin.y, profile.cabin.z - 0.62);
    rightRearSideGlass.position.set(profile.cabin.width * 0.52, profile.cabin.y, profile.cabin.z - 0.62);
    leftDoorCut.position.set(-profile.body.width * 0.506, 0.66, profile.cabin.z + 0.04);
    rightDoorCut.position.set(profile.body.width * 0.506, 0.66, profile.cabin.z + 0.04);
    leftBpillar.position.set(-profile.cabin.width * 0.53, profile.cabin.y + 0.01, profile.cabin.z - 0.25);
    rightBpillar.position.set(profile.cabin.width * 0.53, profile.cabin.y + 0.01, profile.cabin.z - 0.25);
    setBox(leftSideGlass, 0.05, sedan ? 0.32 : 0.28, sedan ? 0.72 : 0.96);
    setBox(rightSideGlass, 0.05, sedan ? 0.32 : 0.28, sedan ? 0.72 : 0.96);
    setVisible(sedan, leftRearSideGlass, rightRearSideGlass, leftDoorCut, rightDoorCut, leftBpillar, rightBpillar, sedanGrille);
    setVisible(!sedan, coupeNoseVent);

    leftHeadlight.scale.set(sedan ? 0.72 : 1, 1, 1);
    rightHeadlight.scale.set(sedan ? 0.72 : 1, 1, 1);
    leftHeadlight.position.set(sedan ? -0.42 : -0.55, 0.64, profile.frontBumperZ + 0.25);
    rightHeadlight.position.set(sedan ? 0.42 : 0.55, 0.64, profile.frontBumperZ + 0.25);
    leftTail.scale.set(sedan ? 0.62 : 1, 1, 1);
    rightTail.scale.set(sedan ? 0.62 : 1, 1, 1);
    leftTail.position.set(sedan ? -0.68 : -0.56, 0.62, profile.rearBumperZ - 0.25);
    rightTail.position.set(sedan ? 0.68 : 0.56, 0.62, profile.rearBumperZ - 0.25);
    sedanGrille.position.set(0, 0.55, profile.frontBumperZ + 0.26);
    coupeNoseVent.position.set(0, 0.66, profile.frontBumperZ + 0.26);
    positionLightRig(profile.body.width, profile.frontBumperZ + 0.26, profile.rearBumperZ - 0.26, 0.65, 0.63);

    for (let index = 0; index < suspensionPivots.length; index += 1) {
      const wheelPosition = wheelPositions[index];
      const pivot = suspensionPivots[index].pivot;
      pivot.position.x = (wheelPosition.x < 0 ? -1 : 1) * profile.wheelTrack;
      pivot.position.z = wheelPosition.front ? profile.wheelbaseFront : profile.wheelbaseRear;
      pivot.scale.setScalar(profile.wheelRadius / 0.38);
    }

    stanceDrop = customization.stance === "low" ? 0.11 : customization.stance === "drift" ? 0.08 : 0;

    hide(ducktail, streetWing, gtWing, streetLip, splitter, streetSkirtL, streetSkirtR, wideSkirtL, wideSkirtR);
    if (customization.spoiler === "ducktail") ducktail.visible = true;
    if (customization.spoiler === "street-wing") streetWing.visible = true;
    if (customization.spoiler === "gt-wing") gtWing.visible = true;
    if (customization.frontLip === "street-lip") streetLip.visible = true;
    if (customization.frontLip === "splitter") splitter.visible = true;
    if (customization.sideSkirts === "street-skirts") {
      streetSkirtL.visible = true;
      streetSkirtR.visible = true;
    }
    if (customization.sideSkirts === "wide-skirts") {
      wideSkirtL.visible = true;
      wideSkirtR.visible = true;
    }

    const color = resolveUnderglowColor(customization);
    const glowIntensity = customization.underglow === "off" ? 0 : 6;
    underglowFL.color.setHex(color);
    underglowFR.color.setHex(color);
    underglowRL.color.setHex(color);
    underglowRR.color.setHex(color);
    underglowFL.intensity = glowIntensity;
    underglowFR.intensity = glowIntensity;
    underglowRL.intensity = glowIntensity;
    underglowRR.intensity = glowIntensity;
  }

  // No automatic car load at construction — callers apply customization explicitly.
  // This prevents a stale default async load racing with the real customization.

  return {
    root,
    sync(car: CarState) {
      root.position.set(car.position.x, 0, car.position.z);
      root.rotation.y = car.heading;
      updateBrakeLights(car.brakeAxis);
      if (requestedCarId) {
        importedRoot.position.y = 0.036 - stanceDrop;
        importedRoot.rotation.x = car.bodyPitch * 0.055;
        importedRoot.rotation.z = -car.bodyRoll * 0.055;
        lightRig.position.y = importedRoot.position.y;
        lightRig.rotation.x = importedRoot.rotation.x;
        lightRig.rotation.z = importedRoot.rotation.z;

        for (const wheel of importedWheels) {
          const corner: WheelCorner = wheel.front
            ? (wheel.left ? "fl" : "fr")
            : (wheel.left ? "rl" : "rr");
          const compression = ({
            fl: car.suspensionFL,
            fr: car.suspensionFR,
            rl: car.suspensionRL,
            rr: car.suspensionRR,
          })[corner];
          const suspOffset = (0.5 - compression) * 0.06;
          wheel.object.position.y = wheel.baseY + stanceDrop - suspOffset;
          wheel.object.rotation.copy(wheel.baseRotation);
          if (wheel.front) wheel.object.rotateY(car.frontWheelAngle);
          wheel.object.rotateX(wheel.front ? -car.wheelSpin : -car.rearWheelSpin);
        }
        return;
      }

      bodyGroup.position.y = 0.056 - stanceDrop + Math.abs(car.bodyPitch) * 0.006 + Math.abs(car.bodyRoll) * 0.004;
      bodyGroup.rotation.x = car.bodyPitch * 0.06;
      bodyGroup.rotation.z = -car.bodyRoll * 0.07;
      lightRig.position.y = bodyGroup.position.y;
      lightRig.rotation.x = bodyGroup.rotation.x;
      lightRig.rotation.z = bodyGroup.rotation.z;

      const compressionByCorner: Record<WheelCorner, number> = {
        fl: car.suspensionFL,
        fr: car.suspensionFR,
        rl: car.suspensionRL,
        rr: car.suspensionRR,
      };

      for (const wheel of suspensionPivots) {
        const compression = compressionByCorner[wheel.corner];
        wheel.pivot.position.y = wheel.baseY + (0.5 - compression) * 0.04 - stanceDrop * 0.35;
      }

      for (const pivot of frontWheelPivots) {
        pivot.rotation.y = car.frontWheelAngle;
      }

      for (const wheel of frontWheelMeshes) {
        wheel.rotation.x = -car.wheelSpin;
        wheel.rotation.z = Math.PI / 2;
      }

      for (const wheel of rearWheelMeshes) {
        wheel.rotation.x = -car.rearWheelSpin;
        wheel.rotation.z = Math.PI / 2;
      }
    },
    applyCustomization,
    applyAttachments(att: ImportedCarAttachments) {
      if (!requestedCarId) return;
      repositionKit(att);
    },
    getActiveImportedCarId() {
      return requestedCarId;
    },
    whenReady() {
      return readyPromise;
    },
    getLoadState(): CarLoadState {
      return {
        requestedCarId,
        loadingCarId,
        loadedCarId,
        loading: loadingCarId !== "",
        error: loadError,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidatePendingLoad();
      removeActiveImportedModel();

      // Ensure customParts is back under bodyGroup before traversal
      if (customParts.parent !== bodyGroup) {
        customParts.removeFromParent();
        bodyGroup.add(customParts);
      }
      importedRoot.clear();

      // Traverse the entire root — now free of imported-model source objects
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();

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
          material.dispose();
        }
      });

      // Dispose the contact shadow texture exactly once
      const shadowMat = contactShadow.material as MeshBasicMaterial;
      shadowMat.map?.dispose();
    },
  };
}
