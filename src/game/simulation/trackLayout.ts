import type { TrackConfig, Vec2 } from "../types";

export const getRoadWidth = (track: TrackConfig) => Math.max(8, track.roadWidth);

export const getRoadHalfWidth = (track: TrackConfig) => getRoadWidth(track) / 2;

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export function isTracksideClearZone(point: Vec2, track: TrackConfig) {
  if (!track.roadPath || track.roadPath.length < 4) {
    return false;
  }

  const startClearance = getRoadWidth(track) * 1.85;
  const lastCorner = track.roadPath[track.roadPath.length - 1];
  const cornerClearance = getRoadWidth(track) * 1.15;

  return distance(point, track.start) < startClearance || distance(point, lastCorner) < cornerClearance;
}
