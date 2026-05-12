import type { TrackConfig } from "../types";

export type AssetManifest = {
  activeCar: string;
  activeTrack: string;
  cars: Record<string, { name: string; model?: string; tuning: string; scale?: number }>;
  tracks: Record<string, TrackConfig>;
};

export async function loadManifest(): Promise<AssetManifest> {
  const response = await fetch("/assets/manifest.json");
  if (!response.ok) {
    throw new Error(`Could not load asset manifest: ${response.status}`);
  }

  return response.json() as Promise<AssetManifest>;
}

export async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
