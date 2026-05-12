import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from "three";
import type { CarState } from "../../game/types";

type WheelCorner = "fl" | "fr" | "rl" | "rr";

function prepareImportedCar(imported: Object3D, scale: number) {
  const paint = new MeshStandardMaterial({ color: 0x8f1f2d, roughness: 0.46, metalness: 0.16 });
  const glass = new MeshStandardMaterial({ color: 0x101923, roughness: 0.22, metalness: 0.04 });
  const tire = new MeshStandardMaterial({ color: 0x101010, roughness: 0.92 });
  const light = new MeshStandardMaterial({ color: 0xf2efe2, emissive: 0x2a2417, roughness: 0.38 });
  const trim = new MeshStandardMaterial({ color: 0x252d34, roughness: 0.62, metalness: 0.08 });

  imported.traverse((node) => {
    if (!(node instanceof Mesh)) return;

    const name = node.name.toLowerCase();
    if (name.includes("glass") || name.includes("window") || name.includes("windshield")) node.material = glass;
    else if (name.includes("tire") || name.includes("wheel")) node.material = tire;
    else if (name.includes("light") || name.includes("lamp")) node.material = light;
    else if (name.includes("grille") || name.includes("trim") || name.includes("mirror")) node.material = trim;
    else node.material = paint;

    node.castShadow = true;
    node.receiveShadow = true;
  });

  imported.updateMatrixWorld(true);
  const box = new Box3().setFromObject(imported);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const fitScale = size.z > 0 ? 4.55 / size.z : 1;
  imported.scale.setScalar(fitScale * scale);
  imported.position.set(-center.x * fitScale * scale, -box.min.y * fitScale * scale + 0.08, -center.z * fitScale * scale);
}

export function createCarView(imported: Object3D | null, scale = 1) {
  const root = new Group();
  const bodyGroup = new Group();
  root.add(bodyGroup);
  const frontWheelPivots: Group[] = [];
  const frontWheelMeshes: Mesh[] = [];
  const rearWheelMeshes: Mesh[] = [];
  const rearSlipBars: Mesh[] = [];
  const suspensionPivots: { pivot: Group; corner: WheelCorner; baseY: number }[] = [];
  const loadBars: { mesh: Mesh; corner: WheelCorner }[] = [];

  if (imported) {
    prepareImportedCar(imported, scale);
    bodyGroup.add(imported);
  } else {
    const body = new Mesh(
      new BoxGeometry(1.92, 0.52, 4.48),
      new MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.5, metalness: 0.12 }),
    );
    body.position.y = 0.56;
    body.castShadow = true;

    const hood = new Mesh(
      new BoxGeometry(1.72, 0.14, 1.28),
      new MeshStandardMaterial({ color: 0xc7cbd1, roughness: 0.54, metalness: 0.1 }),
    );
    hood.position.set(0, 0.9, 0.95);
    hood.castShadow = true;

    const cabin = new Mesh(
      new BoxGeometry(1.34, 0.5, 1.42),
      new MeshStandardMaterial({ color: 0x1d2733, roughness: 0.32, metalness: 0.08 }),
    );
    cabin.position.set(0, 0.96, -0.45);
    cabin.castShadow = true;

    const rearDeck = new Mesh(
      new BoxGeometry(1.72, 0.16, 0.78),
      new MeshStandardMaterial({ color: 0xc7cbd1, roughness: 0.54, metalness: 0.1 }),
    );
    rearDeck.position.set(0, 0.86, -1.45);
    rearDeck.castShadow = true;

    bodyGroup.add(body, hood, cabin, rearDeck);

    const wheelMaterial = new MeshStandardMaterial({ color: 0x151515, roughness: 0.86 });
    const wheelSideMaterial = new MeshStandardMaterial({ color: 0x2d3338, roughness: 0.55 });
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
  }

  return {
    root,
    sync(car: CarState) {
      root.position.set(car.position.x, 0, car.position.z);
      root.rotation.y = car.heading;
      bodyGroup.position.y = 0.02 + Math.abs(car.bodyPitch) * 0.018 + Math.abs(car.bodyRoll) * 0.012;
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
  };
}
