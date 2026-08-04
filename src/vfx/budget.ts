// Global perf governor for the particle runtime. Hard caps are enforced regardless of user
// input — player creativity (editor sliders) can never tank the framerate.
const GLOBAL_INSTANCE_BUDGET = 8192;
const PER_SYSTEM_CAP = 2048;
const MAX_SPAWN_RATE = 600;

let granted = 0;
let warned = false;

export function claimParticleBudget(requested: number): number {
  const request = Math.min(Math.max(1, Math.floor(requested)), PER_SYSTEM_CAP);
  const amount = Math.min(request, Math.max(0, GLOBAL_INSTANCE_BUDGET - granted));
  if (amount < request && !warned) {
    console.warn(`vfx budget: clamped to ${amount} instances (global cap ${GLOBAL_INSTANCE_BUDGET})`);
    warned = true;
  }
  granted += amount;
  return amount;
}

export function releaseParticleBudget(amount: number) {
  granted = Math.max(0, granted - amount);
  if (granted === 0) warned = false;
}

export function clampSpawnRate(rate: number): number {
  return Math.min(Math.max(0, rate), MAX_SPAWN_RATE);
}

export const particleBudgetLimits = {
  global: GLOBAL_INSTANCE_BUDGET,
  perSystem: PER_SYSTEM_CAP,
  maxRate: MAX_SPAWN_RATE,
} as const;
