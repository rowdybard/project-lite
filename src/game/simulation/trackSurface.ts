import type { TrackConfig, Vec2 } from "../types";
import { getRoadHalfWidth } from "./trackLayout";

const distanceToSegment = (point: Vec2, a: Vec2, b: Vec2) => {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apz = point.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apz * abz) / lengthSq));
  const closestX = a.x + abx * t;
  const closestZ = a.z + abz * t;
  return Math.hypot(point.x - closestX, point.z - closestZ);
};

export function isOnTrack(point: Vec2, track: TrackConfig) {
  return getTrackDistance(point, track) <= getRoadHalfWidth(track) + 2.5;
}

export function isInRunoff(point: Vec2, track: TrackConfig) {
  const distance = getTrackDistance(point, track);
  const roadEdge = getRoadHalfWidth(track) + 2.5;
  return distance > roadEdge && distance <= roadEdge + 3.5;
}

export function getTrackDistance(point: Vec2, track: TrackConfig) {
  if (!track.roadPath || track.roadPath.length < 2) {
    const radius = Math.hypot(point.x, point.z);
    return Math.abs(radius - track.roadWidth);
  }

  let nearest = Infinity;
  for (let i = 0; i < track.roadPath.length; i++) {
    const current = track.roadPath[i];
    const next = track.roadPath[(i + 1) % track.roadPath.length];
    nearest = Math.min(nearest, distanceToSegment(point, current, next));
  }

  return nearest;
}

export function getDriftZone(point: Vec2, track: TrackConfig) {
  if (!track.roadPath || track.roadPath.length < 2) return -1;

  let bestIndex = -1;
  let nearest = Infinity;

  for (let i = 0; i < track.roadPath.length; i++) {
    const corner = track.roadPath[i];
    const distance = Math.hypot(point.x - corner.x, point.z - corner.z);
    if (distance < nearest) {
      nearest = distance;
      bestIndex = i;
    }
  }

  return nearest <= 18 ? bestIndex : -1;
}
