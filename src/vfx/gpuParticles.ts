import {
  AdditiveBlending,
  CanvasTexture,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type DataTexture,
  type Texture,
} from "three";
import { claimParticleBudget, clampSpawnRate, releaseParticleBudget } from "./budget";
import { buildColorLut, buildScalarLut, type ColorStop, type ScalarStop } from "./particleCurves";

// GPU-stateless particle runtime: all motion is computed in the vertex shader from a time
// uniform + per-instance spawn attributes. The CPU only writes attributes at spawn time
// (ring buffer), so there is zero per-frame CPU simulation work and zero allocations.

export type ParticleEmitterShape =
  | { type: "point" }
  | { type: "sphere"; radius: number }
  | { type: "cone"; radius: number; angle: number };

export type ParticleSystemOptions = {
  texture: Texture;
  maxInstances?: number;
  blending?: "normal" | "additive";
  billboard?: "camera" | "velocity";
  space?: "world" | "local";
  emitter?: ParticleEmitterShape;
  rate?: number;
  life?: [number, number];
  speed?: [number, number];
  gravity?: number;
  drag?: number;
  curlNoise?: number;
  startSize?: [number, number];
  rotationSpeed?: [number, number];
  stretch?: number;
  sizeOverLife?: DataTexture;
  opacityOverLife?: DataTexture;
  colorOverLife?: DataTexture;
  flipbook?: { cols: number; rows: number; fps: number } | null;
  groundFade?: number;
  renderOrder?: number;
};

export type GpuParticleSystem = {
  root: Mesh;
  readonly capacity: number;
  update(dt: number): void;
  reset(): void;
  burst(count: number): void;
  setRate(rate: number): void;
  setEnabled(enabled: boolean): void;
  setTint(r: number, g: number, b: number): void;
  dispose(): void;
};

const DEFAULT_SIZE_LUT = () => buildScalarLut([{ t: 0, value: 1 }]);
const DEFAULT_OPACITY_LUT = () =>
  buildScalarLut([
    { t: 0, value: 1 },
    { t: 1, value: 0 },
  ]);
const DEFAULT_COLOR_LUT = () => buildColorLut([{ t: 0, r: 1, g: 1, b: 1 }]);

const vertexShader = `
  attribute vec3 aSpawnPos;
  attribute vec3 aVelocity;
  attribute vec2 aTiming;
  attribute vec3 aParams;

  uniform float uTime;
  uniform float uGravity;
  uniform float uDrag;
  uniform float uCurl;
  uniform float uStretch;
  uniform float uBillboardMode;
  uniform float uWorldSpace;
  uniform float uGroundFade;
  uniform vec3 uFlipGrid;
  uniform sampler2D uSizeLut;
  uniform sampler2D uOpacityLut;
  uniform sampler2D uColorLut;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vGroundAlpha;

  void main() {
    float spawnTime = aTiming.x;
    float life = aTiming.y;
    float age = uTime - spawnTime;
    bool dead = age < 0.0 || age > life || life <= 0.0;
    if (dead) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUv = uv;
      vColor = vec3(0.0);
      vOpacity = 0.0;
      vGroundAlpha = 0.0;
      return;
    }

    float t01 = clamp(age / life, 0.0, 1.0);
    float baseSize = aParams.x;
    float rotSpeed = aParams.y;
    float seed = aParams.z;

    float dragK = max(uDrag, 0.0001);
    vec3 pos = aSpawnPos + aVelocity * ((1.0 - exp(-dragK * age)) / dragK);
    pos.y += uGravity * age * age * 0.5;
    vec3 wobble = vec3(
      sin(seed * 17.31 + age * 2.13),
      sin(seed * 23.71 + age * 1.73),
      sin(seed * 29.17 + age * 2.71)
    );
    pos += wobble * uCurl * age;

    vec4 worldPos = uWorldSpace > 0.5 ? vec4(pos, 1.0) : modelMatrix * vec4(pos, 1.0);
    vec4 mvPosition = viewMatrix * worldPos;

    float sizeScale = texture2D(uSizeLut, vec2(t01, 0.5)).r;
    float size = baseSize * sizeScale;

    vec2 corner = position.xy;
    if (uBillboardMode > 0.5) {
      vec3 curVel = aVelocity * exp(-uDrag * age) + vec3(0.0, uGravity * age, 0.0);
      vec3 viewVel = (viewMatrix * (uWorldSpace > 0.5 ? vec4(curVel, 0.0) : modelMatrix * vec4(curVel, 0.0))).xyz;
      vec2 axis = normalize(viewVel.xy + vec2(0.00001, 0.0));
      vec2 perp = vec2(-axis.y, axis.x);
      float speed = length(viewVel.xy);
      mvPosition.xy += perp * corner.x * size + axis * corner.y * (size + speed * uStretch);
    } else {
      float rot = rotSpeed * age + seed * 6.28318;
      float cr = cos(rot);
      float sr = sin(rot);
      vec2 rotated = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
      mvPosition.xy += rotated * size;
    }

    gl_Position = projectionMatrix * mvPosition;

    if (uFlipGrid.z > 0.5) {
      float frames = uFlipGrid.x * uFlipGrid.y;
      float frame = mod(floor(age * uFlipGrid.z + seed * frames), frames);
      vec2 cell = vec2(mod(frame, uFlipGrid.x), floor(frame / uFlipGrid.x));
      vUv = (uv + cell) / uFlipGrid.xy;
    } else {
      vUv = uv;
    }
    vColor = texture2D(uColorLut, vec2(t01, 0.5)).rgb;
    vOpacity = texture2D(uOpacityLut, vec2(t01, 0.5)).r;
    vGroundAlpha = uGroundFade > 0.0 ? clamp((worldPos.y - size * 0.5) / uGroundFade, 0.0, 1.0) : 1.0;
  }
`;

