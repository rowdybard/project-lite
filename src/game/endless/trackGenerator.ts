const UINT32_RANGE = 0x1_0000_0000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export const endlessTrackGeneratorDefaults = {
  minSegmentLength: 34,
  maxSegmentLength: 48,
  startRoadWidth: 22,
  minimumRoadWidth: 16,
  minimumGateInterval: 200,
  maximumGateInterval: 280,
  difficultyDistance: 6_000,
  initialCurvature: 0.0052,
  maximumCurvature: 0.0135,
} as const;

export type TrackGeneratorOptions = {
  minSegmentLength?: number;
  maxSegmentLength?: number;
  startRoadWidth?: number;
  minimumRoadWidth?: number;
  minimumGateInterval?: number;
  maximumGateInterval?: number;
  difficultyDistance?: number;
  initialCurvature?: number;
  maximumCurvature?: number;
};

export type TrackPoint = {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** Tangent direction in radians. Zero points down world +Z. */
  readonly heading: number;
  /** Signed radians of heading change per meter. */
  readonly curvature: number;
  readonly distance: number;
  readonly segmentLength: number;
  readonly roadWidth: number;
  readonly difficulty: number;
  /** Distance from this point to the next scheduled checkpoint gate. */
  readonly gateInterval: number;
  /** Exact cumulative distance of a gate crossed by the preceding segment. */
  readonly gateDistance: number | null;
  readonly gateIndex: number | null;
};

export type TrackGenerator = {
  readonly seed: number;
  next(): TrackPoint;
  current(): TrackPoint;
  distance(): number;
};

export function normalizeTrackSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

