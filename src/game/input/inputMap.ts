import type { InputState } from "../types";

const keys = new Set<string>();
let debugPressed = false;
let resetPressed = false;
let handbrakePulseUntil = 0;

const handbrakeKeys = new Set(["Space", "ShiftLeft", "ShiftRight", "KeyE"]);

export function bindInput(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (handbrakeKeys.has(event.code) && !keys.has(event.code)) {
      handbrakePulseUntil = performance.now() + 260;
    }

    keys.add(event.code);

    if (event.code === "KeyT") debugPressed = true;
    if (event.code === "KeyR") resetPressed = true;

    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "KeyE"].includes(
        event.code,
      )
    ) {
      event.preventDefault();
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.code);
  };

  document.addEventListener("keydown", onKeyDown, { capture: true });
  document.addEventListener("keyup", onKeyUp, { capture: true });

  return () => {
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    document.removeEventListener("keyup", onKeyUp, { capture: true });
  };
}

export function readInput(): InputState {
  const now = performance.now();
  const throttle = keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0;
  const brake = keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0;
  const steerLeft = keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0;
  const steerRight = keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0;

  const state: InputState = {
    throttle,
    brake,
    steer: steerLeft - steerRight,
    handbrake: [...handbrakeKeys].some((code) => keys.has(code)) || handbrakePulseUntil > now,
    reset: resetPressed,
    debug: debugPressed,
  };

  debugPressed = false;
  resetPressed = false;
  return state;
}
