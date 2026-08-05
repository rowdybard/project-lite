import {
  customizationCategories,
  importedCarOptions,
  type CarCustomization,
  type CustomizationCategory,
  type CustomizationSlot,
} from "../game/customization";
import type { PlayerProfile } from "../net/profile";

type GarageUiCallbacks = {
  onCustomizationChange: (slot: CustomizationSlot, value: string) => void;
  onProfileChange: (profile: PlayerProfile) => void;
  onStart: () => void;
  onOpenVfxLab: () => void;
  onBack: () => void;
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

export function createGarageUi(customization: CarCustomization, profile: PlayerProfile, callbacks: GarageUiCallbacks) {
  const root = document.createElement("div");
  root.className = "garage-ui";
  document.body.append(root);

  let activeCategory: CustomizationCategory = customizationCategories[0];
  let activeBodySlot: CustomizationSlot = "spoiler";

  const requestStart = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onStart();
  };

  function render() {
    root.innerHTML = `
      <header class="garage-header">
        <p>Drift Attack</p>
        <h1>Garage</h1>
        <span>Build, tune, drive out</span>
        <label class="garage-profile">
          <small>Driver</small>
          <input data-profile-name maxlength="18" />
        </label>
      </header>
      <aside class="garage-mode">
        <p class="garage-kicker">Practice Grounds</p>
        <h2>Garage Bay</h2>
        <section class="garage-cars">
          <div class="garage-cars__header">
            <div>
            <p class="garage-kicker">Car Select</p>
            <h2>Vehicles</h2>
            </div>
          </div>
          <div class="garage-car-grid" data-cars></div>
        </section>
        <button class="garage-start" type="button">Drive Practice</button>
        <button class="garage-vfx" type="button">VFX Lab</button>
        <button class="garage-back" type="button">Back to Menu</button>
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

    const cars = root.querySelector("[data-cars]")!;
    cars.innerHTML = "";
    for (const car of importedCarOptions) {
      const active = customization.selectedCar === car.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `garage-car-card${active ? " is-active" : ""}`;
      button.textContent = car.label;
      button.addEventListener("click", () => callbacks.onCustomizationChange("selectedCar", car.id));
      cars.append(button);
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

    const startButton = root.querySelector(".garage-start")!;
    startButton.addEventListener("click", requestStart);

    root.querySelector(".garage-vfx")!.addEventListener("click", () => callbacks.onOpenVfxLab());
    root.querySelector(".garage-back")!.addEventListener("click", () => callbacks.onBack());

    const profileName = root.querySelector<HTMLInputElement>("[data-profile-name]")!;
    profileName.value = profile.name;  // Set via property, not innerHTML — XSS-safe
    profileName.addEventListener("change", () => callbacks.onProfileChange({ name: profileName.value }));
    profileName.addEventListener("blur", () => callbacks.onProfileChange({ name: profileName.value }));
  }

  render();

  let loadingIndicator: HTMLElement | null = null;

  let vehicleState = {
    loading: false,
    error: null as string | null,
  };

  function updateStartButton() {
    const startButton = root.querySelector<HTMLButtonElement>(".garage-start");
    if (!startButton) return;
    startButton.disabled = vehicleState.loading || vehicleState.error !== null;
    startButton.textContent = vehicleState.loading
      ? "Loading Vehicle…"
      : vehicleState.error
        ? "Vehicle Unavailable"
        : "Drive Practice";
  }

  function ensureLoadingIndicator() {
    if (loadingIndicator && root.contains(loadingIndicator)) return loadingIndicator;
    loadingIndicator = document.createElement("div");
    loadingIndicator.className = "garage-loading";
    loadingIndicator.hidden = true;
    loadingIndicator.textContent = "Loading car…";
    root.append(loadingIndicator);
    return loadingIndicator;
  }

  return {
    root,
    update(next: CarCustomization, nextProfile = profile) {
      Object.assign(customization, next);
      Object.assign(profile, nextProfile);
      render();
    },
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    setLoading(active: boolean) {
      const indicator = ensureLoadingIndicator();
      indicator.hidden = !active;
      updateStartButton();
    },
    setVehicleState(state: { loading: boolean; error: string | null }) {
      vehicleState = state;
      const indicator = ensureLoadingIndicator();
      indicator.hidden = !state.loading;
      updateStartButton();
    },
    dispose() {
      root.remove();
    },
  };
}
