import type { Vec2 } from "../game/types";

export type OnlineHudPlayer = {
  id: string;
  name: string;
  color: number;
  position: Vec2;
  speedMph: number;
  local?: boolean;
  distance?: number;
  screen?: {
    x: number;
    y: number;
    visible: boolean;
    scale: number;
  };
};

export type OnlineHudState = {
  players: OnlineHudPlayer[];
  localPosition: Vec2;
  portalLabel: string | null;
};

const colorHex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

function setText(parent: HTMLElement, selector: string, text: string) {
  const element = parent.querySelector(selector);
  if (element) element.textContent = text;
}

export function createOnlineHud() {
  const root = document.createElement("div");
  root.className = "online-hud";
  root.hidden = true;
  root.innerHTML = `
    <aside class="online-panel">
      <div class="online-panel__header">
        <span>Online Cruise</span>
        <strong data-online-count>1/32</strong>
      </div>
      <div class="online-panel__sync">
        <i></i>
        <span>Ghost sync alpha</span>
      </div>
      <div class="online-map" data-online-map></div>
      <div class="online-roster" data-online-roster></div>
    </aside>
    <div class="online-prompt" data-online-prompt hidden></div>
    <div class="online-nameplates" data-online-nameplates></div>
  `;
  document.body.append(root);

  const map = root.querySelector("[data-online-map]") as HTMLElement;
  const roster = root.querySelector("[data-online-roster]") as HTMLElement;
  const prompt = root.querySelector("[data-online-prompt]") as HTMLElement;
  const nameplates = root.querySelector("[data-online-nameplates]") as HTMLElement;
  const nameplateById = new Map<string, HTMLElement>();

  function updateNameplates(players: OnlineHudPlayer[]) {
    const liveIds = new Set<string>();
    for (const player of players) {
      if (player.local || !player.screen || !player.screen.visible) continue;
      if ((player.distance ?? 999) > 180) continue;

      liveIds.add(player.id);
      let plate = nameplateById.get(player.id);
      if (!plate) {
        plate = document.createElement("div");
        plate.className = "online-nameplate";
        nameplateById.set(player.id, plate);
        nameplates.append(plate);
      }
      plate.style.setProperty("--player-color", colorHex(player.color));
      plate.style.transform = `translate3d(${player.screen.x}px, ${player.screen.y}px, 0) translate(-50%, -110%) scale(${player.screen.scale})`;
      plate.textContent = `${player.name}  ${Math.round(player.speedMph)} mph`;
      plate.hidden = false;
    }

    for (const [id, plate] of nameplateById) {
      if (!liveIds.has(id)) plate.hidden = true;
    }
  }

  function updateMap(players: OnlineHudPlayer[], localPosition: Vec2) {
    map.textContent = "";
    const route = document.createElement("span");
    route.className = "online-map__route";
    map.append(route);

    const worldExtent = 430;
    for (const player of players) {
      const dot = document.createElement("span");
      dot.className = player.local ? "online-map__dot is-local" : "online-map__dot";
      dot.style.setProperty("--player-color", colorHex(player.color));
      const x = 50 + ((player.position.x - localPosition.x) / worldExtent) * 50;
      const y = 50 + ((player.position.z - localPosition.z) / worldExtent) * 50;
      dot.style.left = `${Math.max(5, Math.min(95, x))}%`;
      dot.style.top = `${Math.max(5, Math.min(95, y))}%`;
      map.append(dot);
    }
  }

  function updateRoster(players: OnlineHudPlayer[]) {
    roster.textContent = "";
    const ordered = [...players].sort((a, b) => {
      if (a.local) return -1;
      if (b.local) return 1;
      return (a.distance ?? 999) - (b.distance ?? 999);
    });

    for (const player of ordered.slice(0, 6)) {
      const row = document.createElement("div");
      row.className = player.local ? "online-roster__row is-local" : "online-roster__row";
      row.style.setProperty("--player-color", colorHex(player.color));

      const name = document.createElement("span");
      name.textContent = player.local ? `${player.name} (you)` : player.name;
      const meta = document.createElement("strong");
      meta.textContent = player.local ? "local" : `${Math.max(1, Math.round(player.distance ?? 0))}m`;

      row.append(name, meta);
      roster.append(row);
    }
  }

  return {
    root,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    update(state: OnlineHudState) {
      root.hidden = false;
      setText(root, "[data-online-count]", `${state.players.length}/32`);
      prompt.hidden = !state.portalLabel;
      prompt.textContent = state.portalLabel ? `Press Enter to load ${state.portalLabel}` : "";
      updateMap(state.players, state.localPosition);
      updateRoster(state.players);
      updateNameplates(state.players);
    },
  };
}
