import {
  Vector2,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";

// Post chain: scene (linear HDR) -> selective bloom (threshold 1.0, so only emissive
// fixtures/taillights/signage glow) -> OutputPass (ACES + sRGB) -> FXAA.
// No grain, no vignette — the arena reads clean and bright.

export type PostPipeline = {
  render(dt: number): void;
  setSize(width: number, height: number): void;
  setBloomEnabled(enabled: boolean): void;
};

export function createPostPipeline(renderer: WebGLRenderer, scene: Scene, camera: Camera): PostPipeline {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const isMobile = typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent));
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new Vector2(size.x, size.y), 0.3, 0.3, 1.0);
  bloomPass.enabled = !isMobile;
  const outputPass = new OutputPass();
  const fxaaPass = new FXAAPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(fxaaPass);
  composer.setSize(size.x, size.y);

  return {
    render(_dt: number) {
      composer.render();
    },
    setSize(width: number, height: number) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    setBloomEnabled(enabled: boolean) {
      bloomPass.enabled = enabled;
    },
  };
}
