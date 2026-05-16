export type MapEditTool = "road" | "grass" | "asset";
export type MapEditAssetCategory = "track" | "safety" | "buildings" | "nature" | "online";
export type MapEditAssetId =
  | "asphalt-pad"
  | "paint-line"
  | "road-wear"
  | "gravel-runoff"
  | "curb-stripe"
  | "cone"
  | "drift-pole"
  | "tire-stack"
  | "guardrail"
  | "jersey-barrier"
  | "light-pole"
  | "sign-board"
  | "direction-chevron"
  | "tree"
  | "shrub"
  | "grass-tuft"
  | "pit-building"
  | "garage-bay"
  | "grandstand"
  | "start-gantry"
  | "portal-gate"
  | "queue-ring"
  | "flatbed-hauler";

export const mapEditorAssetCategories: { id: MapEditAssetCategory; label: string }[] = [
  { id: "track", label: "Track Paint" },
  { id: "safety", label: "Safety" },
  { id: "buildings", label: "Buildings" },
  { id: "nature", label: "Nature" },
  { id: "online", label: "Online" },
];

export const mapEditorAssetOptions: {
  id: MapEditAssetId;
  label: string;
  category: MapEditAssetCategory;
  scaleHint?: string;
}[] = [
  { id: "asphalt-pad", label: "Asphalt Pad", category: "track", scaleHint: "open paved circles" },
  { id: "paint-line", label: "Paint Line", category: "track", scaleHint: "lane markings" },
  { id: "road-wear", label: "Road Wear", category: "track", scaleHint: "rubber/skids" },
  { id: "gravel-runoff", label: "Runoff", category: "track", scaleHint: "gravel patches" },
  { id: "curb-stripe", label: "Curb Stripe", category: "track", scaleHint: "red/white curb" },
  { id: "cone", label: "Cone", category: "safety" },
  { id: "drift-pole", label: "Clip Pole", category: "safety" },
  { id: "tire-stack", label: "Tire Stack", category: "safety" },
  { id: "guardrail", label: "Guardrail", category: "safety" },
  { id: "jersey-barrier", label: "Barrier", category: "safety" },
  { id: "light-pole", label: "Light Pole", category: "safety" },
  { id: "sign-board", label: "Sign", category: "safety" },
  { id: "direction-chevron", label: "Chevron", category: "safety" },
  { id: "pit-building", label: "Pit Building", category: "buildings" },
  { id: "garage-bay", label: "Garage Bay", category: "buildings" },
  { id: "grandstand", label: "Grandstand", category: "buildings" },
  { id: "start-gantry", label: "Start Gantry", category: "buildings" },
  { id: "tree", label: "Tree", category: "nature" },
  { id: "shrub", label: "Shrub", category: "nature" },
  { id: "grass-tuft", label: "Grass Tuft", category: "nature" },
  { id: "portal-gate", label: "Portal Gate", category: "online" },
  { id: "queue-ring", label: "Queue Ring", category: "online" },
  { id: "flatbed-hauler", label: "Flatbed Hauler", category: "online" },
];

export type MapEditStamp = {
  id: string;
  tool: MapEditTool;
  asset?: MapEditAssetId;
  x: number;
  z: number;
  radius: number;
  rotation?: number;
};

function cleanStamps(value: unknown): MapEditStamp[] {
  const parsed = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { edits?: unknown }).edits)
      ? (value as { edits: unknown[] }).edits
      : [];

  return parsed.filter((stamp): stamp is MapEditStamp => {
    return (
      stamp &&
      typeof stamp === "object" &&
      ((stamp as MapEditStamp).tool === "road" ||
        (stamp as MapEditStamp).tool === "grass" ||
        (stamp as MapEditStamp).tool === "asset") &&
      Number.isFinite((stamp as MapEditStamp).x) &&
      Number.isFinite((stamp as MapEditStamp).z) &&
      Number.isFinite((stamp as MapEditStamp).radius) &&
      ((stamp as MapEditStamp).tool !== "asset" ||
        mapEditorAssetOptions.some((option) => option.id === (stamp as MapEditStamp).asset))
    );
  });
}

export async function loadMapEdits(trackId: string): Promise<MapEditStamp[]> {
  const response = await fetch(`/assets/map-edits/${trackId}.json?t=${Date.now()}`, { cache: "no-store" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Could not load map edits: ${response.status}`);
  return cleanStamps(await response.json());
}

export async function saveMapEdits(trackId: string, stamps: MapEditStamp[]) {
  const response = await fetch(`/api/dev/map-edits/${trackId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trackId, edits: cleanStamps(stamps) }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Could not save map edits: ${response.status}`);
  }
}

export async function clearMapEdits(trackId: string) {
  const response = await fetch(`/api/dev/map-edits/${trackId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not clear map edits: ${response.status}`);
}
