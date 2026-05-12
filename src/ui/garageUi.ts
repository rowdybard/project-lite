import {
  customizationCategories,
  modeOptions,
  type CarCustomization,
  type CustomizationCategory,
  type CustomizationSlot,
  type ModeId,
} from "../game/customization";

type GarageUiCallbacks = {
  onCustomizationChange: (slot: CustomizationSlot, value: string) => void;
  onModeChange: (mode: ModeId) => void;
  onStart: () => void;
};

function optionButton(option: { id: string; label: string; color?: number; disabled?: boolean }, active: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.option = option.id;
  button.className = active ? "garage-option is-active" : "garage-option";
  button.disabled = !!option.disabled;
  button.innerHTML = option.color
    ? `<span class="garage-option__swatch" style="--swatch:#${option.color.toString(16).padStart(6, "0")}"></span>${option.label}`
    : `<span>${option.label}</span>`;
  return button;
}

const tabCategoryIds = new Set(["paint", "wheelColor", "stance", "spoiler", "tuningPreset", "decals"]);
const bodySlotIds: CustomizationSlot[] = ["spoiler", "frontLip", "sideSkirts", "underglow"];

export function createGarageUi(customization: CarCustomization, callbacks: GarageUiCallbacks) {
  const root = document.createElement("div");
  root.className = "garage-ui";
  document.body.append(root);

  let activeCategory: CustomizationCategory = customizationCategories[0];
  let activeBodySlot: CustomizationSlot = "spoiler";

  function render() {
    root.innerHTML = `
      <header class="garage-header">
        <p>Project Lite</p>
        <h1>Garage</h1>
        <span>Build, tune, launch</span>
      </header>
      <aside class="garage-mode">
        <p class="garage-kicker">Event</p>
        <h2>Mode Select</h2>
        <div data-modes></div>
        <button class="garage-start" type="button">Start Event</button>
      </aside>
      <section class="garage-panel">
        <nav class="garage-tabs" data-tabs></nav>
        <div class="garage-panel__title">
          <h2>${activeCategory.label}</h2>
          ${activeCategory.comingSoon ? "<span>Coming Soon</span>" : ""}
        </div>
        <div class="garage-options" data-options></div>
      </section>
    `;

    const modes = root.querySelector("[data-modes]")!;
    for (const mode of modeOptions) {
      const button = optionButton(mode, customization.selectedMode === mode.id);
      button.classList.add("garage-mode__button");
      if (mode.disabled) button.innerHTML += "<small>Coming Soon</small>";
      button.addEventListener("click", () => callbacks.onModeChange(mode.id as ModeId));
      modes.append(button);
    }

    const tabs = root.querySelector("[data-tabs]")!;
    for (const category of customizationCategories.filter((item) => tabCategoryIds.has(item.id))) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = category.id === activeCategory.id ? "is-active" : "";
      button.textContent =
        category.id === "spoiler" ? "Body" : category.comingSoon ? `${category.label} Coming Soon` : category.label;
      button.addEventListener("click", () => {
        activeCategory = category;
        render();
      });
      tabs.append(button);
    }

    const options = root.querySelector("[data-options]")!;
    if (activeCategory.id === "spoiler") {
      const bodyTabs = document.createElement("nav");
      bodyTabs.className = "garage-subtabs";
      for (const slot of bodySlotIds) {
        const category = customizationCategories.find((item) => item.id === slot)!;
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = slot === activeBodySlot ? "is-active" : "";
        tab.textContent = category.label;
        tab.addEventListener("click", () => {
          activeBodySlot = slot;
          render();
        });
        bodyTabs.append(tab);
      }
      options.append(bodyTabs);

      const category = customizationCategories.find((item) => item.id === activeBodySlot)!;
      const group = document.createElement("section");
      group.className = "garage-option-group";
      for (const option of category.options) {
        const active = customization[activeBodySlot] === option.id;
        const button = optionButton(option, active);
        button.addEventListener("click", () => callbacks.onCustomizationChange(activeBodySlot, option.id));
        group.append(button);
      }
      options.append(group);
    } else if (!activeCategory.comingSoon) {
      for (const option of activeCategory.options) {
        const slot = activeCategory.id as CustomizationSlot;
        const active = customization[slot] === option.id;
        const button = optionButton(option, active);
        button.addEventListener("click", () => callbacks.onCustomizationChange(slot, option.id));
        options.append(button);
      }
    } else {
      const soon = document.createElement("p");
      soon.className = "garage-soon";
      soon.textContent = "Decals will arrive after the first gameplay loop is locked.";
      options.append(soon);
    }

    root.querySelector(".garage-start")!.addEventListener("click", callbacks.onStart);
  }

  render();

  return {
    root,
    update(next: CarCustomization) {
      Object.assign(customization, next);
      render();
    },
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
