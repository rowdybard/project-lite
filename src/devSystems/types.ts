import type { Camera, Scene, WebGLRenderer } from "three";

import type { CarState, CarTuning, DriftState, InputState, TrackConfig } from "../game/types";
import type { HandlingProfileId } from "../game/simulation/handlingStability";
import type { CarCustomization, DevModeId, ModeId } from "../game/customization";
import type { PlayerProfile } from "../net/profile";

// The HUD, results overlay, tire effects, car view, and physics runner are
// public systems that dev modes reuse. We expose them through lightweight
// structural types so the dev chunk can interact with them without leaking
// dev-only types into public main.ts.

export type HudLike = {
  root: HTMLElement;
  update(car: CarState, drift: DriftState): void;
  updateTimer(secondsRemaining: number): void;
  setCarName(name: string): void;
  setMode(nextMode: "online-lobby" | "drift-attack" | "endless" | "free-drive"): void;
  setOnlineStatus(status: string | null): void;
  setEndlessStats(stats: Record<string, unknown>): void;
  setPracticeZone(label: string): void;
};

export type ResultsOverlayLike = {
  show(finalScore: number, bestCombo: number, bestRun: number): void;
  hide(): void;
};

export type TireEffectsLike = {
  reset(): void;
  update(car: CarState, onTrack: boolean, dt: number): void;
  root: { visible: boolean };
};

export type CarViewLike = {
  root: { visible: boolean };
  sync(car: CarState): void;
  applyCustomization(c: CarCustomization): void;
  whenReady(): Promise<{ ok: boolean; carId: string; error?: Error }>;
};

export type FixedStepRunnerLike = {
  reset(): void;
  advance(dt: number, step: (stepDt: number) => void): { steps: number; droppedSeconds: number };
};

export type CollisionWorldLike = {
  cameraObstructions: readonly unknown[];
};

export type DevFrameResult = {
  handled: boolean;
  rendered: boolean;
};

export type DevStartResult =
  | { handled: false }
  | { handled: true; started: true }
  | { handled: true; started: false; error: Error };

export type DevSystemsHost = {
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
  car: CarState;
  canvas: HTMLCanvasElement;

  get customization(): CarCustomization;
  get activeTuning(): CarTuning;
  get activeTrack(): TrackConfig;
  get drift(): DriftState;
  get playerProfile(): PlayerProfile;
  get hud(): HudLike;
  get results(): ResultsOverlayLike;
  get tireEffects(): TireEffectsLike;
  get carView(): CarViewLike;
  get fixedStepRunner(): FixedStepRunnerLike;
  get collisionWorld(): CollisionWorldLike;
  get handlingProfile(): HandlingProfileId;
  get playerRouteProbeEnabled(): boolean;
  get playerRouteProbeElapsed(): number;

  switchTrack(track: TrackConfig): Promise<void>;
  reloadActiveTrack(): Promise<void>;
  loadCarTuning(carId: string): Promise<CarTuning>;
  renderGameScene(dt: number): void;
  showMainMenu(): void;
  showGarage(): void;
  showOptionsMenu(): void;

  resetPublicInput(): void;
  setPublicCarVisible(visible: boolean): void;
  setGarageActive(active: boolean): void;
  reportError(title: string, error: unknown): void;

  saveCustomization(c: CarCustomization): void;
  updateGarageUi(): void;

  // Shared helpers that dev modes need
  updateChaseCamera(dt: number, shake: number, useCameraObstructions: boolean): void;
  resetChaseCamera(): void;
  applyFocusLighting(): void;
  updateEngineSound(): void;
  resumeEngineSound(): void;
  suspendEngineSound(): void;
  updateCornerMarkerFlex(dt: number): void;
  updateWindUniforms(dt: number): void;
  syncConeMeshes(dt: number): void;
  getCameraOrbit(): number;
  getNearbyGarage(): boolean;

  // Session state
  setSessionTime(time: number): void;
  getSessionTime(): number;
  setCameraShake(shake: number): void;
  getCameraShakeValue(): number;
  setLastFixedStats(steps: number, droppedSeconds: number): void;

  // Drift helpers
  resetDrift(): void;
  finishDriftRun(): number;
  updateDriftScore(dt: number, scoringSurface: boolean, driftZone: number, impact: number): void;
  setDriftCallout(text: string, timer: number): void;

  // Route probe
  addPlayerRouteProbeTime(dt: number): void;
  recordPlayerRouteProbeShift(from: number, to: number): void;
  setPlayerRouteProbeScore(score: number): void;
  resetPlayerRouteProbe(): void;
};

export type DevSystems = {
  readonly enabled: boolean;

  handlesMode(mode: ModeId): mode is DevModeId;

  startMode(mode: DevModeId): Promise<DevStartResult>;

  resetActiveMode(): boolean;

  update(dt: number, input: InputState): DevFrameResult;

  startReplay(payload: unknown): Promise<boolean>;
  exitReplay(): boolean;

  openLeaderboard(): boolean;
  closeLeaderboard(): boolean;

  onTrackCommitted(track: TrackConfig): void;

  suspend(): void;
  resume(): void;

  dispose(): void;
};
