import type { CarTuning } from "./types";

export type ModeId = "online-lobby" | "map-editor" | "drift-attack" | "free-drive" | "drag-race" | "lap-race";
export type CustomizationSlot =
  | "selectedCar"
  | "paint"
  | "wheelColor"
  | "stance"
  | "spoiler"
  | "frontLip"
  | "sideSkirts"
  | "underglow"
  | "tuningPreset";

export type CarCustomization = {
  selectedCar: string;
  paint: string;
  wheelColor: string;
  stance: string;
  spoiler: string;
  frontLip: string;
  sideSkirts: string;
  underglow: string;
  tuningPreset: string;
  selectedMode: ModeId;
};

export type CustomizationOption = {
  id: string;
  label: string;
  color?: number;
  disabled?: boolean;
};

export type CustomizationCategory = {
  id: CustomizationSlot | "decals";
  label: string;
  comingSoon?: boolean;
  options: CustomizationOption[];
};

const storageKeyPrefix = "projectLite.car.";
const globalStorageKey = "projectLite.global.v2";

export const defaultCustomization: CarCustomization = {
  selectedCar: "pack-suv",
  paint: "silver",
  wheelColor: "dark-alloy",
  stance: "stock",
  spoiler: "none",
  frontLip: "none",
  sideSkirts: "none",
  underglow: "off",
  tuningPreset: "balanced",
  selectedMode: "drift-attack",
};

export const carOptions: CustomizationOption[] = [];

export const importedCarOptions: CustomizationOption[] = [
  { id: "pack-suv", label: "Pack SUV" },
  { id: "pack-pickup", label: "Pack Pickup" },
  { id: "pack-hatchback", label: "Pack Hatchback" },
  { id: "pack-sedan", label: "Pack Sedan" },
  { id: "pack-muscle", label: "Pack Muscle" },
  { id: "pack-muscle-2", label: "Pack Muscle 2" },
];

export const allSelectableCarOptions = [...carOptions.filter((option) => !option.disabled), ...importedCarOptions];

export function getCarLabel(id: string) {
  return allSelectableCarOptions.find((option) => option.id === id)?.label ?? "Lite Coupe";
}

export const carTuningPaths: Record<string, string> = {
  "pack-suv": "/assets/cars/imports/suv-tuning.json",
  "pack-pickup": "/assets/cars/imports/pickup-tuning.json",
  "pack-hatchback": "/assets/cars/imports/hatchback-tuning.json",
  "pack-sedan": "/assets/cars/imports/sedan-tuning.json",
  "pack-muscle": "/assets/cars/imports/muscle-tuning.json",
  "pack-muscle-2": "/assets/cars/imports/muscle2-tuning.json",
};

export const modeOptions: CustomizationOption[] = [
  { id: "online-lobby", label: "Online" },
  { id: "map-editor", label: "Map Editor" },
  { id: "drift-attack", label: "Drift Attack" },
  { id: "free-drive", label: "Practice Grounds" },
  { id: "drag-race", label: "Drag Race", disabled: true },
  { id: "lap-race", label: "Lap Race", disabled: true },
];

export function isPlayableMode(mode: string): mode is ModeId {
  return mode === "online-lobby" || mode === "map-editor" || mode === "drift-attack" || mode === "free-drive";
}

export const customizationCategories: CustomizationCategory[] = [
  {
    id: "paint",
    label: "Paint",
    options: [
      { id: "silver", label: "Silver", color: 0xbfc3be },
      { id: "red", label: "Red", color: 0x7f2429 },
      { id: "blue", label: "Blue", color: 0x244b74 },
      { id: "black", label: "Black", color: 0x11151b },
      { id: "green", label: "Green", color: 0x315c43 },
      { id: "purple", label: "Purple", color: 0x514078 },
    ],
  },
  {
    id: "wheelColor",
    label: "Wheels",
    options: [
      { id: "dark-alloy", label: "Dark alloy", color: 0x2d3338 },
      { id: "chrome", label: "Chrome", color: 0xbcc7cc },
      { id: "white", label: "White", color: 0xf1eee2 },
      { id: "bronze", label: "Bronze", color: 0xa06a2a },
    ],
  },
  {
    id: "stance",
    label: "Stance",
    options: [
      { id: "stock", label: "Stock" },
      { id: "low", label: "Low" },
      { id: "drift", label: "Drift stance" },
    ],
  },
  {
    id: "spoiler",
    label: "Body",
    options: [
      { id: "none", label: "No spoiler" },
      { id: "ducktail", label: "Ducktail" },
      { id: "street-wing", label: "Street wing" },
      { id: "gt-wing", label: "GT wing" },
    ],
  },
  {
    id: "frontLip",
    label: "Front Lip",
    options: [
      { id: "none", label: "None" },
      { id: "street-lip", label: "Street lip" },
      { id: "splitter", label: "Splitter" },
    ],
  },
  {
    id: "sideSkirts",
    label: "Side Skirts",
    options: [
      { id: "none", label: "None" },
      { id: "street-skirts", label: "Street skirts" },
      { id: "wide-skirts", label: "Wide skirts" },
    ],
  },
  {
    id: "underglow",
    label: "Underglow",
    options: [
      { id: "off", label: "Off" },
      { id: "blue", label: "Blue", color: 0x2f8fff },
      { id: "green", label: "Green", color: 0x55e27d },
      { id: "purple", label: "Purple", color: 0x9a5cff },
    ],
  },
  {
    id: "tuningPreset",
    label: "Tuning",
    options: [
      { id: "grip", label: "Grip" },
      { id: "balanced", label: "Balanced" },
      { id: "drift", label: "Drift" },
    ],
  },
  {
    id: "decals",
    label: "Decals",
    comingSoon: true,
    options: [{ id: "soon", label: "Coming Soon", disabled: true }],
  },
];

