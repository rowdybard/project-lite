import type { CarTuning } from "./types";

export type ModeId = "drift-attack" | "free-drive" | "drag-race" | "lap-race";
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

const storageKey = "projectLite.customization.v1";

export const defaultCustomization: CarCustomization = {
  selectedCar: "lite-coupe",
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

export const carOptions: CustomizationOption[] = [
  { id: "lite-coupe", label: "Lite Coupe" },
  { id: "street-sedan", label: "Street Sedan" },
  { id: "slot-3", label: "Empty Bay", disabled: true },
  { id: "slot-4", label: "Empty Bay", disabled: true },
];

export const modeOptions: CustomizationOption[] = [
  { id: "drift-attack", label: "Drift Attack" },
  { id: "free-drive", label: "Free Drive" },
  { id: "drag-race", label: "Drag Race", disabled: true },
  { id: "lap-race", label: "Lap Race", disabled: true },
];

export const customizationCategories: CustomizationCategory[] = [
  {
    id: "paint",
    label: "Paint",
    options: [
      { id: "silver", label: "Silver", color: 0xd9dde2 },
      { id: "red", label: "Red", color: 0x9b2430 },
      { id: "blue", label: "Blue", color: 0x24558f },
      { id: "black", label: "Black", color: 0x11151b },
      { id: "green", label: "Green", color: 0x2e6b49 },
      { id: "purple", label: "Purple", color: 0x5f3f8d },
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
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return { ...defaultCustomization };

  try {
    return { ...defaultCustomization, ...JSON.parse(raw) };
  } catch {
    return { ...defaultCustomization };
  }
}

export function saveCustomization(customization: CarCustomization) {
  window.localStorage.setItem(storageKey, JSON.stringify(customization));
}

export function applyTuningPreset(base: CarTuning, preset: string): CarTuning {
  const tuning: CarTuning = { ...base, gearRatios: [...base.gearRatios] };

  if (preset === "grip") {
    tuning.frontGrip *= 1.05;
    tuning.rearGrip *= 1.08;
    tuning.throttleGripLoss *= 0.75;
    tuning.counterSteerAssist *= 0.85;
    tuning.slideDrag *= 1.08;
  }

  if (preset === "drift") {
    tuning.rearGrip *= 0.92;
    tuning.handbrakeRearGrip *= 0.9;
    tuning.throttleGripLoss *= 1.16;
    tuning.counterSteerAssist *= 1.08;
    tuning.slideDrag *= 0.95;
  }

  return tuning;
}
