// Shared industrial-stadium palette: bright cool LED light dominates; warm tones are ACCENT
// ONLY — never a sundown or night read. Directional intensities are physical units in the
// same range as the old 2.75 sun (that exposure level was proven correct on this content).
export const arenaPalette = {
  background: 0x2a333d,
  fogColor: 0x3d4854,
  fogDensity: 0.0008,

  // Procedural environment map zones (environmentBake.ts) — this carries the ambient load.
  envCeilingHot: 0xf4f9ff,
  envCeiling: 0xcfe0f2,
  envUpperWall: 0x8d99a4,
  envLowerWall: 0x5d6770,
  envFloorLine: 0x4a4a44,
  envFloor: 0x3a3a38,
  envWarmAccent: 0xffb070,

  hemiSky: 0xd6e6fb,
  hemiGround: 0x8a8578,
  hemiIntensity: 1.4,

  keyColor: 0xe8f1ff,
  keyIntensity: 2.6,
  keyDirectionX: -0.28,
  keyDirectionY: -1,
  keyDirectionZ: 0.38,
  keyShadowBias: -0.0004,
  keyShadowNormalBias: 0.02,
  shadowMapSize: 2048,

  fillCoolColor: 0xcfe2ff,
  fillCoolIntensity: 1.1,
  fillWarmColor: 0xffd9a8,
  fillWarmIntensity: 0.7,

  wallColor: 0x7d868a,
  wallBandColor: 0x394349,
  pilasterColor: 0x697274,
  roofColor: 0x333d43,
  steelColor: 0x3a464c,
  accentColor: 0xd6a63d,

  fixtureCoolEmissive: 0xdceaff,
  fixtureCoolIntensity: 2.8,
  fixtureWarmEmissive: 0xffd2a0,
  fixtureWarmIntensity: 2.2,
  signEmissiveIntensity: 1.35,

  environmentIntensity: 1.6,
  exposure: 1.05,
} as const;
