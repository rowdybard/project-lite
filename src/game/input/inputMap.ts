import type { InputState } from "../types";

const keys = new Set<string>();
let debugPressed = false;
let resetPressed = false;
let menuPressed = false;
let handbrakePulseUntil = 0;

const handbrakeKeys = new Set(["Space", "ShiftLeft", "ShiftRight", "KeyE"]);

// Gamepad state
let cameraOrbit = 0;
let padHandbrakePulseUntil = 0;

function deadzone(value: number, threshold = 0.12): number {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

function getGamepad(): Gamepad | null {
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i]!.connected) return pads[i];
  }
  return null;
}

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

  // --- Keyboard ---
  let throttle = keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0;
  let brake = keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0;
  let steerLeft = keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0;
  let steerRight = keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0;
  let handbrake = [...handbrakeKeys].some((code) => keys.has(code)) || handbrakePulseUntil > now;

  // --- Gamepad ---
  const pad = getGamepad();
  if (pad) {
    // Standard mapping: axes[0]=LS_X, axes[1]=LS_Y, axes[2]=RS_X, axes[3]=RS_Y
    // buttons[6]=LT, buttons[7]=RT, buttons[1]=B, buttons[9]=Start
    const lsX = deadzone(pad.axes[0] ?? 0);
    const rsX = deadzone(pad.axes[2] ?? 0, 0.1);

    // Triggers — value 0..1 on standard mapping
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;

    throttle = Math.max(throttle, rt);
    brake = Math.max(brake, lt);

    // Left stick steering (replace keyboard binary with analog)
    if (Math.abs(lsX) > 0.01) {
      steerLeft = lsX < 0 ? -lsX : 0;
      steerRight = lsX > 0 ? lsX : 0;
    }

    // Right stick X → camera orbit (in radians, max ±2.2)
    cameraOrbit = rsX * 2.2;

    // B button (index 1) → handbrake
    const bButton = pad.buttons[1];
    if (bButton) {
      if (bButton.pressed && padHandbrakePulseUntil <= now) {
        padHandbrakePulseUntil = now + 260;
      }
      handbrake = handbrake || bButton.pressed || padHandbrakePulseUntil > now;
    }

    // Start (index 9) → back to menu
    if (pad.buttons[9]?.pressed) menuPressed = true;
  } else {
    cameraOrbit = 0;
  }

  const state: InputState = {
    throttle,
    brake,
    steer: steerLeft - steerRight,
    handbrake,
    reset: resetPressed,
    debug: debugPressed,
    menu: menuPressed,
  };

  debugPressed = false;
  resetPressed = false;
  menuPressed = false;
  return state;
}

export function getCameraOrbit(): number {
  return cameraOrbit;
}
