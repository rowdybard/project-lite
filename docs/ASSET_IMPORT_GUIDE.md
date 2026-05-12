# Asset Import Guide

This prototype ships with procedural placeholder geometry so you can drive immediately. Real cars and tracks are imported through `public/assets/manifest.json`.

## File Layout

```text
public/
  assets/
    manifest.json
    cars/
      starter/
        tuning.json
        car.glb
    tracks/
      starter-ring/
        track.glb
```

The game loads files from `public` with browser paths. For example, `public/assets/cars/starter/car.glb` becomes `/assets/cars/starter/car.glb`.

## Adding A Car

1. Put a `.glb` car model in `public/assets/cars/my-car/car.glb`.
2. Copy `public/assets/cars/starter/tuning.json` into that folder.
3. Add a new entry in `public/assets/manifest.json`:

```json
"my-car": {
  "name": "My Car",
  "model": "/assets/cars/my-car/car.glb",
  "tuning": "/assets/cars/my-car/tuning.json",
  "scale": 1
}
```

4. Set `"activeCar": "my-car"`.

## Adding A Track

1. Put a `.glb` track in `public/assets/tracks/my-track/track.glb`.
2. Add a track entry to `public/assets/manifest.json`:

```json
"my-track": {
  "id": "my-track",
  "name": "My Track",
  "model": "/assets/tracks/my-track/track.glb",
  "start": { "x": 0, "z": 0, "heading": 0 },
  "roadWidth": 52,
  "boundaryMargin": 18,
  "roadPath": [
    { "x": -50, "z": 30 },
    { "x": 20, "z": 60 },
    { "x": 60, "z": 0 },
    { "x": 0, "z": -55 },
    { "x": -60, "z": -10 }
  ],
  "checkpoints": [
    { "x": 0, "z": 50 },
    { "x": 50, "z": 0 },
    { "x": 0, "z": -50 },
    { "x": -50, "z": 0 }
  ]
}
```

3. Set `"activeTrack": "my-track"`.

If `roadPath` exists, the placeholder renderer draws a smooth loop through those points. For now collision is still a broad prototype boundary. That is intentional for the first prototype. A later milestone should read authored collision meshes from GLB nodes named like `COL_road`, `COL_wall`, and `SPAWN_player`.

## Where To Get Legal Starter Assets

Good places to look:

- Kenney assets: simple permissive game assets, including racing and vehicle packs.
- Quaternius: free low-poly 3D models with a style that works well for prototypes.
- Poly Haven: free HDRIs and textures for lighting/environment work.
- Sketchfab: use the downloadable filter and check the license carefully.
- itch.io asset marketplace: useful for paid packs with clear game-use licenses.
- Blender Market, CGTrader, and TurboSquid: larger paid model marketplaces.

Prefer GLB or glTF. If you download FBX/OBJ/Blend, open it in Blender and export to GLB.

## Blender Export Checklist

- Forward direction: car nose should point toward local +Z for this prototype.
- Origin: car origin should sit near the center of the vehicle at ground level.
- Scale: 1 Blender meter equals 1 game meter.
- Apply transforms before export with `Ctrl+A`.
- Export format: glTF 2.0 binary `.glb`.
- Keep texture sizes modest at first, usually 1024 or 2048.

## Tuning Without Code Edits

Press `T` in game to open the live tuning panel. Once the car feels good, copy the values into the car's `tuning.json`.

## Drift Mode Scoring

The prototype now follows the Project Torque style goal: drift for points, not first place. Score comes from speed, angle, combo duration, and transitions between left and right drifts. A combo banks when you stop sliding cleanly.

## Default 240SX-Style Tune

The starter car is tuned like an S13/S14 240SX drift learner rather than a high-power pro car. It has modest acceleration, big steering angle, a front-engine rear-drive balance, progressive rear breakaway, and strong countersteer recovery. Drive it with momentum: enter with speed, tap handbrake or lift/turn to rotate, then hold throttle and countersteer to carry the slide.

The car also has a simple automatic gearbox. RPM rises from wheel speed and gear ratio, shifts happen at `shiftUpRpm` and `shiftDownRpm`, and low gears apply more rear-wheel torque. That torque can help start a slide, while higher gears are calmer and better for holding long arcs.

Useful first knobs:

- `acceleration`: how quickly the car gains speed.
- `maxForwardSpeed`: top speed.
- `engineTorque`: how strongly RPM and gearing can overpower the rear tires.
- `shiftUpRpm` and `shiftDownRpm`: automatic gearbox shift points.
- `gearRatios` and `finalDrive`: gear spacing and torque multiplication.
- `steeringAtSpeed`: how much steering remains at high speed.
- `maxSteerAngle`: maximum front wheel angle.
- `frontGrip`: maximum lateral grip at the front tires.
- `rearGrip`: maximum lateral grip at the rear tires.
- `handbrakeRearGrip`: rear tire grip while the handbrake is locking the rear.
- `frontCorneringStiffness`: how fast the front tires build lateral force from slip angle.
- `rearCorneringStiffness`: how fast the rear tires build lateral force from slip angle.
- `throttleGripLoss`: how much throttle can overpower the rear tires.
- `counterSteerAssist`: extra rear stability when the front wheels are steered into the slide.
- `slideDrag`: how much speed is scrubbed while the car is sideways.
- `yawDamping`: how quickly rotation settles after steering.
