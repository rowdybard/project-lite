import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { paintColors, underglowColors, wheelColors, type CarCustomization } from "../../game/customization";
import type { CarState } from "../../game/types";

type WheelCorner = "fl" | "fr" | "rl" | "rr";

export function createCarView(scale = 1) {
  const root = new Group();
  const bodyGroup = new Group();
  root.add(bodyGroup);
  const frontWheelPivots: Group[] = [];
  const frontWheelMeshes: Mesh[] = [];
  const rearWheelMeshes: Mesh[] = [];
  const rearSlipBars: Mesh[] = [];
  const suspensionPivots: { pivot: Group; corner: WheelCorner; baseY: number }[] = [];
  const loadBars: { mesh: Mesh; corner: WheelCorner }[] = [];
  const bodyParts: Mesh[] = [];
  const rimParts: Mesh[] = [];
  const customParts = new Group();
  bodyGroup.add(customParts);
  let stanceDrop = 0;
  let underglow: Mesh | null = null;
  let spoiler: Mesh | null = null;
  let wingPostLeft: Mesh | null = null;
  let wingPostRight: Mesh | null = null;
  let frontLip: Mesh | null = null;
  let leftSkirt: Mesh | null = null;
  let rightSkirt: Mesh | null = null;

  const paintMaterial = new MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5, metalness: 0.12 });
  const wheelSideMaterial = new MeshStandardMaterial({ color: 0x2d3338, roughness: 0.55, metalness: 0.08 });

  {
    bodyGroup.scale.setScalar(scale);

    const body = new Mesh(
      new BoxGeometry(1.96, 0.52, 4.62),
      paintMaterial,
    );
    body.position.y = 0.56;
    body.castShadow = true;
    bodyParts.push(body);

    const hood = new Mesh(
      new BoxGeometry(1.78, 0.13, 1.34),
      paintMaterial,
    );
    hood.position.set(0, 0.9, 0.95);
    hood.castShadow = true;
    bodyParts.push(hood);

    const cabin = new Mesh(
      new BoxGeometry(1.28, 0.54, 1.36),
      new MeshStandardMaterial({ color: 0x1d2733, roughness: 0.32, metalness: 0.08 }),
    );
    cabin.position.set(0, 0.98, -0.36);
    cabin.castShadow = true;

    const rearDeck = new Mesh(
      new BoxGeometry(1.78, 0.15, 0.9),
      paintMaterial,
    );
    rearDeck.position.set(0, 0.86, -1.42);
    rearDeck.castShadow = true;
    bodyParts.push(rearDeck);

    const frontBumper = new Mesh(new BoxGeometry(1.98, 0.34, 0.48), paintMaterial);
    frontBumper.position.set(0, 0.42, 2.18);
    frontBumper.castShadow = true;
    bodyParts.push(frontBumper);

    const rearBumper = new Mesh(new BoxGeometry(1.98, 0.34, 0.42), paintMaterial);
    rearBumper.position.set(0, 0.42, -2.18);
    rearBumper.castShadow = true;
    bodyParts.push(rearBumper);

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

    bodyGroup.add(body, hood, cabin, rearDeck, frontBumper, rearBumper, leftHeadlight, rightHeadlight, leftTail, rightTail);

    const wheelMaterial = new MeshStandardMaterial({ color: 0x151515, roughness: 0.86 });
    const indicatorMaterial = new MeshStandardMaterial({
      color: 0x68d8ff,
      emissive: 0x16495c,
      roughness: 0.35,
    });
    const rearSlipMaterial = new MeshStandardMaterial({
      color: 0xffb14a,
      emissive: 0x5a2600,
      roughness: 0.4,
    });
    const loadMaterial = new MeshStandardMaterial({
      color: 0xffdf72,
      emissive: 0x3a2600,
      roughness: 0.42,
    });
    const wheelGeometry = new CylinderGeometry(0.38, 0.38, 0.34, 24);
    const indicatorGeometry = new BoxGeometry(0.08, 0.05, 1.08);
    const rearSlipGeometry = new BoxGeometry(0.1, 0.04, 1.28);
    const loadGeometry = new BoxGeometry(0.18, 0.09, 0.58);
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
        const indicator = new Mesh(indicatorGeometry, indicatorMaterial);
        indicator.position.set(0, 0.48, 0.48);
        indicator.castShadow = true;
        pivot.add(indicator);
        frontWheelPivots.push(pivot);
        frontWheelMeshes.push(wheel);
      } else {
        const slipBar = new Mesh(rearSlipGeometry, rearSlipMaterial);
        slipBar.position.set(0, 0.48, -0.45);
        slipBar.visible = false;
        pivot.add(slipBar);
        rearSlipBars.push(slipBar);
        rearWheelMeshes.push(wheel);
      }

      root.add(pivot);

      const loadBar = new Mesh(loadGeometry, loadMaterial.clone());
      loadBar.position.set(wheelPosition.x, 0.82, wheelPosition.z);
      loadBar.castShadow = true;
      bodyGroup.add(loadBar);
      loadBars.push({ mesh: loadBar, corner: wheelPosition.corner });
    }

    underglow = new Mesh(
      new BoxGeometry(1.9, 0.035, 3.55),
      new MeshStandardMaterial({ color: 0x2f8fff, emissive: 0x2f8fff, transparent: true, opacity: 0.38 }),
    );
    underglow.position.set(0, 0.1, -0.1);
    customParts.add(underglow);

    spoiler = new Mesh(new BoxGeometry(1.55, 0.12, 0.18), paintMaterial);
    spoiler.position.set(0, 1.05, -1.95);
    spoiler.castShadow = true;
    customParts.add(spoiler);

    const postMaterial = new MeshStandardMaterial({ color: 0x242c34, roughness: 0.56 });
    wingPostLeft = new Mesh(new BoxGeometry(0.08, 0.34, 0.08), postMaterial);
    wingPostLeft.position.set(-0.62, 0.84, -1.9);
    wingPostRight = wingPostLeft.clone();
    wingPostRight.position.x = 0.62;
    customParts.add(wingPostLeft, wingPostRight);

    frontLip = new Mesh(new BoxGeometry(1.9, 0.08, 0.42), postMaterial);
    frontLip.position.set(0, 0.2, 2.45);
    frontLip.castShadow = true;
    customParts.add(frontLip);

    leftSkirt = new Mesh(new BoxGeometry(0.16, 0.12, 2.78), postMaterial);
    leftSkirt.position.set(-1.07, 0.25, -0.1);
    rightSkirt = leftSkirt.clone();
    rightSkirt.position.x = 1.07;
    customParts.add(leftSkirt, rightSkirt);
  }

  function applyCustomization(customization: CarCustomization) {
    const paint = paintColors[customization.paint] ?? paintColors.silver;
    const wheel = wheelColors[customization.wheelColor] ?? wheelColors["dark-alloy"];
    paintMaterial.color.setHex(paint);
    wheelSideMaterial.color.setHex(wheel);
    for (const part of bodyParts) part.material = paintMaterial;
    for (const rim of rimParts) rim.material = wheelSideMaterial;

    stanceDrop = customization.stance === "low" ? 0.11 : customization.stance === "drift" ? 0.08 : 0;

    if (spoiler) {
      spoiler.visible = customization.spoiler !== "none";
      spoiler.scale.set(
        customization.spoiler === "gt-wing" ? 1.22 : 1,
        customization.spoiler === "ducktail" ? 0.55 : 1,
        customization.spoiler === "ducktail" ? 0.7 : 1,
      );
      spoiler.position.y = customization.spoiler === "gt-wing" ? 1.28 : customization.spoiler === "ducktail" ? 0.95 : 1.08;
    }

    const postsVisible = customization.spoiler === "street-wing" || customization.spoiler === "gt-wing";
    if (wingPostLeft) wingPostLeft.visible = postsVisible;
    if (wingPostRight) wingPostRight.visible = postsVisible;

    if (frontLip) {
      frontLip.visible = customization.frontLip !== "none";
      frontLip.scale.z = customization.frontLip === "splitter" ? 1.45 : 1;
    }

    const skirtsVisible = customization.sideSkirts !== "none";
    if (leftSkirt) {
      leftSkirt.visible = skirtsVisible;
      leftSkirt.scale.x = customization.sideSkirts === "wide-skirts" ? 1.45 : 1;
    }
    if (rightSkirt) {
      rightSkirt.visible = skirtsVisible;
      rightSkirt.scale.x = customization.sideSkirts === "wide-skirts" ? 1.45 : 1;
    }

    if (underglow) {
      underglow.visible = customization.underglow !== "off";
      const material = underglow.material as MeshStandardMaterial;
      const color = underglowColors[customization.underglow] ?? underglowColors.off;
      material.color.setHex(color);
      material.emissive.setHex(color);
    }
  }

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
        wheel.pivot.position.y = wheel.baseY + (0.5 - compression) * 0.09;
      }

      for (const bar of loadBars) {
        const compression = compressionByCorner[bar.corner];
        bar.mesh.scale.y = 0.45 + compression * 1.85;
        bar.mesh.position.y = 0.75 + compression * 0.12;
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

      for (const bar of rearSlipBars) {
        bar.visible = car.rearSlipVisual > 0.12;
        bar.scale.z = 0.45 + car.rearSlipVisual * 1.35;
        bar.position.z = -0.45 - car.rearSlipVisual * 0.35;
      }
    },
    applyCustomization,
  };
}
