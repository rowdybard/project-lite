export type Vec2 = {
  x: number;
  z: number;
};

export type CarTuning = {
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  acceleration: number;
  brakeForce: number;
  reverseAcceleration: number;
  drag: number;
  rollingResistance: number;
  steeringAtSpeed: number;
  steerResponse: number;
  throttleResponse: number;
  idleRpm: number;
  redlineRpm: number;
  shiftUpRpm: number;
  shiftDownRpm: number;
  finalDrive: number;
  wheelRadius: number;
  engineTorque: number;
  gearRatios: number[];
  maxSteerAngle: number;
  frontAxle: number;
  rearAxle: number;
  yawInertia: number;
  frontGrip: number;
  rearGrip: number;
  handbrakeRearGrip: number;
  frontCorneringStiffness: number;
  rearCorneringStiffness: number;
  throttleGripLoss: number;
  counterSteerAssist: number;
  offTrackGrip: number;
  offTrackDrag: number;
  driftMinSpeed: number;
  driftDrag: number;
  slideDrag: number;
  handbrakeDrag: number;
  yawDamping: number;
  wheelbaseScale?: number;
  trackWidthScale?: number;
  massScale?: number;
  collisionLength?: number;
  collisionWidth?: number;
};

export type CarState = {
  position: Vec2;
  heading: number;
  velocity: Vec2;
  speed: number;
  yawVelocity: number;
  slipAmount: number;
  slipAngle: number;
  frontSlipAngle: number;
  rearSlipAngle: number;
  gripAmount: number;
  handbrakeAmount: number;
  driftAmount: number;
  driftDirection: number;
  frontWheelAngle: number;
  wheelSpin: number;
  rearWheelSpin: number;
  bodyPitch: number;
  bodyRoll: number;
  weightForward: number;
  weightRight: number;
  suspensionFL: number;
  suspensionFR: number;
  suspensionRL: number;
  suspensionRR: number;
  gear: number;
  rpm: number;
  shiftCooldown: number;
  tireHeat: number;
  rearSlipVisual: number;
  steerAxis: number;
  throttleAxis: number;
  brakeAxis: number;
  reverseEngageTimer: number;
  brakeToThrottleTimer: number;
};

export type InputState = {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  reset: boolean;
  confirm: boolean;
  zoneNext: boolean;
  debug: boolean;
  menu: boolean;
};

export type TrackConfig = {
  id: string;
  name: string;
  model?: string;
  start: Vec2 & { heading: number };
  checkpoints: Vec2[];
  roadPath?: Vec2[];
  roadWidth: number;
  boundaryMargin: number;
  practiceZones?: Array<Vec2 & { id: string; label: string; heading: number }>;
  practiceAreas?: Array<
    | (Vec2 & { type: "rect"; width: number; depth: number; heading?: number })
    | (Vec2 & { type: "circle"; radius: number })
  >;
  portals?: Array<
    Vec2 & {
      id: string;
      label: string;
      mode: "drift-attack" | "free-drive";
      radius: number;
      heading?: number;
      color?: number;
    }
  >;
};

export type RaceState = {
  currentCheckpoint: number;
  lap: number;
  lapStartedAt: number;
  lastLapMs: number;
  bestLapMs: number;
  wrongWay: boolean;
};

export type DriftState = {
  totalScore: number;
  comboScore: number;
  bestCombo: number;
  multiplier: number;
  driftTime: number;
  totalDriftTime: number;
  active: boolean;
  grace: number;
  lastDirection: number;
  grade: string;
  bestRun: number;
  currentZone: number;
  zonesHit: number[];
  callout: string;
  calloutTimer: number;
  onTrack: boolean;
};
