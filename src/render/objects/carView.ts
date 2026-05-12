import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight } from "three";
import { paintColors, underglowColors, wheelColors, type CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";

type WheelCorner = "fl" | "fr" | "rl" | "rr";

const hide = (...objects: (Mesh | Group | PointLight | null)[]) => {
  for (const object of objects) if (object) object.visible = false;
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

  addBodyPart(new Mesh(new BoxGeometry(1.96, 0.52, 4.62), paintMaterial)).position.y = 0.56;
  addBodyPart(new Mesh(new BoxGeometry(1.78, 0.13, 1.34), paintMaterial)).position.set(0, 0.9, 0.95);
  addBodyPart(new Mesh(new BoxGeometry(1.78, 0.15, 0.9), paintMaterial)).position.set(0, 0.86, -1.42);
  addBodyPart(new Mesh(new BoxGeometry(1.98, 0.34, 0.48), paintMaterial)).position.set(0, 0.42, 2.18);
  addBodyPart(new Mesh(new BoxGeometry(1.98, 0.34, 0.42), paintMaterial)).position.set(0, 0.42, -2.18);

  const cabin = new Mesh(
    new BoxGeometry(1.28, 0.54, 1.36),
    new MeshStandardMaterial({ color: 0x1d2733, roughness: 0.32, metalness: 0.08 }),
  );
  cabin.position.set(0, 0.98, -0.36);
  cabin.castShadow = true;
  bodyGroup.add(cabin);

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

  const streetSkirtL = new Mesh(new BoxGeometry(0.16, 0.12, 2.78), trimMaterial);
  streetSkirtL.position.set(-1.07, 0.25, -0.1);
  const streetSkirtR = streetSkirtL.clone();
  streetSkirtR.position.x = 1.07;
  const wideSkirtL = new Mesh(new BoxGeometry(0.28, 0.14, 3.05), trimMaterial);
  wideSkirtL.position.set(-1.14, 0.23, -0.08);
  const wideSkirtR = wideSkirtL.clone();
  wideSkirtR.position.x = 1.14;

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
    const paint = paintColors[customization.paint] ?? paintColors.silver;
    const wheel = wheelColors[customization.wheelColor] ?? wheelColors["dark-alloy"];
    paintMaterial.color.setHex(paint);
    wheelSideMaterial.color.setHex(wheel);
    for (const part of bodyParts) part.material = paintMaterial;
    for (const rim of rimParts) rim.material = wheelSideMaterial;

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
        wheel.rotation.x = car.wheelSpin;
        wheel.rotation.z = Math.PI / 2;
      }

      for (const wheel of rearWheelMeshes) {
        wheel.rotation.x = car.rearWheelSpin;
        wheel.rotation.z = Math.PI / 2;
      }
    },
    applyCustomization,
  };
}
