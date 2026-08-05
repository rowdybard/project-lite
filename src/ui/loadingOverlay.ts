// Blocking loading transition shown when the player clicks Play. Covers the
// canvas while asynchronous track/tuning loads run, disables duplicate
// launches, and is removed once the event is ready (or an error is shown).

export function createLoadingOverlay() {
  const root = document.createElement("div");
  root.className = "loading-overlay";
  root.hidden = true;
  root.innerHTML = `
    <div class="loading-overlay__card">
      <div class="loading-overlay__mark">Drift Attack</div>
      <p data-status>Loading</p>
      <span></span>
    </div>
  `;
  document.body.append(root);

  const status = root.querySelector<HTMLElement>("[data-status]")!;

  return {
    root,
    show(label = "Loading") {
      status.textContent = label;
      root.hidden = false;
    },
    setStatus(label: string) {
      status.textContent = label;
    },
    hide() {
      root.hidden = true;
    },
  };
}
