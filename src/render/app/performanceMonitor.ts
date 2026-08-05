import type { WebGLRenderer } from "three";

const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function createPerformanceMonitor(renderer: WebGLRenderer) {
  const root = document.createElement("output");
  root.className = "performance-monitor";
  root.hidden = !new URLSearchParams(window.location.search).has("perf");
  document.body.append(root);

  let smoothedFrameMs = 16.7;
  let updateDebt = 0;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "KeyT" || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select")) return;
    root.hidden = !root.hidden;
  };
  window.addEventListener("keydown", onKeyDown);

  return {
    update(frameSeconds: number, fixedSteps: number, droppedSeconds: number) {
      smoothedFrameMs += (frameSeconds * 1000 - smoothedFrameMs) * smooth(4, frameSeconds);
      if (root.hidden) return;
      updateDebt += frameSeconds;
      if (updateDebt < 0.2) return;
      updateDebt = 0;

      const info = renderer.info;
      const fps = smoothedFrameMs > 0 ? 1000 / smoothedFrameMs : 0;
      root.textContent = [
        `${fps.toFixed(0)} FPS`,
        `${smoothedFrameMs.toFixed(1)} ms`,
        `${info.render.calls} calls`,
        `${Math.round(info.render.triangles / 1000)}k tris`,
        `${info.memory.textures} tex`,
        `${fixedSteps} sim`,
        droppedSeconds > 0 ? `-${Math.round(droppedSeconds * 1000)}ms` : "",
      ].filter(Boolean).join("  ");
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      root.remove();
    },
  };
}
