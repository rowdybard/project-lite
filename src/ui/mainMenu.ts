// Big mode-select popup shown over the practice-world garage.
// Replaces the old open-world portal concept — the player picks a mode here
// and launches directly into it.

import type { ModeId } from "../game/customization";

type MainMenuCallbacks = {
  onLaunchMode: (mode: ModeId) => void;
  onOptions: () => void;
};

type ModeCard = {
  id: ModeId;
  label: string;
  blurb: string;
  accent: string;
  disabled?: boolean;
};

const modeCards: ModeCard[] = [
  {
    id: "drift-attack",
    label: "Drift Attack",
    blurb: "Timed drift scoring on the closed circuit. Chain combos, hold the angle.",
    accent: "#d0a63e",
  },
  {
    id: "free-drive",
    label: "Practice Grounds",
    blurb: "Open practice with skidpad, gymkhana, and a full road loop. No timer.",
    accent: "#68d8ff",
  },
];

export function createMainMenu(callbacks: MainMenuCallbacks) {
  const root = document.createElement("div");
  root.className = "main-menu";
  root.innerHTML = `
    <section class="main-menu__card">
      <p class="main-menu__eyebrow">Project Lite</p>
      <h1 class="main-menu__title">Drift Attack</h1>
      <p class="main-menu__blurb">Pick a mode to drive. Tune your car in the garage first.</p>
      <div class="main-menu__modes" data-modes></div>
      <div class="main-menu__actions">
        <button class="main-menu__options" type="button" data-options>Garage &amp; Tuning</button>
      </div>
    </section>
  `;
  document.body.append(root);

  const modesContainer = root.querySelector<HTMLElement>("[data-modes]")!;
  for (const card of modeCards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-card";
    button.dataset.mode = card.id;
    button.disabled = !!card.disabled;
    button.style.setProperty("--accent", card.accent);
    button.innerHTML = `
      <span class="mode-card__label">${card.label}</span>
      <span class="mode-card__blurb">${card.blurb}</span>
    `;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onLaunchMode(card.id);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callbacks.onLaunchMode(card.id);
    });
    modesContainer.append(button);
  }

  const optionsButton = root.querySelector<HTMLButtonElement>("[data-options]")!;
  optionsButton.addEventListener("click", () => callbacks.onOptions());

  return {
    root,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    setPlayEnabled(enabled: boolean) {
      for (const btn of modesContainer.querySelectorAll<HTMLButtonElement>(".mode-card")) {
        btn.disabled = !enabled;
      }
      optionsButton.disabled = !enabled;
    },
  };
}
