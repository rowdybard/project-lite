// Fullscreen toggle button — unobtrusive icon in the corner.
// Uses the standard Fullscreen API with webkit fallback for iOS Safari.
export function createFullscreenToggle() {
  const button = document.createElement("button");
  button.className = "fullscreen-toggle";
  button.type = "button";
  button.setAttribute("aria-label", "Toggle fullscreen");
  button.innerHTML = fullscreenIcon(false);

  const updateIcon = () => {
    const isFs = !!document.fullscreenElement || !!(document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement;
    button.innerHTML = fullscreenIcon(isFs);
  };

  button.addEventListener("click", () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };

    const isFs = !!document.fullscreenElement || !!doc.webkitFullscreenElement;
    if (isFs) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else {
      if (el.requestFullscreen) void el.requestFullscreen();
      else el.webkitRequestFullscreen?.();
    }
  });

  document.addEventListener("fullscreenchange", updateIcon);
  document.addEventListener("webkitfullscreenchange", updateIcon);

  document.body.appendChild(button);

  return {
    dispose() {
      document.removeEventListener("fullscreenchange", updateIcon);
      document.removeEventListener("webkitfullscreenchange", updateIcon);
      button.remove();
    },
  };
}

function fullscreenIcon(isFullscreen: boolean): string {
  if (isFullscreen) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>`;
}
