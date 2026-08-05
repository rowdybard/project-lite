import type { Vec2 } from "../types";

export type CollisionProfileId =
  | "wall"
  | "guardrail"
  | "concrete"
  | "soft-barrier"
  | "post"
  | "vehicle"
  | "cone"
  | "boundary";

export type CollisionResponse = {
  restitution: number;
  tangentRetention: number;
  bounceThreshold: number;
  maxBounceSpeed: number;
  correctionPercent: number;
  correctionSlop: number;
  maxCorrection: number;
  yawImpulseScale: number;
  maxYawImpulse: number;
  severityReferenceSpeed: number;
};

export const collisionResponses: Record<
  CollisionProfileId,
  CollisionResponse
> = {
  wall: {
    restitution: 0.16,
    tangentRetention: 0.985,
    bounceThreshold: 0.75,
    maxBounceSpeed: 3.8,
    correctionPercent: 0.86,
    correctionSlop: 0.012,
    maxCorrection: 0.7,
    yawImpulseScale: 0.010,
    maxYawImpulse: 0.48,
    severityReferenceSpeed: 20,
  },
  guardrail: {
    restitution: 0.20,
    tangentRetention: 0.990,
    bounceThreshold: 0.7,
    maxBounceSpeed: 4.2,
    correctionPercent: 0.88,
    correctionSlop: 0.01,
    maxCorrection: 0.75,
    yawImpulseScale: 0.012,
    maxYawImpulse: 0.52,
    severityReferenceSpeed: 19,
  },
  concrete: {
    restitution: 0.14,
    tangentRetention: 0.980,
    bounceThreshold: 0.8,
    maxBounceSpeed: 3.4,
    correctionPercent: 0.88,
    correctionSlop: 0.01,
    maxCorrection: 0.72,
    yawImpulseScale: 0.010,
    maxYawImpulse: 0.46,
    severityReferenceSpeed: 20,
  },
  "soft-barrier": {
    restitution: 0.22,
    tangentRetention: 0.945,
    bounceThreshold: 0.6,
    maxBounceSpeed: 3.0,
    correctionPercent: 0.72,
    correctionSlop: 0.018,
    maxCorrection: 0.58,
    yawImpulseScale: 0.007,
    maxYawImpulse: 0.32,
    severityReferenceSpeed: 24,
  },
  post: {
    restitution: 0.12,
    tangentRetention: 0.992,
    bounceThreshold: 0.65,
    maxBounceSpeed: 2.4,
    correctionPercent: 0.78,
    correctionSlop: 0.012,
    maxCorrection: 0.55,
    yawImpulseScale: 0.014,
    maxYawImpulse: 0.46,
    severityReferenceSpeed: 22,
  },
  vehicle: {
    restitution: 0.10,
    tangentRetention: 0.960,
    bounceThreshold: 0.8,
    maxBounceSpeed: 2.8,
    correctionPercent: 0.76,
    correctionSlop: 0.018,
    maxCorrection: 0.58,
    yawImpulseScale: 0.009,
    maxYawImpulse: 0.38,
    severityReferenceSpeed: 18,
  },
  cone: {
    restitution: 0.04,
    tangentRetention: 0.997,
    bounceThreshold: 1.2,
    maxBounceSpeed: 0.8,
    correctionPercent: 0.18,
    correctionSlop: 0.02,
    maxCorrection: 0.12,
    yawImpulseScale: 0.001,
    maxYawImpulse: 0.04,
    severityReferenceSpeed: 34,
  },
  boundary: {
    restitution: 0.08,
    tangentRetention: 0.995,
    bounceThreshold: 1,
    maxBounceSpeed: 2.2,
    correctionPercent: 0.9,
    correctionSlop: 0,
    maxCorrection: 1.2,
    yawImpulseScale: 0.003,
    maxYawImpulse: 0.15,
    severityReferenceSpeed: 26,
  },
};

export type BoxCollider = {
  id: string;
  shape: "box";
  x: number;
  z: number;
  angle: number;
  halfLength: number;
  halfWidth: number;
  profile: CollisionProfileId;
  cameraObstruction: boolean;
};

export type CircleCollider = {
  id: string;
  shape: "circle";
  x: number;
  z: number;
  radius: number;
  profile: CollisionProfileId;
  cameraObstruction: boolean;
};

export type StaticCollider = BoxCollider | CircleCollider;

export type CarPose2D = {
  x: number;
  z: number;
  heading: number;
};

export type CollisionContact = {
  colliderId: string;
  normal: Vec2;
  point: Vec2;
  penetration: number;
  carCircleOffset: number;
  profile: CollisionProfileId;
  otherVelocity: Vec2;
  swept: boolean;
};

export type CollisionResult = {
  severity: number;
  contactCount: number;
  colliderIds: string[];
};

export const emptyCollisionResult: CollisionResult = {
  severity: 0,
  contactCount: 0,
  colliderIds: [],
};
