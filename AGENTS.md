# AGENTS.md — Project Drift Attack

## Stack
- **Engine:** Three.js r184 + TypeScript + Vite
- **Renderer:** ACES filmic tone mapping + sRGB output enabled; `useLegacyLights` is deprecated (do not re-enable)
- **Physics:** Off-limits. Telemetry available from `CarState`: `rearSlipVisual`, `tireHeat`, `suspensionFL/FR/RL/RR`, `weightForward/Right`, `bodyRoll`, `bodyPitch`, `wheelSpin`, `rearWheelSpin`, `frontWheelAngle`, `handbrakeAmount`, `slipAmount`, `speed`, `heading`, `position`, `brakeAxis`

## Build / Verify
- `npx tsc --noEmit` — type check (must pass clean)
- `npx vite build` — production build
- `npx vite dev` — dev server with HMR
- `?perf` URL param or `T` key — in-game performance baseline overlay

## Arena Visual Architecture
- **Environment bake** (`src/render/arena/environmentBake.ts`): procedural bright interior equirectangular map -> PMREM. IBL-dominant design.
- **Light rig** (`src/render/arena/lightRig.ts`): the ONLY module allowed to add lights to an arena scene. Exactly one shadow-casting directional (follow-key) + fills + hemisphere. `DirectionalLight` has no falloff — chosen deliberately so a 336m hall lights evenly. Supports `shadowHalfExtent` config for small venues (garage).
- **Arena shell** (`src/render/arena/arenaShell.ts`): walls, roof, truss grid, emissive fixture housings, grandstands (instanced tiers starting at 6m — above anything the car can reach). Walls must remain ~55m out due to physics containment; grandstands create the enclosed feel overhead.
- **Palette** (`src/render/arena/palette.ts`): single source of truth for arena colors and light intensities.
- **Post pipeline** (`src/render/post/postPipeline.ts`): scene -> selective bloom (threshold 1.0, fixtures only) -> OutputPass (ACES + sRGB) -> FXAA. **No film grain, no vignette.**

## Car
- **Car paint** (`src/render/materials/carPaint.ts`): procedural PBR — orange-peel detail normal map + clearcoat roughness variation. Applied via `applyProceduralPaint(material, paintHex)` in `prepPaintMaterial`.
- **Car view** (`src/render/objects/carView.ts`): procedural box-based car + imported GLTF support. Contact shadow blob at y=0.14.
- **Skid marks** (`src/render/objects/tireTracks.ts`): continuous ribbon mesh per rear wheel (ring buffer of path samples -> triangle strip with per-vertex fade + tread alpha map). NOT instanced boxes.
- **Tire smoke** (`src/render/objects/tireSmokeGpu.ts`): GPU particle runtime, one emitter per rear wheel, heat-tinted, darkens over life.

## Garage
- Separate scene (`src/render/garage/garageView.ts`) with its own lighting (tight 9m shadow frustum @ 512, intensityScale 0.04). Turntable platform with emissive accent ring under the car.
- VFX Lab editor accessible via garage button (`src/ui/vfxEditor.ts`).

## Performance
- Target: 60fps on GTX 1650
- One shadow map total per scene
- Bloom subtle, fixtures only
- MSAA active; post chain is lightweight (bloom + output + FXAA)

## Conventions
- Do not add film grain or vignette
- Do not re-enable `useLegacyLights`
- Do not modify physics files
- Keep arena walls ~55m out (physics containment); use grandstands for enclosure
- Procedural PBR paint is the car paint system; do not revert to flat-color materials
- Skid marks are a ribbon mesh, not instanced boxes
