import { ACESFilmicToneMapping, PCFSoftShadowMap, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from "three";
import { arenaPalette } from "../arena/palette";

export function isMobileDevice() {
  return (
    typeof navigator !== "undefined" &&
    (navigator.maxTouchPoints > 0 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent))
  );
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: !isMobileDevice(), powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = arenaPalette.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = isMobileDevice() ? PCFShadowMap : PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobileDevice() ? 1.0 : 1.15));
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}
