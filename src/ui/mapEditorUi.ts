import {
  mapEditorAssetCategories,
  mapEditorAssetOptions,
  type MapEditAssetCategory,
  type MapEditAssetId,
  type MapEditTool,
} from "../game/editor/mapEdits";

type MapEditorUiCallbacks = {
  onTool: (tool: MapEditTool) => void;
  onAsset: (asset: MapEditAssetId) => void;
  onBrush: (radius: number) => void;
  onSave: () => void;
  onExport: () => void;
  onClear: () => void;
};

export type MapEditorUi = ReturnType<typeof createMapEditorUi>;

export function createMapEditorUi(callbacks: MapEditorUiCallbacks) {
  const root = document.createElement("aside");
  root.className = "map-editor";
  root.hidden = true;
  root.innerHTML = `
    <div class="map-editor__header">
      <span>Developer Tool</span>
      <h2>Map Editor</h2>
    </div>
    <div class="map-editor__track" data-track>Track</div>
    <div class="map-editor__tools">
      <button type="button" data-tool="road">Paint Road</button>
      <button type="button" data-tool="grass">Remove Road</button>
      <button type="button" data-tool="asset">Place Asset</button>
    </div>
    <div class="map-editor__asset-cats" data-asset-cats></div>
    <div class="map-editor__asset-grid" data-assets></div>
    <label class="map-editor__brush">
      <span>Brush / Scale</span>
      <input data-brush type="range" min="3" max="26" step="1" value="10" />
      <strong data-brush-value>10m</strong>
    </label>
    <div class="map-editor__actions">
      <button type="button" data-save>Save</button>
      <button type="button" data-export>Export</button>
      <button type="button" data-clear>Clear</button>
    </div>
    <p data-status>Right mouse look. WASD fly. Q/E down/up. Left mouse paints.</p>
  `;
  document.body.append(root);

  let activeTool: MapEditTool = "grass";
  let activeCategory: MapEditAssetCategory = "track";
  let activeAsset: MapEditAssetId = "asphalt-pad";
  let brushRadius = 10;
  const toolButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-tool]")];
  const assetCats = root.querySelector<HTMLElement>("[data-asset-cats]")!;
  const assetGrid = root.querySelector<HTMLElement>("[data-assets]")!;
  const brush = root.querySelector<HTMLInputElement>("[data-brush]")!;
  const brushValue = root.querySelector<HTMLElement>("[data-brush-value]")!;
  const trackLabel = root.querySelector<HTMLElement>("[data-track]")!;
  const status = root.querySelector<HTMLElement>("[data-status]")!;

  const render = () => {
    for (const button of toolButtons) {
      button.classList.toggle("is-active", button.dataset.tool === activeTool);
    }
    for (const button of assetCats.querySelectorAll<HTMLButtonElement>("[data-asset-category]")) {
      button.classList.toggle("is-active", button.dataset.assetCategory === activeCategory);
    }
    assetGrid.replaceChildren();
    for (const asset of mapEditorAssetOptions.filter((option) => option.category === activeCategory)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.asset = asset.id;
      button.textContent = asset.label;
      button.title = asset.scaleHint ?? asset.label;
      button.classList.toggle("is-active", asset.id === activeAsset);
      button.addEventListener("click", () => {
        activeAsset = asset.id;
        activeTool = "asset";
        callbacks.onAsset(asset.id);
        render();
      });
      assetGrid.append(button);
    }
    brush.value = String(brushRadius);
    brushValue.textContent = activeTool === "asset" ? `${(brushRadius / 10).toFixed(1)}x` : `${brushRadius}m`;
  };

  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      activeTool = button.dataset.tool as MapEditTool;
      callbacks.onTool(activeTool);
      render();
    });
  }

  for (const category of mapEditorAssetCategories) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.assetCategory = category.id;
    button.textContent = category.label;
    button.addEventListener("click", () => {
      activeCategory = category.id;
      activeAsset = mapEditorAssetOptions.find((asset) => asset.category === category.id)?.id ?? activeAsset;
      activeTool = "asset";
      callbacks.onAsset(activeAsset);
      render();
    });
    assetCats.append(button);
  }

  brush.addEventListener("input", () => {
    brushRadius = Number(brush.value);
    callbacks.onBrush(brushRadius);
    render();
  });

  root.querySelector("[data-save]")!.addEventListener("click", callbacks.onSave);
  root.querySelector("[data-export]")!.addEventListener("click", callbacks.onExport);
  root.querySelector("[data-clear]")!.addEventListener("click", callbacks.onClear);

  render();

  return {
    root,
    show(trackName: string) {
      trackLabel.textContent = trackName;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    setStatus(text: string) {
      status.textContent = text;
    },
    setTool(tool: MapEditTool) {
      activeTool = tool;
      render();
    },
    setAsset(asset: MapEditAssetId) {
      activeAsset = asset;
      activeCategory = mapEditorAssetOptions.find((option) => option.id === asset)?.category ?? activeCategory;
      activeTool = "asset";
      render();
    },
    setBrush(radius: number) {
      brushRadius = radius;
      render();
    },
  };
}
