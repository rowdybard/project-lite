import {
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Texture,
} from "three";
import { particleBudgetLimits } from "../vfx/budget";
import { disposeLuts, type ColorStop, type ScalarStop } from "../vfx/particleCurves";
import { createGpuParticleSystem, type GpuParticleSystem } from "../vfx/gpuParticles";
import {
  buildSystemOptions,
  builtinPresets,
  builtinTextureIds,
  createBuiltinTexture,
  deletePreset,
  loadPresetTexture,
  loadSavedPresets,
  presetFromShareString,
  presetToShareString,
  savePreset,
  validatePreset,
  type BuiltinTextureId,
  type VfxPreset,
} from "../vfx/presets";
import { pickPngFile, uploadPng } from "../vfx/textureUpload";

// Player-facing effect editor: PNG upload, live orbitable preview, gradient-stop curve
// editors, JSON preset save/share. Spawn rate and instance counts pass through the global
// budget governor, so nothing here can tank the framerate.

type SliderDef = {
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(value: number): void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const CURVE_TIMES = [0, 1 / 3, 2 / 3, 1];

function defaultPreset(): VfxPreset {
  return JSON.parse(JSON.stringify(builtinPresets[0])) as VfxPreset;
}

export function createVfxEditor(callbacks: { onClose?: () => void; onApplyTireSmoke?: (preset: VfxPreset) => void; onClearTireSmoke?: () => void } = {}) {
  const root = document.createElement("div");
  root.className = "vfx-editor";
  root.hidden = true;
  document.body.append(root);

  let state = defaultPreset();
  let savedPresets = loadSavedPresets();
  let texture: Texture = createBuiltinTexture("soft-circle");
  let textureLabel = "Soft Circle";
  let system: GpuParticleSystem | null = null;
  let systemLuts: Parameters<typeof disposeLuts> = [];
  let rebuildTimer = 0;
  let renderer: WebGLRenderer | null = null;
  let previewScene: Scene | null = null;
  let previewCamera: PerspectiveCamera | null = null;
  let rafId = 0;
  let lastFrame = 0;
  let applyToken = 0;
  let orbitYaw = 0.8;
  let orbitPitch = 0.3;
  let orbitDistance = 9;
  let dragging = false;
  let lastPointer = { x: 0, y: 0 };
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;
  let isOpen = false;

  function ensurePreview() {
    if (renderer) return;
    const canvas = root.querySelector<HTMLCanvasElement>("[data-preview]")!;
    renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    previewScene = new Scene();
    previewScene.background = new Color(0x0b0e12);
    const ground = new Mesh(
      new CircleGeometry(9, 48),
      new MeshBasicMaterial({ color: 0x161c22 }),
    );
    ground.rotation.x = -Math.PI / 2;
    const ring = new Mesh(
      new CircleGeometry(9.6, 48),
      new MeshBasicMaterial({ color: 0x1d242c }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.01;
    previewScene.add(ring, ground);
    previewCamera = new PerspectiveCamera(50, 1, 0.1, 120);

    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      if (!canvas.hasPointerCapture(event.pointerId)) {
        canvas.setPointerCapture(event.pointerId);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      orbitYaw += (event.clientX - lastPointer.x) * 0.008;
      orbitPitch = clamp(orbitPitch + (event.clientY - lastPointer.y) * 0.005, -0.1, 1.35);
      lastPointer = { x: event.clientX, y: event.clientY };
    });
    const releaseDrag = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", releaseDrag);
    canvas.addEventListener("pointercancel", releaseDrag);
    canvas.addEventListener("lostpointercapture", () => { dragging = false; });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        orbitDistance = clamp(orbitDistance + event.deltaY * 0.01, 3, 30);
      },
      { passive: false },
    );

    const fitPreview = () => {
      if (!renderer || !previewCamera) return;
      const box = canvas.parentElement!.getBoundingClientRect();
      const width = Math.max(120, Math.floor(box.width));
      const height = Math.max(120, Math.floor(box.height));
      renderer.setSize(width, height, false);
      previewCamera.aspect = width / height;
      previewCamera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(fitPreview);
    resizeObserver.observe(canvas.parentElement!);
    fitPreview();
  }

  function frame(now: number) {
    if (!isOpen || root.hidden || disposed) {
      rafId = 0;
      return;
    }
    // Pause RAF while document is hidden — resume only when editor is still open
    if (document.hidden) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(frame);
    const dt = clamp((now - lastFrame) / 1000, 0.001, 0.05);
    lastFrame = now;
    system?.update(dt);
    if (previewCamera) {
      const height = 1.2 + Math.sin(orbitPitch) * orbitDistance;
      const flat = Math.cos(orbitPitch) * orbitDistance;
      previewCamera.position.set(Math.sin(orbitYaw) * flat, height, Math.cos(orbitYaw) * flat);
      previewCamera.lookAt(0, 1, 0);
    }
    if (renderer && previewScene && previewCamera) renderer.render(previewScene, previewCamera);
  }

  // Resume VFX RAF when document becomes visible again (only if editor is still open)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isOpen && !disposed && rafId === 0) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  });

  function disposeSystem() {
    if (system) {
      previewScene?.remove(system.root);
      system.dispose();
      system = null;
    }
    disposeLuts(...systemLuts);
    systemLuts = [];
  }

  function rebuildSystem() {
    if (root.hidden || !previewScene) return;
    disposeSystem();
    const built = buildSystemOptions(state, texture);
    system = createGpuParticleSystem(built.options);
    systemLuts = built.luts;
    previewScene.add(system.root);
    const budget = root.querySelector("[data-budget]");
    if (budget) {
      budget.textContent = `${system.capacity} instances (cap ${particleBudgetLimits.perSystem}, global ${particleBudgetLimits.global}) · rate ${state.rate}/s (max ${particleBudgetLimits.maxRate})`;
    }
  }

  function installTexture(nextTexture: Texture, nextLabel: string) {
    const previousTexture = texture;
    texture = nextTexture;
    textureLabel = nextLabel;
    rebuildSystem();
    previousTexture.dispose();
  }

  function scheduleRebuild() {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuildSystem, 140);
  }

  function sliderRow(def: SliderDef) {
    const row = document.createElement("label");
    row.className = "vfx-editor__row";
    row.innerHTML = `<span>${def.label}</span><input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.get()}"><output>${def.get()}</output>`;
    const input = row.querySelector("input")!;
    const output = row.querySelector("output")!;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      def.set(value);
      output.textContent = String(def.get());
      scheduleRebuild();
    });
    return row;
  }

  function pairRows(label: string, key: "life" | "speed" | "startSize" | "rotationSpeed", min: number, max: number, step: number) {
    const wrap = document.createElement("div");
    wrap.append(
      sliderRow({
        label: `${label} min`,
        min,
        max,
        step,
        get: () => state[key][0],
        set: (value) => {
          state[key][0] = Math.min(value, state[key][1]);
        },
      }),
      sliderRow({
        label: `${label} max`,
        min,
        max,
        step,
        get: () => state[key][1],
        set: (value) => {
          state[key][1] = Math.max(value, state[key][0]);
        },
      }),
    );
    return wrap;
  }

  function selectRow(label: string, options: { value: string; label: string }[], get: () => string, set: (value: string) => void) {
    const row = document.createElement("label");
    row.className = "vfx-editor__row";
    row.innerHTML = `<span>${label}</span><select>${options
      .map((option) => `<option value="${option.value}" ${option.value === get() ? "selected" : ""}>${option.label}</option>`)
      .join("")}</select>`;
    row.querySelector("select")!.addEventListener("change", (event) => {
      set((event.target as HTMLSelectElement).value);
      renderControls();
      scheduleRebuild();
    });
    return row;
  }

  function scalarCurveEditor(label: string, key: "sizeOverLife" | "opacityOverLife", maxValue: number) {
    const wrap = document.createElement("div");
    wrap.className = "vfx-editor__curve";
    const title = document.createElement("p");
    title.textContent = label;
    const canvas = document.createElement("canvas");
    canvas.width = 216;
    canvas.height = 64;
    wrap.append(title, canvas);

    const stops = (): ScalarStop[] => CURVE_TIMES.map((t, i) => state[key][i] ?? { t, value: 1 });

    function draw() {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#2b3540";
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      ctx.strokeStyle = "#68d8ff";
      ctx.fillStyle = "#68d8ff";
      ctx.beginPath();
      stops().forEach((stop, i) => {
        const x = stop.t * (canvas.width - 12) + 6;
        const y = canvas.height - 6 - (stop.value / maxValue) * (canvas.height - 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      stops().forEach((stop) => {
        const x = stop.t * (canvas.width - 12) + 6;
        const y = canvas.height - 6 - (stop.value / maxValue) * (canvas.height - 12);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const apply = (clientX: number, clientY: number) => {
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let best = 0;
        let bestDistance = Infinity;
        CURVE_TIMES.forEach((t, i) => {
          const stopX = t * (canvas.width - 12) + 6;
          if (Math.abs(stopX - x) < bestDistance) {
            bestDistance = Math.abs(stopX - x);
            best = i;
          }
        });
        const value = clamp((1 - (y - 6) / (canvas.height - 12)) * maxValue, 0, maxValue);
        const next = stops();
        next[best] = { t: CURVE_TIMES[best], value: Math.round(value * 100) / 100 };
        state[key] = next;
        draw();
      };
      apply(event.clientX, event.clientY);
      const move = (moveEvent: PointerEvent) => apply(moveEvent.clientX, moveEvent.clientY);
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        scheduleRebuild();
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
    });

    queueMicrotask(draw);
    return wrap;
  }

  function colorCurveEditor() {
    const wrap = document.createElement("div");
    wrap.className = "vfx-editor__curve";
    const title = document.createElement("p");
    title.textContent = "Color over life";
    const canvas = document.createElement("canvas");
    canvas.width = 216;
    canvas.height = 40;
    wrap.append(title, canvas);

    const stops = (): ColorStop[] =>
      CURVE_TIMES.map((t, i) => state.colorOverLife[i] ?? { t, r: 1, g: 1, b: 1 });

    function toHex(stop: ColorStop) {
      const channel = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
      return `#${channel(stop.r)}${channel(stop.g)}${channel(stop.b)}`;
    }

    function draw() {
      const ctx = canvas.getContext("2d")!;
      const gradient = ctx.createLinearGradient(6, 0, canvas.width - 6, 0);
      for (const stop of stops()) gradient.addColorStop(stop.t, toHex(stop));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = gradient;
      ctx.fillRect(6, 4, canvas.width - 12, 20);
      ctx.strokeStyle = "#2b3540";
      ctx.strokeRect(6.5, 4.5, canvas.width - 13, 19);
      ctx.fillStyle = "#f6f2e8";
      stops().forEach((stop, i) => {
        const x = stop.t * (canvas.width - 12) + 6;
        ctx.beginPath();
        ctx.arc(x, 32, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#68d8ff";
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillText(String(i + 1), x - 2.5, 35);
        ctx.fillStyle = "#f6f2e8";
      });
    }

    canvas.addEventListener("pointerdown", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      let best = 0;
      let bestDistance = Infinity;
      CURVE_TIMES.forEach((t, i) => {
        const stopX = t * (canvas.width - 12) + 6;
        if (Math.abs(stopX - x) < bestDistance) {
          bestDistance = Math.abs(stopX - x);
          best = i;
        }
      });
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = toHex(stops()[best]);
      picker.addEventListener("input", () => {
        const hex = picker.value;
        const next = stops();
        next[best] = {
          t: CURVE_TIMES[best],
          r: parseInt(hex.slice(1, 3), 16) / 255,
          g: parseInt(hex.slice(3, 5), 16) / 255,
          b: parseInt(hex.slice(5, 7), 16) / 255,
        };
        state.colorOverLife = next;
        draw();
        scheduleRebuild();
      });
      picker.click();
    });

    queueMicrotask(draw);
    return wrap;
  }

  function setStatus(message: string) {
    const status = root.querySelector("[data-status]");
    if (status) status.textContent = message;
  }

  function presetList(): { name: string; source: "builtin" | "saved" }[] {
    return [
      ...builtinPresets.map((preset) => ({ name: preset.name, source: "builtin" as const })),
      ...savedPresets.map((preset) => ({ name: preset.name, source: "saved" as const })),
    ];
  }

  function applyPreset(preset: VfxPreset) {
    const nextState = JSON.parse(JSON.stringify(preset)) as VfxPreset;
    const token = ++applyToken;
    const apply = async () => {
      try {
        const nextTexture = await loadPresetTexture(nextState);
        if (token !== applyToken) {
          nextTexture.dispose();
          return;
        }

        state = nextState;
        const nextTextureState = nextState.texture;
        const nextLabel = nextTextureState.kind === "builtin"
          ? builtinTextureIds.find((item) => item.id === nextTextureState.id)?.label ?? "Built-in"
          : "Uploaded PNG";
        installTexture(nextTexture, nextLabel);
        renderControls();
      } catch (error) {
        if (token !== applyToken) return;
        console.error("VFX preset apply failed", error);
        setStatus("Failed to load preset texture. Previous preview kept.");
      }
    };
    void apply();
  }

  function renderControls() {
    const controls = root.querySelector("[data-controls]")!;
    controls.innerHTML = "";

    const textureSection = document.createElement("section");
    textureSection.innerHTML = `<h3>Texture</h3>`;
    textureSection.append(
      selectRow(
        "Built-in",
        builtinTextureIds.map((item) => ({ value: item.id, label: item.label })),
        () => (state.texture.kind === "builtin" ? state.texture.id : ""),
        (value) => {
          applyToken += 1;
          state.texture = { kind: "builtin", id: value as BuiltinTextureId };
          installTexture(
            createBuiltinTexture(value as BuiltinTextureId),
            builtinTextureIds.find((item) => item.id === value)?.label ?? "Built-in",
          );
          setStatus("");
        },
      ),
    );
    const uploadRow = document.createElement("div");
    uploadRow.className = "vfx-editor__actions";
    const uploadButton = document.createElement("button");
    uploadButton.type = "button";
    uploadButton.textContent = "Upload PNG";
    uploadButton.addEventListener("click", () => {
      const token = ++applyToken;
      void pickPngFile().then(async (file) => {
        if (!file) return;
        try {
          const result = await uploadPng(file);
          if (token !== applyToken) {
            result.texture.dispose();
            return;
          }
          state.texture = { kind: "upload", dataUrl: result.dataUrl };
          installTexture(result.texture, file.name);
          setStatus(
            result.hasAlpha
              ? `Loaded ${file.name} (${result.width}×${result.height})`
              : `${file.name}: no alpha channel — alpha approximated from luminance`,
          );
          renderControls();
        } catch (error) {
          if (token !== applyToken) return;
          setStatus(error instanceof Error ? error.message : "Upload failed.");
        }
      });
    });
    const textureName = document.createElement("span");
    textureName.className = "vfx-editor__texture-name";
    textureName.textContent = textureLabel;
    uploadRow.append(uploadButton, textureName);
    textureSection.append(uploadRow);
    controls.append(textureSection);

    const emissionSection = document.createElement("section");
    emissionSection.innerHTML = `<h3>Emission</h3>`;
    emissionSection.append(
      sliderRow({ label: "Rate /s", min: 0, max: particleBudgetLimits.maxRate, step: 5, get: () => state.rate, set: (v) => { state.rate = v; } }),
      pairRows("Lifetime", "life", 0.05, 6, 0.05),
      pairRows("Speed", "speed", 0, 30, 0.1),
      selectRow(
        "Emitter",
        [
          { value: "point", label: "Point" },
          { value: "sphere", label: "Sphere" },
          { value: "cone", label: "Cone" },
        ],
        () => state.emitter.type,
        (value) => {
          state.emitter =
            value === "sphere" ? { type: "sphere", radius: 2 } : value === "cone" ? { type: "cone", radius: 0.4, angle: 0.45 } : { type: "point" };
        },
      ),
    );
    if (state.emitter.type === "sphere") {
      emissionSection.append(
        sliderRow({
          label: "Radius",
          min: 0,
          max: 40,
          step: 0.5,
          get: () => (state.emitter as { radius: number }).radius,
          set: (v) => { (state.emitter as { radius: number }).radius = v; },
        }),
      );
    }
    if (state.emitter.type === "cone") {
      emissionSection.append(
        sliderRow({
          label: "Radius",
          min: 0,
          max: 10,
          step: 0.1,
          get: () => (state.emitter as { radius: number }).radius,
          set: (v) => { (state.emitter as { radius: number }).radius = v; },
        }),
        sliderRow({
          label: "Cone angle",
          min: 0,
          max: 1.5,
          step: 0.02,
          get: () => (state.emitter as { angle: number }).angle,
          set: (v) => { (state.emitter as { angle: number }).angle = v; },
        }),
      );
    }
    controls.append(emissionSection);

    const motionSection = document.createElement("section");
    motionSection.innerHTML = `<h3>Motion</h3>`;
    motionSection.append(
      sliderRow({ label: "Gravity", min: -30, max: 30, step: 0.2, get: () => state.gravity, set: (v) => { state.gravity = v; } }),
      sliderRow({ label: "Drag", min: 0, max: 6, step: 0.05, get: () => state.drag, set: (v) => { state.drag = v; } }),
      sliderRow({ label: "Turbulence", min: 0, max: 2, step: 0.02, get: () => state.curlNoise, set: (v) => { state.curlNoise = v; } }),
      selectRow(
        "Billboard",
        [
          { value: "camera", label: "Camera-facing" },
          { value: "velocity", label: "Velocity-stretched" },
        ],
        () => state.billboard,
        (value) => { state.billboard = value as "camera" | "velocity"; },
      ),
      sliderRow({ label: "Stretch", min: 0, max: 1, step: 0.01, get: () => state.stretch, set: (v) => { state.stretch = v; } }),
      selectRow(
        "Space",
        [
          { value: "world", label: "World" },
          { value: "local", label: "Local" },
        ],
        () => state.space,
        (value) => { state.space = value as "world" | "local"; },
      ),
    );
    controls.append(motionSection);

    const lookSection = document.createElement("section");
    lookSection.innerHTML = `<h3>Look</h3>`;
    lookSection.append(
      pairRows("Size", "startSize", 0.01, 6, 0.01),
      pairRows("Spin", "rotationSpeed", -6, 6, 0.1),
      selectRow(
        "Blending",
        [
          { value: "normal", label: "Normal" },
          { value: "additive", label: "Additive" },
        ],
        () => state.blending,
        (value) => { state.blending = value as "normal" | "additive"; },
      ),
      sliderRow({ label: "Ground fade", min: 0, max: 2, step: 0.05, get: () => state.groundFade, set: (v) => { state.groundFade = v; } }),
      scalarCurveEditor("Size over life", "sizeOverLife", 4),
      scalarCurveEditor("Opacity over life", "opacityOverLife", 1),
      colorCurveEditor(),
    );
    controls.append(lookSection);

    const flipbookSection = document.createElement("section");
    flipbookSection.innerHTML = `<h3>Flipbook</h3>`;
    const flipbookRow = document.createElement("div");
    flipbookRow.className = "vfx-editor__row";
    const colsInput = document.createElement("input");
    const rowsInput = document.createElement("input");
    const fpsInput = document.createElement("input");
    for (const input of [colsInput, rowsInput, fpsInput]) {
      input.type = "number";
      input.min = "0";
      input.className = "vfx-editor__number";
    }
    colsInput.value = String(state.flipbook?.cols ?? 0);
    rowsInput.value = String(state.flipbook?.rows ?? 0);
    fpsInput.value = String(state.flipbook?.fps ?? 0);
    const applyFlipbook = () => {
      const cols = Number(colsInput.value);
      const rows = Number(rowsInput.value);
      const fps = Number(fpsInput.value);
      state.flipbook = cols > 0 && rows > 0 ? { cols, rows, fps } : null;
      scheduleRebuild();
    };
    for (const input of [colsInput, rowsInput, fpsInput]) input.addEventListener("change", applyFlipbook);
    flipbookRow.innerHTML = `<span>Cols / Rows / FPS</span>`;
    flipbookRow.append(colsInput, rowsInput, fpsInput);
    flipbookSection.append(flipbookRow);
    const capacityRow = sliderRow({
      label: "Max instances",
      min: 32,
      max: particleBudgetLimits.perSystem,
      step: 16,
      get: () => state.maxInstances,
      set: (v) => { state.maxInstances = v; },
    });
    flipbookSection.append(capacityRow);
    controls.append(flipbookSection);

    const presetSection = document.createElement("section");
    presetSection.innerHTML = `<h3>Presets</h3>`;
    const presetSelect = document.createElement("select");
    presetSelect.innerHTML = "";
    for (const item of presetList()) {
      const option = document.createElement("option");
      option.value = `${item.source}:${item.name}`;
      option.textContent = `${item.name}${item.source === "builtin" ? " (built-in)" : ""}`;
      if (item.name === state.name) option.selected = true;
      presetSelect.append(option);
    }
    presetSelect.addEventListener("change", () => {
      const [source, ...rest] = presetSelect.value.split(":");
      const name = rest.join(":");
      const preset = source === "builtin"
        ? builtinPresets.find((item) => item.name === name)
        : savedPresets.find((item) => item.name === name);
      if (preset) applyPreset(preset);
    });
    const nameRow = document.createElement("div");
    nameRow.className = "vfx-editor__row";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.value = state.name;
    nameInput.className = "vfx-editor__name";
    nameInput.addEventListener("input", () => {
      state.name = nameInput.value || "Custom Effect";
    });
    nameRow.append(document.createElement("span"), nameInput);
    nameRow.querySelector("span")!.textContent = "Name";

    const actions = document.createElement("div");
    actions.className = "vfx-editor__actions";
    const button = (label: string, onClick: () => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.addEventListener("click", onClick);
      return element;
    };
    actions.append(
      button("Save", () => {
        try {
          savedPresets = savePreset(JSON.parse(JSON.stringify(state)) as VfxPreset);
          setStatus(`Saved "${state.name}" — persists across reloads.`);
        } catch (error) {
          setStatus(error instanceof Error ? `Save failed: ${error.message}` : "Save failed (storage quota?).");
        }
        renderControls();
      }),
      button("Delete", () => {
        try {
          savedPresets = deletePreset(state.name);
          setStatus(`Deleted "${state.name}" (if it was saved).`);
        } catch {
          setStatus("Delete failed (storage unavailable?).");
        }
        renderControls();
      }),
      button("Export", () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${state.name.replace(/[^a-z0-9-_]+/gi, "_")}.vfx.json`;
        link.click();
        URL.revokeObjectURL(link.href);
      }),
      button("Import", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          void file.text().then((text) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              setStatus("Import failed: not valid JSON.");
              return;
            }
            const preset = validatePreset(parsed);
            if (!preset) {
              setStatus("Import failed: not a valid preset.");
              return;
            }
            applyPreset(preset);
            setStatus(`Imported "${preset.name}".`);
          });
        };
        input.click();
      }),
      button("Copy share", () => {
        const share = presetToShareString(state);
        navigator.clipboard.writeText(share).then(
          () => setStatus("Share string copied."),
          () => prompt("Copy this share string:", share),
        );
      }),
      button("Paste share", () => {
        const share = prompt("Paste a share string:");
        if (!share) return;
        const preset = presetFromShareString(share);
        if (!preset) {
          setStatus("That share string is not a valid preset.");
          return;
        }
        applyPreset(preset);
        setStatus(`Loaded "${preset.name}" from share string.`);
      }),
      button("Apply as Tire Smoke", () => {
        if (callbacks.onApplyTireSmoke) {
          callbacks.onApplyTireSmoke(JSON.parse(JSON.stringify(state)) as VfxPreset);
          setStatus(`"${state.name}" is now your tire smoke. Save the preset first to keep it across reloads.`);
        }
      }),
      button("Reset Tire Smoke", () => {
        if (callbacks.onClearTireSmoke) {
          callbacks.onClearTireSmoke();
          setStatus("Tire smoke reset to default.");
        }
      }),
    );
    presetSection.append(presetSelect, nameRow, actions);
    controls.append(presetSection);
  }

  root.innerHTML = `
    <div class="vfx-editor__panel">
      <header class="vfx-editor__header">
        <div>
          <p class="garage-kicker">Particle Lab</p>
          <h1>VFX Lab</h1>
        </div>
        <span class="vfx-editor__budget" data-budget></span>
        <button data-close type="button">Close</button>
      </header>
      <div class="vfx-editor__body">
        <div class="vfx-editor__preview" data-preview-zone>
          <canvas data-preview></canvas>
          <p class="vfx-editor__hint">Drag to orbit · wheel to zoom · drop a PNG anywhere on this panel</p>
          <p class="vfx-editor__status" data-status></p>
        </div>
        <div class="vfx-editor__controls" data-controls></div>
      </div>
    </div>
  `;

  root.querySelector("[data-close]")!.addEventListener("click", () => {
    hide();
    callbacks.onClose?.();
  });

  const previewZone = root.querySelector<HTMLElement>("[data-preview-zone]")!;
  previewZone.addEventListener("dragover", (event) => event.preventDefault());
  previewZone.addEventListener("drop", (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const token = ++applyToken;
    void uploadPng(file).then(
      (result) => {
        if (token !== applyToken) {
          result.texture.dispose();
          return;
        }
        state.texture = { kind: "upload", dataUrl: result.dataUrl };
        installTexture(result.texture, file.name);
        setStatus(result.hasAlpha ? `Loaded ${file.name}` : `${file.name}: no alpha channel — alpha approximated from luminance`);
        renderControls();
      },
      (error: unknown) => {
        if (token !== applyToken) return;
        setStatus(error instanceof Error ? error.message : "Upload failed.");
      },
    );
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Escape" || root.hidden) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select")) return;
    hide();
    callbacks.onClose?.();
  };
  window.addEventListener("keydown", onKeyDown);

  function show() {
    if (disposed) return;
    if (isOpen) return;  // Idempotent — don't open twice
    isOpen = true;
    root.hidden = false;
    ensurePreview();
    renderControls();
    rebuildSystem();
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function hide() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    applyToken += 1;
    window.clearTimeout(rebuildTimer);
    rebuildTimer = 0;
    cancelAnimationFrame(rafId);
    rafId = 0;
    disposeSystem();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    isOpen = false;
    root.hidden = true;
    applyToken += 1;
    window.clearTimeout(rebuildTimer);
    rebuildTimer = 0;
    cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("keydown", onKeyDown);
    disposeSystem();
    // Dispose the preview renderer and scene
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (previewScene) {
      previewScene.traverse((child) => {
        if (child instanceof Mesh) {
          child.geometry?.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of materials) mat?.dispose();
        }
      });
      if (previewScene.background instanceof Color) {
        // Color doesn't need disposal
      }
      previewScene = null;
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer = null;
    }
    previewCamera = null;
    // Dispose the current texture
    texture.dispose();
    root.remove();
  }

  return { root, show, hide, dispose, get isOpen() { return isOpen; }, setTireSmokeStatus: setStatus };
}