const fragmentShader = `
  uniform sampler2D uMap;
  uniform vec3 uTint;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vGroundAlpha;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    float alpha = texel.a * vOpacity * vGroundAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(texel.rgb * vColor * uTint, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const scratchVector = new Vector3();
const scratchDirection = new Vector3();
const scratchAxis = new Vector3();
const scratchQuaternion = new Quaternion();

export function createRadialSpriteTexture(size = 128, innerAlpha = 0.75) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.48);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${innerAlpha})`);
  gradient.addColorStop(0.55, `rgba(255, 255, 255, ${innerAlpha * 0.45})`);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function createGpuParticleSystem(options: ParticleSystemOptions): GpuParticleSystem {
  const capacity = claimParticleBudget(options.maxInstances ?? 512);
  const blending = options.blending ?? "normal";
  const billboardMode = options.billboard === "velocity" ? 1 : 0;
  const worldSpace = options.space !== "local";
  const emitter = options.emitter ?? { type: "point" as const };
  const life = options.life ?? [0.8, 1.4];
  const speed = options.speed ?? [0.4, 1.2];
  const startSize = options.startSize ?? [0.5, 0.9];
  const rotationSpeed = options.rotationSpeed ?? [-1.2, 1.2];
  const flipbook = options.flipbook ?? null;

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3),
  );
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.instanceCount = capacity;

  const spawnPos = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const timing = new Float32Array(capacity * 2);
  const params = new Float32Array(capacity * 3);
  const spawnPosAttr = new InstancedBufferAttribute(spawnPos, 3).setUsage(DynamicDrawUsage);
  const velocityAttr = new InstancedBufferAttribute(velocity, 3).setUsage(DynamicDrawUsage);
  const timingAttr = new InstancedBufferAttribute(timing, 2).setUsage(DynamicDrawUsage);
  const paramsAttr = new InstancedBufferAttribute(params, 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute("aSpawnPos", spawnPosAttr);
  geometry.setAttribute("aVelocity", velocityAttr);
  geometry.setAttribute("aTiming", timingAttr);
  geometry.setAttribute("aParams", paramsAttr);

  const sizeLut = options.sizeOverLife ?? DEFAULT_SIZE_LUT();
  const opacityLut = options.opacityOverLife ?? DEFAULT_OPACITY_LUT();
  const colorLut = options.colorOverLife ?? DEFAULT_COLOR_LUT();

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: blending === "additive" ? AdditiveBlending : NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uGravity: { value: options.gravity ?? 0 },
      uDrag: { value: options.drag ?? 0.4 },
      uCurl: { value: options.curlNoise ?? 0 },
      uStretch: { value: options.stretch ?? 0.12 },
      uBillboardMode: { value: billboardMode },
      uWorldSpace: { value: worldSpace ? 1 : 0 },
      uGroundFade: { value: options.groundFade ?? 0 },
      uFlipGrid: { value: new Vector3(flipbook?.cols ?? 1, flipbook?.rows ?? 1, flipbook?.fps ?? 0) },
      uSizeLut: { value: sizeLut },
      uOpacityLut: { value: opacityLut },
      uColorLut: { value: colorLut },
      uMap: { value: options.texture },
      uTint: { value: new Vector3(1, 1, 1) },
    },
    vertexShader,
    fragmentShader,
  });

  const root = new Mesh(geometry, material);
  root.frustumCulled = false;
  root.renderOrder = options.renderOrder ?? 12;

  let rate = clampSpawnRate(options.rate ?? 40);
  let enabled = true;
  let spawnDebt = 0;
  let head = 0;
  let time = 0;
  let dirty = false;

  function randomUnitVector(out: Vector3) {
    const z = Math.random() * 2 - 1;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(1 - z * z);
    return out.set(radius * Math.cos(angle), radius * Math.sin(angle), z);
  }

  function writeInstance(origin: Vector3, direction: Vector3) {
    const i = head;
    head = (head + 1) % capacity;
    spawnPos[i * 3] = origin.x;
    spawnPos[i * 3 + 1] = origin.y;
    spawnPos[i * 3 + 2] = origin.z;
    const speedValue = speed[0] + Math.random() * (speed[1] - speed[0]);
    velocity[i * 3] = direction.x * speedValue;
    velocity[i * 3 + 1] = direction.y * speedValue;
    velocity[i * 3 + 2] = direction.z * speedValue;
    timing[i * 2] = time;
    timing[i * 2 + 1] = life[0] + Math.random() * (life[1] - life[0]);
    params[i * 3] = startSize[0] + Math.random() * (startSize[1] - startSize[0]);
    params[i * 3 + 1] = rotationSpeed[0] + Math.random() * (rotationSpeed[1] - rotationSpeed[0]);
    params[i * 3 + 2] = Math.random();
    dirty = true;
  }

  function spawnOne() {
    root.updateWorldMatrix(true, false);
    if (worldSpace) {
      scratchVector.setFromMatrixPosition(root.matrixWorld);
      scratchQuaternion.setFromRotationMatrix(root.matrixWorld);
    } else {
      scratchVector.set(0, 0, 0);
      scratchQuaternion.identity();
    }

    if (emitter.type === "sphere") {
      randomUnitVector(scratchDirection);
      scratchAxis.copy(scratchDirection).applyQuaternion(scratchQuaternion);
      scratchVector.addScaledVector(scratchAxis, emitter.radius * Math.cbrt(Math.random()));
      writeInstance(scratchVector, scratchAxis.normalize());
      return;
    }

    if (emitter.type === "cone") {
      const spreadAngle = (Math.random() - 0.5) * 2 * emitter.angle;
      const aroundAngle = Math.random() * Math.PI * 2;
      scratchDirection.set(
        Math.sin(spreadAngle) * Math.cos(aroundAngle),
        Math.cos(spreadAngle),
        Math.sin(spreadAngle) * Math.sin(aroundAngle),
      );
      scratchDirection.applyQuaternion(scratchQuaternion).normalize();
      const diskRadius = Math.sqrt(Math.random()) * emitter.radius;
      scratchAxis.set(Math.cos(aroundAngle) * diskRadius, 0, Math.sin(aroundAngle) * diskRadius);
      scratchAxis.applyQuaternion(scratchQuaternion);
      scratchVector.add(scratchAxis);
      writeInstance(scratchVector, scratchDirection);
      return;
    }

    randomUnitVector(scratchDirection);
    scratchDirection.applyQuaternion(scratchQuaternion);
    writeInstance(scratchVector, scratchDirection);
  }

  function spawn(count: number) {
    for (let i = 0; i < count; i++) spawnOne();
  }

  return {
    root,
    capacity,
    update(dt: number) {
      time += dt;
      material.uniforms.uTime.value = time;
      if (enabled && rate > 0) {
        spawnDebt += rate * dt;
        const due = Math.floor(spawnDebt);
        if (due > 0) {
          spawnDebt -= due;
          spawn(due);
        }
      }
      if (dirty) {
        spawnPosAttr.needsUpdate = true;
        velocityAttr.needsUpdate = true;
        timingAttr.needsUpdate = true;
        paramsAttr.needsUpdate = true;
        dirty = false;
      }
    },
    reset() {
      spawnDebt = 0;
      head = 0;
      time = 0;
      material.uniforms.uTime.value = 0;
    },
    burst(count: number) {
      spawn(Math.min(count, capacity));
    },
    setRate(next: number) {
      rate = clampSpawnRate(next);
    },
    setEnabled(next: boolean) {
      enabled = next;
    },
    setTint(r: number, g: number, b: number) {
      material.uniforms.uTint.value.set(r, g, b);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      if (!options.sizeOverLife) sizeLut.dispose();
      if (!options.opacityOverLife) opacityLut.dispose();
      if (!options.colorOverLife) colorLut.dispose();
      releaseParticleBudget(capacity);
    },
  };
}

export type { ColorStop, ScalarStop };
