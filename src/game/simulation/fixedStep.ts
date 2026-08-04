export type FixedStepStats = {
  steps: number;
  alpha: number;
  droppedSeconds: number;
};

export function createFixedStepRunner(stepSeconds = 1 / 120, maxCatchUpSeconds = 0.1) {
  let accumulator = 0;

  return {
    reset() {
      accumulator = 0;
    },
    advance(frameSeconds: number, step: (dt: number) => void): FixedStepStats {
      const safeFrame = Math.max(0, frameSeconds);
      const acceptedFrame = Math.min(safeFrame, maxCatchUpSeconds);
      const droppedSeconds = Math.max(0, safeFrame - acceptedFrame);
      accumulator = Math.min(accumulator + acceptedFrame, maxCatchUpSeconds);

      let steps = 0;
      const maxSteps = Math.ceil(maxCatchUpSeconds / stepSeconds);
      while (accumulator + 1e-9 >= stepSeconds && steps < maxSteps) {
        step(stepSeconds);
        accumulator -= stepSeconds;
        steps += 1;
      }

      return {
        steps,
        alpha: Math.max(0, Math.min(1, accumulator / stepSeconds)),
        droppedSeconds,
      };
    },
  };
}