/** Mulberry32 is compact, deterministic across JS runtimes, and adequate for authored variation. */
export function createSeededRandom(seed: number): () => number {
  let state = normalizeTrackSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function createTrackGenerator(seed: number, options: TrackGeneratorOptions = {}): TrackGenerator {
  const normalizedSeed = normalizeTrackSeed(seed);
  const random = createSeededRandom(normalizedSeed);
  const config = {
    minSegmentLength: Math.max(8, options.minSegmentLength ?? endlessTrackGeneratorDefaults.minSegmentLength),
    maxSegmentLength: Math.max(8, options.maxSegmentLength ?? endlessTrackGeneratorDefaults.maxSegmentLength),
    startRoadWidth: Math.max(8, options.startRoadWidth ?? endlessTrackGeneratorDefaults.startRoadWidth),
    minimumRoadWidth: Math.max(8, options.minimumRoadWidth ?? endlessTrackGeneratorDefaults.minimumRoadWidth),
    minimumGateInterval: Math.max(40, options.minimumGateInterval ?? endlessTrackGeneratorDefaults.minimumGateInterval),
    maximumGateInterval: Math.max(40, options.maximumGateInterval ?? endlessTrackGeneratorDefaults.maximumGateInterval),
    difficultyDistance: Math.max(100, options.difficultyDistance ?? endlessTrackGeneratorDefaults.difficultyDistance),
    initialCurvature: Math.max(0, options.initialCurvature ?? endlessTrackGeneratorDefaults.initialCurvature),
    maximumCurvature: Math.max(0, options.maximumCurvature ?? endlessTrackGeneratorDefaults.maximumCurvature),
  };
  if (config.maxSegmentLength < config.minSegmentLength) {
    [config.minSegmentLength, config.maxSegmentLength] = [config.maxSegmentLength, config.minSegmentLength];
  }
  if (config.maximumGateInterval < config.minimumGateInterval) {
    [config.minimumGateInterval, config.maximumGateInterval] = [
      config.maximumGateInterval,
      config.minimumGateInterval,
    ];
  }
  if (config.startRoadWidth < config.minimumRoadWidth) {
    [config.startRoadWidth, config.minimumRoadWidth] = [config.minimumRoadWidth, config.startRoadWidth];
  }
  if (config.maximumCurvature < config.initialCurvature) {
    [config.initialCurvature, config.maximumCurvature] = [config.maximumCurvature, config.initialCurvature];
  }

  const randomBetween = (min: number, max: number) => lerp(min, max, random());
  let nextGateAt = randomBetween(config.minimumGateInterval, config.maximumGateInterval);
  let nextGateIndex = 0;
  let targetCurvature = 0;
  let targetSegmentsRemaining = 3;
  let previousTargetSign = random() < 0.5 ? -1 : 1;
  let currentPoint: TrackPoint = {
    index: 0,
    x: 0,
    z: 0,
    heading: 0,
    curvature: 0,
    distance: 0,
    segmentLength: 0,
    roadWidth: config.startRoadWidth,
    difficulty: 0,
    gateInterval: nextGateAt,
    gateDistance: null,
    gateIndex: null,
  };

  const chooseCurvatureTarget = (difficulty: number, heading: number) => {
    const maximum = lerp(config.initialCurvature, config.maximumCurvature, difficulty);
    const corridorHeading = wrapAngle(heading);

    // Keep the ribbon broadly advancing down +Z. This preserves an infinite-road
    // silhouette and greatly reduces accidental self-intersections.
    if (Math.abs(corridorHeading) > 1.05) {
      previousTargetSign = corridorHeading > 0 ? -1 : 1;
      targetCurvature = previousTargetSign * maximum * randomBetween(0.55, 0.92);
      targetSegmentsRemaining = 4 + Math.floor(random() * 4);
      return;
    }

    if (random() < lerp(0.25, 0.14, difficulty)) {
      targetCurvature = randomBetween(-0.08, 0.08) * maximum;
      targetSegmentsRemaining = 2 + Math.floor(random() * 4);
      return;
    }

    const switchDirection = random() < 0.64;
    const sign = switchDirection ? -previousTargetSign : previousTargetSign;
    previousTargetSign = sign;
    const magnitude = lerp(0.22, 1, Math.pow(random(), 0.72));
    targetCurvature = sign * maximum * magnitude;
    targetSegmentsRemaining = 3 + Math.floor(random() * 6);
  };

  const next = (): TrackPoint => {
    const segmentLength = randomBetween(config.minSegmentLength, config.maxSegmentLength);
    const nextDistance = currentPoint.distance + segmentLength;
    const difficulty = clamp(nextDistance / config.difficultyDistance, 0, 1);

    targetSegmentsRemaining -= 1;
    if (targetSegmentsRemaining <= 0) chooseCurvatureTarget(difficulty, currentPoint.heading);

    // The opening is deliberately straight enough to launch cleanly before the
    // procedural rhythm begins. Thereafter curvature eases as a random walk.
    const openingBlend = clamp((currentPoint.index - 1) / 4, 0, 1);
    const curvatureResponse = lerp(0.2, 0.34, difficulty);
    let curvature = lerp(currentPoint.curvature, targetCurvature, curvatureResponse) * openingBlend;
    const maximumHeadingDelta = lerp(0.34, 0.5, difficulty);
    curvature = clamp(curvature, -maximumHeadingDelta / segmentLength, maximumHeadingDelta / segmentLength);

    const headingDelta = curvature * segmentLength;
    const nextHeading = currentPoint.heading + headingDelta;
    let nextX: number;
    let nextZ: number;
    if (Math.abs(curvature) < 1e-7) {
      nextX = currentPoint.x + Math.sin(currentPoint.heading) * segmentLength;
      nextZ = currentPoint.z + Math.cos(currentPoint.heading) * segmentLength;
    } else {
      nextX = currentPoint.x + (Math.cos(currentPoint.heading) - Math.cos(nextHeading)) / curvature;
      nextZ = currentPoint.z + (Math.sin(nextHeading) - Math.sin(currentPoint.heading)) / curvature;
    }

    let gateDistance: number | null = null;
    let gateIndex: number | null = null;
    if (nextDistance + 1e-6 >= nextGateAt) {
      gateDistance = nextGateAt;
      gateIndex = nextGateIndex;
      nextGateIndex += 1;
      const spacingDifficulty = clamp(gateDistance / config.difficultyDistance, 0, 1);
      // Later gates trend a little closer, increasing pace without touching car physics.
      const intervalMax = lerp(config.maximumGateInterval, config.maximumGateInterval - 24, spacingDifficulty);
      nextGateAt = gateDistance + randomBetween(config.minimumGateInterval, Math.max(config.minimumGateInterval, intervalMax));
    }

    currentPoint = {
      index: currentPoint.index + 1,
      x: nextX,
      z: nextZ,
      heading: nextHeading,
      curvature,
      distance: nextDistance,
      segmentLength,
      roadWidth: lerp(config.startRoadWidth, config.minimumRoadWidth, difficulty),
      difficulty,
      gateInterval: Math.max(0, nextGateAt - nextDistance),
      gateDistance,
      gateIndex,
    };
    return currentPoint;
  };

  return {
    seed: normalizedSeed,
    next,
    current: () => currentPoint,
    distance: () => currentPoint.distance,
  };
}
