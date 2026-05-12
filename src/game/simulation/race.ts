import type { CarState, RaceState, TrackConfig } from "../types";

export function createRaceState(now = performance.now()): RaceState {
  return {
    currentCheckpoint: 1,
    lap: 1,
    lapStartedAt: now,
    lastLapMs: 0,
    bestLapMs: 0,
    wrongWay: false,
  };
}

export function updateRace(car: CarState, race: RaceState, track: TrackConfig, now = performance.now()) {
  const checkpoint = track.checkpoints[race.currentCheckpoint];
  const dx = checkpoint.x - car.position.x;
  const dz = checkpoint.z - car.position.z;
  const distance = Math.hypot(dx, dz);

  race.wrongWay = distance > 60 && car.speed > 8 && dx * car.velocity.x + dz * car.velocity.z < -8;

  if (distance > 10) return;

  race.currentCheckpoint = (race.currentCheckpoint + 1) % track.checkpoints.length;

  if (race.currentCheckpoint === 0) {
    race.lastLapMs = now - race.lapStartedAt;
    race.bestLapMs = race.bestLapMs === 0 ? race.lastLapMs : Math.min(race.bestLapMs, race.lastLapMs);
    race.lapStartedAt = now;
    race.lap += 1;
  }
}

export function formatLap(ms: number) {
  if (ms <= 0) return "--:--.---";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}