export const paintColors = Object.fromEntries(
  customizationCategories.find((category) => category.id === "paint")!.options.map((option) => [option.id, option.color!]),
) as Record<string, number>;

export const wheelColors = Object.fromEntries(
  customizationCategories
    .find((category) => category.id === "wheelColor")!
    .options.map((option) => [option.id, option.color!]),
) as Record<string, number>;

export const underglowColors: Record<string, number> = {
  off: 0x000000,
  blue: 0x2f8fff,
  green: 0x55e27d,
  purple: 0x9a5cff,
};

export function loadCustomization(): CarCustomization {
  const global = window.localStorage.getItem(globalStorageKey);
  let selectedCar = defaultCustomization.selectedCar;
  let selectedMode = defaultCustomization.selectedMode;
  if (global) {
    try {
      const g = JSON.parse(global);
      if (g.selectedCar && allSelectableCarOptions.some((o) => o.id === g.selectedCar)) selectedCar = g.selectedCar;
      if (g.selectedMode && isPlayableMode(g.selectedMode)) selectedMode = g.selectedMode;
    } catch { /* ignore */ }
  }
  const perCar = window.localStorage.getItem(storageKeyPrefix + selectedCar);
  if (!perCar) return { ...defaultCustomization, selectedCar, selectedMode };
  try {
    return { ...defaultCustomization, ...JSON.parse(perCar), selectedCar, selectedMode };
  } catch {
    return { ...defaultCustomization, selectedCar, selectedMode };
  }
}

export function loadCarCustomization(carId: string): Omit<CarCustomization, "selectedCar" | "selectedMode"> {
  const raw = window.localStorage.getItem(storageKeyPrefix + carId);
  if (!raw) return { ...defaultCustomization };
  try {
    return { ...defaultCustomization, ...JSON.parse(raw) };
  } catch {
    return { ...defaultCustomization };
  }
}

export function saveCustomization(customization: CarCustomization) {
  // Save per-car visual settings
  const { selectedCar, selectedMode, ...perCar } = customization;
  window.localStorage.setItem(storageKeyPrefix + selectedCar, JSON.stringify(perCar));
  // Save global state (which car is selected, which mode)
  window.localStorage.setItem(globalStorageKey, JSON.stringify({ selectedCar, selectedMode }));
}

export function applyTuningPreset(base: CarTuning, preset: string): CarTuning {
  const tuning: CarTuning = { ...base, gearRatios: [...base.gearRatios] };

  if (preset === "grip") {
    tuning.frontGrip *= 1.18;
    tuning.rearGrip *= 1.22;
    tuning.handbrakeRearGrip *= 1.12;
    tuning.frontCorneringStiffness *= 1.1;
    tuning.rearCorneringStiffness *= 1.12;
    tuning.throttleGripLoss *= 0.62;
    tuning.counterSteerAssist *= 1.18;
    tuning.slideDrag *= 1.16;
    tuning.driftDrag *= 1.08;
    tuning.yawDamping *= 1.22;
    tuning.yawInertia *= 1.08;
  }

  if (preset === "drift") {
    tuning.maxSteerAngle *= 1.03;
    tuning.steeringAtSpeed *= 1.04;
    tuning.rearGrip *= 0.88;
    tuning.handbrakeRearGrip *= 0.82;
    tuning.throttleGripLoss *= 1.18;
    tuning.counterSteerAssist *= 0.94;
    tuning.slideDrag *= 1.02;
    tuning.yawDamping *= 0.9;
  }

  if (preset === "balanced") {
    tuning.frontGrip *= 1.06;
    tuning.rearGrip *= 1.04;
    tuning.counterSteerAssist *= 1.08;
    tuning.slideDrag *= 1.06;
    tuning.yawDamping *= 1.1;
    tuning.yawInertia *= 1.05;
  }

  return tuning;
}
