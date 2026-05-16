# Project Lite Map Builder Toolbox

Use the in-game Map Editor when you want to adjust road overlap, patch areas back to grass, or dress a map with the existing Project Lite asset kit.

## Open the editor

1. Run the local dev app with `npm run dev` or `npm run dev:client`.
2. Open the Garage.
3. Pick **Map Editor** from the mode list.
4. Click **Start Event**.

## Camera controls

- Right mouse drag: look around
- `WASD`: fly forward, left, back, right
- `Q` / `E`: down / up
- Hold `Shift`: faster fly speed
- Mouse wheel: brush size or asset scale
- Left click: paint, remove, or place
- `R`: rotate the currently placed asset by 15 degrees
- `Esc`: return to garage

## Surface tools

- **Paint Road** adds asphalt patches.
- **Remove Road** paints the area back with the same grass material used by the map.
- **Place Asset** places the selected prop from the tabs.

## Asset tabs

- **Track Paint**: asphalt pad, lane paint, road wear, gravel runoff, curb stripe
- **Safety**: cones, clip poles, tire stacks, guardrails, barriers, lights, signs, chevrons
- **Buildings**: pit buildings, garage bays, grandstands, start gantry
- **Nature**: trees, shrubs, grass tufts
- **Online**: portal gate, queue ring, flatbed hauler

## Saving

During local Vite development, **Save** writes a real project file:

```text
public/assets/map-edits/<track-id>.json
```

That file is loaded automatically the next time the map renders, so the edited map becomes the map. Commit that JSON file with the rest of the project when you want to keep the changes.

The **Export** button downloads the same patch as JSON for handoff or backup.

## Builder guidance

Prefer large, clean road/grass fixes first. Use props after the drivable space feels right. For online lobby work, keep roads wide and readable, place portals on clear pads, and use painted ground arrows plus sky beams so players are never guessing where to go.
