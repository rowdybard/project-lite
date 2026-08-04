import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from "three";

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.15));
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}
