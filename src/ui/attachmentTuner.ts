import {
  getAttachments,
  setAttachments,
  type ImportedCarAttachments,
} from "../render/objects/importedCars";

type SliderDef = { key: keyof ImportedCarAttachments; label: string; min: number; max: number; step: number };

const sliders: SliderDef[] = [
  { key: "bodyWidth", label: "Body Width", min: 1.2, max: 2.8, step: 0.01 },
  { key: "rearDeckY", label: "Rear Deck Y", min: 0.4, max: 2.2, step: 0.01 },
  { key: "rearDeckZ", label: "Rear Deck Z", min: -3.0, max: -0.5, step: 0.01 },
  { key: "roofY", label: "Roof Y (wing)", min: 0.6, max: 2.4, step: 0.01 },
  { key: "frontBumperY", label: "Front Bumper Y", min: 0.0, max: 1.0, step: 0.01 },
  { key: "frontBumperZ", label: "Front Bumper Z", min: 1.0, max: 3.2, step: 0.01 },
  { key: "skirtX", label: "Skirt X", min: 0.5, max: 1.6, step: 0.01 },
  { key: "skirtY", label: "Skirt Y", min: 0.0, max: 0.8, step: 0.01 },
  { key: "skirtZ", label: "Skirt Z", min: -1.0, max: 1.0, step: 0.01 },
  { key: "skirtLength", label: "Skirt Length", min: 1.0, max: 3.5, step: 0.01 },
  { key: "underglowX", label: "Underglow X", min: 0.3, max: 1.6, step: 0.01 },
];

export function createAttachmentTuner(onChange: (attachments: ImportedCarAttachments) => void) {
  const root = document.createElement("div");
  root.className = "attachment-tuner";
  root.hidden = true;
  document.body.append(root);

  let activeCarId = "";
  let live: ImportedCarAttachments = { ...getAttachments("") };

  function render() {
    live = { ...getAttachments(activeCarId) };
    root.innerHTML = `
      <div class="attachment-tuner__header">
        <strong>Kit Tuner</strong>
        <span>${activeCarId}</span>
        <button data-copy type="button">Copy JSON</button>
        <button data-copy-all type="button">Copy All</button>
      </div>
      <div data-sliders></div>
    `;

    const container = root.querySelector("[data-sliders]")!;
    for (const def of sliders) {
      const row = document.createElement("label");
      row.className = "attachment-tuner__row";
      row.innerHTML = `
        <span>${def.label}</span>
        <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${live[def.key]}">
        <output>${live[def.key].toFixed(2)}</output>
      `;
      const input = row.querySelector("input")!;
      const output = row.querySelector("output")!;
      input.addEventListener("input", () => {
        live[def.key] = Number(input.value);
        output.textContent = Number(input.value).toFixed(2);
        setAttachments(activeCarId, { ...live });
        onChange({ ...live });
      });
      container.append(row);
    }

    root.querySelector("[data-copy]")!.addEventListener("click", () => {
      const json = JSON.stringify({ [activeCarId]: live }, null, 2);
      navigator.clipboard.writeText(json).then(
        () => alert("Copied to clipboard!"),
        () => prompt("Copy this:", json),
      );
    });

    root.querySelector("[data-copy-all]")!.addEventListener("click", () => {
      const allIds = [
        "pack-suv", "pack-pickup", "pack-hatchback",
        "pack-sedan", "pack-muscle", "pack-muscle-2",
      ];
      const all: Record<string, ImportedCarAttachments> = {};
      for (const id of allIds) all[id] = getAttachments(id);
      const json = JSON.stringify(all, null, 2);
      navigator.clipboard.writeText(json).then(
        () => alert("Copied ALL to clipboard!"),
        () => prompt("Copy this:", json),
      );
    });
  }

  return {
    root,
    show(carId: string) {
      activeCarId = carId;
      root.hidden = false;
      render();
    },
    hide() {
      root.hidden = true;
      activeCarId = "";
    },
  };
}
