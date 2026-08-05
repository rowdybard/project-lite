// Top-level Play/Options menu shown over the practice-world pole-barn garage.
// Play launches the active mode through the loading transition; Options reveals
// the customization/profile garage panel.

type MainMenuCallbacks = {
  onPlay: () => void;
  onOptions: () => void;
};

export function createMainMenu(callbacks: MainMenuCallbacks) {
  const root = document.createElement("div");
  root.className = "main-menu";
  root.innerHTML = `
    <section class="main-menu__card">
      <p class="main-menu__eyebrow">Project Lite</p>
      <h1 class="main-menu__title">Drift Attack</h1>
      <p class="main-menu__blurb">Build, tune, drive out. Practice Grounds and Drift Attack are ready.</p>
      <div class="main-menu__actions">
        <button class="main-menu__play" type="button" data-play>Play</button>
        <button class="main-menu__options" type="button" data-options>Options</button>
      </div>
    </section>
  `;
  document.body.append(root);

  const playButton = root.querySelector<HTMLButtonElement>("[data-play]")!;
  const optionsButton = root.querySelector<HTMLButtonElement>("[data-options]")!;

  const handlePlay = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    callbacks.onPlay();
  };

  playButton.addEventListener("pointerdown", handlePlay);
  playButton.addEventListener("click", handlePlay);
  optionsButton.addEventListener("click", () => callbacks.onOptions());

  return {
    root,
    show() {
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
    setPlayEnabled(enabled: boolean) {
      playButton.disabled = !enabled;
      optionsButton.disabled = !enabled;
    },
  };
}
