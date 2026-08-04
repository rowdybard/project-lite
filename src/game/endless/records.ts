export type EndlessRunSummary = {
  score: number;
  bestCombo: number;
  stage: number;
  distance: number;
  gatesPassed: number;
  duration: number;
  objectivesCompleted: number;
  failReason: "crash" | "clock" | "quit";
  seed: number;
  board: "daily" | "all-time";
  createdAt: number;
};

export type EndlessRecords = {
  bestScore: number;
  bestCombo: number;
  highestStage: number;
  longestSurvival: number;
  farthestDistance: number;
  objectivesCompleted: number;
  runsStarted: number;
  runsFinished: number;
  personalTarget: string;
  recentRuns: EndlessRunSummary[];
};

const storageKey = "projectLite.endless.records.v1";

const emptyRecords = (): EndlessRecords => ({
  bestScore: 0,
  bestCombo: 0,
  highestStage: 0,
  longestSurvival: 0,
  farthestDistance: 0,
  objectivesCompleted: 0,
  runsStarted: 0,
  runsFinished: 0,
  personalTarget: "Reach stage 2",
  recentRuns: [],
});

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function loadEndlessRecords(): EndlessRecords {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return emptyRecords();
  try {
    const data = JSON.parse(raw) as Partial<EndlessRecords>;
    return {
      bestScore: finite(data.bestScore),
      bestCombo: finite(data.bestCombo),
      highestStage: finite(data.highestStage),
      longestSurvival: finite(data.longestSurvival),
      farthestDistance: finite(data.farthestDistance),
      objectivesCompleted: finite(data.objectivesCompleted),
      runsStarted: finite(data.runsStarted),
      runsFinished: finite(data.runsFinished),
      personalTarget: typeof data.personalTarget === "string" ? data.personalTarget.slice(0, 120) : "Reach stage 2",
      recentRuns: Array.isArray(data.recentRuns) ? data.recentRuns.slice(0, 8) : [],
    };
  } catch {
    return emptyRecords();
  }
}

function save(records: EndlessRecords) {
  window.localStorage.setItem(storageKey, JSON.stringify(records));
}

export function recordEndlessRunStart(records: EndlessRecords) {
  records.runsStarted += 1;
  save(records);
}

function chooseNextTarget(summary: EndlessRunSummary, records: EndlessRecords) {
  if (summary.stage < Math.max(2, records.highestStage)) return `Reach stage ${Math.max(summary.stage + 1, records.highestStage)}`;
  if (summary.objectivesCompleted === 0) return "Complete the active objective";
  if (summary.distance < records.farthestDistance * 0.95) return `Reach ${Math.ceil(records.farthestDistance / 100) * 100} m`;
  if (summary.bestCombo < records.bestCombo * 0.95) return `Build a ${Math.ceil(records.bestCombo / 1000) * 1000}-point combo`;
  return `Score ${Math.max(1000, Math.ceil(records.bestScore * 1.05 / 1000) * 1000).toLocaleString("en-US")}`;
}

export function commitEndlessRun(records: EndlessRecords, summary: EndlessRunSummary) {
  const previousBest = records.bestScore;
  const isPersonalBest = summary.score > previousBest;
  records.bestScore = Math.max(records.bestScore, summary.score);
  records.bestCombo = Math.max(records.bestCombo, summary.bestCombo);
  records.highestStage = Math.max(records.highestStage, summary.stage);
  records.longestSurvival = Math.max(records.longestSurvival, summary.duration);
  records.farthestDistance = Math.max(records.farthestDistance, summary.distance);
  records.objectivesCompleted += summary.objectivesCompleted;
  records.runsFinished += 1;
  records.recentRuns = [summary, ...records.recentRuns].slice(0, 8);
  records.personalTarget = chooseNextTarget(summary, records);
  save(records);
  return { isPersonalBest, previousBest, bestScore: records.bestScore, nextTarget: records.personalTarget };
}
