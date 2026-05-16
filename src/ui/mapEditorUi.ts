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
  onUndo: () => void;
  onRotateReset: () => void;
};

export type MapEditorUi = ReturnType<typeof createMapEditorUi>;

export function createMapEditorUi(callbacks: MapEditorUiCallbacks) {
  const root = document.createElement("aside");
  root.className = "map-editor";
  root.hidden = true;
  root.innerHTML = `
    <div class="map-editor__header">
      <span class="map-editor__dev-label">Dev Tool</span>
      <div class="map-editor__title-row">
        <h2>Map Editor</h2>
        <mark class="map-editor__unsaved" data-unsaved hidden>Unsaved</mark>
      </div>
      <div class="map-editor__track" data-track></div>
    </div>
    <div class="map-editor__section">
      <div class="map-editor__tools">
        <button type="button" data-tool="road">Paint Road</button>
        <button type="button" data-tool="grass">Erase Road</button>
        <button type="button" data-tool="asset">Place Asset</button>
        <button type="button" data-undo>Undo &nbsp;Ctrl+Z</button>
      </div>
    </div>
    <div class="map-editor__section">
      <div class="map-editor__asset-cats" data-asset-cats></div>
      <div class="map-editor__asset-grid" data-assets></div>
    </div>
    <div class="map-editor__section">
      <div class="map-editor__asset-edit" data-asset-edit hidden>
        <button type="button" data-rotate-reset>Reset Rotation</button>
      </div>
      <label class="map-editor__brush">
        <span>Brush / Scale</span>
        <input data-brush type="range" min="3" max="26" step="1" value="10" />
        <strong data-brush-value>10m</strong>
      </label>
    </div>
    <div class="map-editor__actions">
      <button type="button" data-save>Save &nbsp;Ctrl+S</button>
      <button type="button" data-export>Export</button>
      <button type="button" data-clear>Clear All</button>
    </div>
    <footer class="map-editor__footer">
      <p data-status></p>
      <div class="map-editor__stamp-count" data-stamp-count hidden></div>
    </footer>
  `;
  document.body.append(root);

  let activeTool: MapEditTool = "grass";
  let activeCategory: MapEditAssetCategory = "track";
  let activeAsset: MapEditAssetId = "asphalt-pad";
  let brushRadius = 10;
  const toolButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-tool]")];
  const assetCats = root.querySelector<HTMLElement>("[data-asset-cats]")!;
  const assetGrid = root.querySelector<HTMLElement>("[data-assets]")!;
  const assetEdit = root.querySelector<HTMLElement>("[data-asset-edit]")!;
  const brush = root.querySelector<HTMLInputElement>("[data-brush]")!;
  const brushValue = root.querySelector<HTMLElement>("[data-brush-value]")!;
  const trackLabel = root.querySelector<HTMLElement>("[data-track]")!;
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const unsavedBadge = root.querySelector<HTMLElement>("[data-unsaved]")!;
  const stampCount = root.querySelector<HTMLElement>("[data-stamp-count]")!;

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
    assetEdit.hidden = activeTool !== "asset";
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
  root.querySelector("[data-clear]")!.addEventListener("click", () => {
    if (confirm("Clear all map edits for this track? This cannot be undone.")) callbacks.onClear();
  });
  root.querySelector("[data-undo]")!.addEventListener("click", callbacks.onUndo);
  root.querySelector("[data-rotate-reset]")!.addEventListener("click", callbacks.onRotateReset);

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
    setDirty(dirty: boolean, count: number) {
      unsavedBadge.hidden = !dirty;
      stampCount.hidden = count === 0;
      stampCount.textContent = `${count} stamp${count === 1 ? "" : "s"}`;
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
