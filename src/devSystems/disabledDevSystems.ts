import type { DevSystems } from "./types";

const notHandled = { handled: false } as const;

const frameNotHandled = { handled: false, rendered: false } as const;

function handlesNoDevMode(_mode: Parameters<DevSystems["handlesMode"]>[0]): _mode is never {
  return false;
}

export function createDisabledDevSystems(): DevSystems {
  return {
    enabled: false,

    handlesMode: handlesNoDevMode,

    startMode: async () => notHandled,

    resetActiveMode: () => false,

    update: () => frameNotHandled,

    startReplay: async () => false,
    exitReplay: () => false,

    openLeaderboard: () => false,
    closeLeaderboard: () => false,

    onTrackCommitted: () => undefined,

    suspend: () => undefined,
    resume: () => undefined,

    dispose: () => undefined,
  };
}
