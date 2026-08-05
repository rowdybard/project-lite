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
      <div class="loading-overlay__error-actions" data-error-actions hidden>
        <button type="button" data-retry>Retry</button>
        <button type="button" data-back>Back</button>
      </div>
    </div>
  `;
  document.body.append(root);

  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const errorActions = root.querySelector<HTMLElement>("[data-error-actions]")!;
  const spinner = root.querySelector<HTMLElement>("span")!;
  let retryFn: (() => void) | null = null;
  let backFn: (() => void) | null = null;

  root.querySelector<HTMLButtonElement>("[data-retry]")!.addEventListener("click", () => {
    if (retryFn) retryFn();
  });
  root.querySelector<HTMLButtonElement>("[data-back]")!.addEventListener("click", () => {
    if (backFn) backFn();
  });

  return {
    root,
    show(label = "Loading") {
      status.textContent = label;
      errorActions.hidden = true;
      spinner.hidden = false;
      root.hidden = false;
    },
    setStatus(label: string) {
      status.textContent = label;
    },
    showError(message: string, onRetry: () => void, onBack: () => void) {
      status.textContent = message;
      spinner.hidden = true;
      errorActions.hidden = false;
      retryFn = onRetry;
      backFn = onBack;
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
      errorActions.hidden = true;
      spinner.hidden = false;
      retryFn = null;
      backFn = null;
    },
    dispose() {
      retryFn = null;
      backFn = null;
      root.remove();
    },
  };
}
