import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from "three";
import { arenaPalette } from "./palette";

// Procedural arena-interior environment map. v1 baked the shell from a scene with NO lights
// in it, so PMREM captured emissive strips on black and the IBL was dead — this is generated
// directly, so the environment is bright by construction and cannot bake to black.
//
// Layout of the equirect (v=0 is straight up): bright cool ceiling with fixture hotspots,
// mid-tone walls, darker warm floor for bounce. Car paint and asphalt spec read off this.

function hexToCss(hex: number) {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

export function bakeArenaEnvironment(renderer: WebGLRenderer): Texture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Vertical zones: ceiling (top), upper wall, lower wall, floor (bottom).
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0.0, hexToCss(arenaPalette.envCeilingHot));
  gradient.addColorStop(0.3, hexToCss(arenaPalette.envCeiling));
  gradient.addColorStop(0.36, hexToCss(arenaPalette.envUpperWall));
  gradient.addColorStop(0.62, hexToCss(arenaPalette.envLowerWall));
  gradient.addColorStop(0.78, hexToCss(arenaPalette.envFloorLine));
  gradient.addColorStop(1.0, hexToCss(arenaPalette.envFloor));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Truss fixture hotspots across the ceiling band (two rows, matching the ±30% truss layout).
  const fixtureRows = [0.1, 0.22];
  for (const rowV of fixtureRows) {
    const y = height * rowV;
    for (let i = 0; i < 10; i++) {
      const x = (i / 10) * width + width * 0.05;
      const glow = ctx.createRadialGradient(x, y, 2, x, y, width * 0.055);
      glow.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      glow.addColorStop(0.35, "rgba(235, 244, 255, 0.55)");
      glow.addColorStop(1, "rgba(235, 244, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - width * 0.06, y - height * 0.06, width * 0.12, height * 0.12);
    }
  }

  // Warm accent blobs low on the walls (sodium sconces) — small, accent only.
  for (let i = 0; i < 8; i++) {
    const x = (i / 8) * width + width * 0.0625;
    const y = height * 0.66;
    const glow = ctx.createRadialGradient(x, y, 1, x, y, width * 0.03);
    glow.addColorStop(0, hexToCss(arenaPalette.envWarmAccent));
    glow.addColorStop(1, "rgba(255, 190, 120, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - width * 0.035, y - height * 0.05, width * 0.07, height * 0.1);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;

  const pmrem = new PMREMGenerator(renderer);
  console.time("arena-env-bake");
  const renderTarget = pmrem.fromEquirectangular(texture);
  console.timeEnd("arena-env-bake");
  pmrem.dispose();
  texture.dispose();

  return renderTarget.texture;
}
