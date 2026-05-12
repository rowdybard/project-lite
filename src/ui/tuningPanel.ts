import type { CarTuning } from "../game/types";

type NumericTuningKey = Exclude<keyof CarTuning, "gearRatios">;

const ranges: Partial<Record<NumericTuningKey, [number, number, number]>> = {
  maxForwardSpeed: [20, 95, 1],
  acceleration: [8, 70, 1],
  brakeForce: [12, 95, 1],
  engineTorque: [0.5, 1.5, 0.01],
  shiftUpRpm: [4500, 7600, 100],
  shiftDownRpm: [1200, 4500, 100],
  steeringAtSpeed: [0.08, 1, 0.01],
  maxSteerAngle: [18, 50, 1],
  frontGrip: [5, 18, 0.1],
  rearGrip: [3, 16, 0.1],
  handbrakeRearGrip: [0.4, 8, 0.1],
  frontCorneringStiffness: [15, 120, 1],
  rearCorneringStiffness: [10, 110, 1],
  throttleGripLoss: [0, 0.7, 0.01],
  counterSteerAssist: [0, 7, 0.1],
  offTrackGrip: [0.15, 1, 0.01],
  offTrackDrag: [0, 4, 0.05],
  slideDrag: [0, 0.08, 0.001],
  handbrakeDrag: [0, 2.5, 0.05],
  yawDamping: [0.2, 4, 0.05],
};

const labels: Partial<Record<NumericTuningKey, string>> = {
  maxForwardSpeed: "top speed",
  acceleration: "launch",
  brakeForce: "brakes",
  engineTorque: "engine torque",
  shiftUpRpm: "shift up rpm",
  shiftDownRpm: "shift down rpm",
  steeringAtSpeed: "fast steering",
  maxSteerAngle: "wheel angle",
  frontGrip: "front grip",
  rearGrip: "rear grip",
  handbrakeRearGrip: "e-brake rear grip",
  frontCorneringStiffness: "front tire bite",
  rearCorneringStiffness: "rear tire bite",
  throttleGripLoss: "power oversteer",
  counterSteerAssist: "countersteer help",
  offTrackGrip: "grass grip",
  offTrackDrag: "grass slowdown",
  slideDrag: "slide slowdown",
  handbrakeDrag: "e-brake slowdown",
  yawDamping: "spin damping",
};

export function hydrateTuningPanel(panel: HTMLElement, tuning: CarTuning) {
  const fields = panel.querySelector("[data-tune-fields]")!;
  fields.innerHTML = "";

  for (const key of Object.keys(ranges) as NumericTuningKey[]) {
    const [min, max, step] = ranges[key]!;
    const row = document.createElement("label");
    row.className = "tune-row";
    row.innerHTML = `
      <span>${labels[key] ?? key}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${tuning[key]}">
      <output>${tuning[key]}</output>
    `;

    const input = row.querySelector("input")!;
    const output = row.querySelector("output")!;
    input.addEventListener("input", () => {
      tuning[key] = Number(input.value);
      output.textContent = Number(input.value).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1);
    });

    fields.append(row);
  }
}
