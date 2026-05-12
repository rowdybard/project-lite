import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight } from "three";
import { paintColors, underglowColors, wheelColors, type CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";

type WheelCorner = "fl" | "fr" | "rl" | "rr";
type CarProfileId = "lite-coupe" | "street-hatch";

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
    wheelbaseFront: 1.34,
    wheelbaseRear: -1.48,
    wheelTrack: 1.08,
    wheelRadius: 0.38,
  },
  "street-hatch": {
    body: { width: 1.82, length: 3.82, height: 0.62, y: 0.58 },
    hood: { width: 1.58, length: 1.0, height: 0.15, y: 0.92, z: 0.92 },
    rearDeck: { width: 1.48, length: 0.32, height: 0.14, y: 0.88, z: -1.68, visible: false },
    cabin: { width: 1.36, length: 1.58, height: 0.68, y: 1.04, z: -0.55 },
    hatchRoof: { width: 1.52, length: 1.2, height: 0.28, y: 0.94, z: -1.18, rotation: -0.34, visible: true },
    frontBumperZ: 1.86,
    rearBumperZ: -1.86,
    wheelbaseFront: 1.1,
    wheelbaseRear: -1.22,
    wheelTrack: 1.0,
    wheelRadius: 0.34,
  },
};

const hide = (...objects: (Mesh | Group | PointLight | null)[]) => {
  for (const object of objects) if (object) object.visible = false;
};

const setBox = (mesh: Mesh, width: number, height: number, depth: number) => {
  mesh.scale.set(width, height, depth);
};

export function createCarView(scale = 1) {
  const root = new Group();
  const bodyGroup = new Group();
  root.add(bodyGroup);
  bodyGroup.scale.setScalar(scale);

  const frontWheelPivots: Group[] = [];
  const frontWheelMeshes: Mesh[] = [];
  const rearWheelMeshes: Mesh[] = [];
  const suspensionPivots: { pivot: Group; corner: WheelCorner; baseY: number }[] = [];
  const bodyParts: Mesh[] = [];
  const rimParts: Mesh[] = [];
  const customParts = new Group();
  bodyGroup.add(customParts);

  let stanceDrop = 0;
  const paintMaterial = new MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5, metalness: 0.12 });
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

  const headlightMaterial = new MeshStandardMaterial({ color: 0xf4efe0, emissive: 0x332816, roughness: 0.4 });
  const tailMaterial = new MeshStandardMaterial({ color: 0xb42732, emissive: 0x2c0507, roughness: 0.45 });
  const leftHeadlight = new Mesh(new BoxGeometry(0.54, 0.08, 0.06), headlightMaterial);
  leftHeadlight.position.set(-0.55, 0.64, 2.43);
  const rightHeadlight = leftHeadlight.clone();
  rightHeadlight.position.x = 0.55;
  const leftTail = new Mesh(new BoxGeometry(0.55, 0.08, 0.06), tailMaterial);
  leftTail.position.set(-0.56, 0.62, -2.42);
  const rightTail = leftTail.clone();
  rightTail.position.x = 0.56;
  bodyGroup.add(leftHeadlight, rightHeadlight, leftTail, rightTail);

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

  const underglowLeft = new PointLight(0x2f8fff, 0, 4.2, 2.4);
  underglowLeft.position.set(-0.82, 0.16, 0);
  const underglowRight = new PointLight(0x2f8fff, 0, 4.2, 2.4);
  underglowRight.position.set(0.82, 0.16, 0);

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
    underglowLeft,
    underglowRight,
  );

  function applyCustomization(customization: CarCustomization) {
    const profile = carProfiles[(customization.selectedCar as CarProfileId) in carProfiles ? (customization.selectedCar as CarProfileId) : "lite-coupe"];
    const paint = paintColors[customization.paint] ?? paintColors.silver;
    const wheel = wheelColors[customization.wheelColor] ?? wheelColors["dark-alloy"];
    paintMaterial.color.setHex(paint);
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

    const color = underglowColors[customization.underglow] ?? underglowColors.off;
    underglowLeft.color.setHex(color);
    underglowRight.color.setHex(color);
    underglowLeft.intensity = customization.underglow === "off" ? 0 : 2.4;
    underglowRight.intensity = customization.underglow === "off" ? 0 : 2.4;
  }

  applyCustomization({
    paint: "silver",
    selectedCar: "lite-coupe",
    wheelColor: "dark-alloy",
    stance: "stock",
    spoiler: "none",
    frontLip: "none",
    sideSkirts: "none",
    underglow: "off",
    tuningPreset: "balanced",
    selectedMode: "drift-attack",
  });

  return {
    root,
    sync(car: CarState) {
      root.position.set(car.position.x, 0, car.position.z);
      root.rotation.y = car.heading;
      bodyGroup.position.y = 0.02 - stanceDrop + Math.abs(car.bodyPitch) * 0.018 + Math.abs(car.bodyRoll) * 0.012;
      bodyGroup.rotation.x = car.bodyPitch * 0.105;
      bodyGroup.rotation.z = -car.bodyRoll * 0.12;

      const compressionByCorner: Record<WheelCorner, number> = {
        fl: car.suspensionFL,
        fr: car.suspensionFR,
        rl: car.suspensionRL,
        rr: car.suspensionRR,
      };

      for (const wheel of suspensionPivots) {
        const compression = compressionByCorner[wheel.corner];
        wheel.pivot.position.y = wheel.baseY + (0.5 - compression) * 0.09 - stanceDrop * 0.35;
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
  };
}
