import { makeGuestName } from "./protocol";

export type PlayerProfile = {
  name: string;
};

const profileKey = "projectLite.profile.v1";

export function loadPlayerProfile(): PlayerProfile {
  const raw = window.localStorage.getItem(profileKey);
  if (!raw) return { name: "Driver" };
  try {
    const profile = JSON.parse(raw) as Partial<PlayerProfile>;
    return { name: makeGuestName(profile.name ?? "Driver") };
  } catch {
    return { name: "Driver" };
  }
}

export function savePlayerProfile(profile: PlayerProfile) {
  window.localStorage.setItem(profileKey, JSON.stringify({ name: makeGuestName(profile.name) }));
}

