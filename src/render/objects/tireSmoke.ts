import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Points,
  ShaderMaterial,
} from "three";
import type { CarState } from "../../game/types";

type Puff = {
  x: number;
  y: number;
  z: number;
  life: number;
  maxLife: number;
  size: number;
};

const rearOffsets = [-1.08, 1.08];
const rearAxleZ = -1.48;
const maxPuffs = 90;

export function createTireSmoke() {
  const root = new Group();
  const positions = new Float32Array(maxPuffs * 3);
  const sizes = new Float32Array(maxPuffs);
  const alphas = new Float32Array(maxPuffs);
  const geometry = new BufferGeometry();
  const positionAttribute = new Float32BufferAttribute(positions, 3);
  const sizeAttribute = new Float32BufferAttribute(sizes, 1);
  const alphaAttribute = new Float32BufferAttribute(alphas, 1);
  positionAttribute.setUsage(DynamicDrawUsage);
  sizeAttribute.setUsage(DynamicDrawUsage);
  alphaAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("particleSize", sizeAttribute);
  geometry.setAttribute("particleAlpha", alphaAttribute);
  geometry.setDrawRange(0, 0);

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      pixelRatio: { value: Math.min(window.devicePixelRatio, 1.25) },
      smokeColor: { value: [0.74, 0.76, 0.74] },
    },
    vertexShader: `
      attribute float particleSize;
      attribute float particleAlpha;
      uniform float pixelRatio;
      varying float vAlpha;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = particleSize * pixelRatio * (520.0 / max(1.0, -viewPosition.z));
        vAlpha = particleAlpha;
      }
    `,
    fragmentShader: `
      uniform vec3 smokeColor;
      varying float vAlpha;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float softEdge = smoothstep(0.5, 0.12, distanceFromCenter);
        gl_FragColor = vec4(smokeColor, vAlpha * softEdge);
      }
    `,
  });
  const particles = new Points(geometry, material);
  particles.frustumCulled = false;
  particles.renderOrder = 12;
  root.add(particles);

  const puffs: Puff[] = [];
  let spawnDebt = 0;

  function spawn(car: CarState, strength: number) {
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    for (const offset of rearOffsets) {
      if (puffs.length >= maxPuffs) puffs.shift();
      const maxLife = 0.72 + strength * 0.5;
      puffs.push({
        x: car.position.x + offset * cos + rearAxleZ * sin,
        y: 0.3,
        z: car.position.z - offset * sin + rearAxleZ * cos,
        life: maxLife,
        maxLife,
        size: 0.54 + strength * 0.64,
      });
    }
  }

  function syncBuffers() {
    for (let i = 0; i < puffs.length; i++) {
      const puff = puffs[i];
      const life01 = Math.max(0, puff.life / puff.maxLife);
      positions[i * 3] = puff.x;
      positions[i * 3 + 1] = puff.y;
      positions[i * 3 + 2] = puff.z;
      sizes[i] = puff.size * (1.25 + (1 - life01) * 1.8);
      alphas[i] = life01 * life01 * 0.34;
    }
    geometry.setDrawRange(0, puffs.length);
    positionAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  }

  return {
    root,
    reset() {
      spawnDebt = 0;
      puffs.length = 0;
      geometry.setDrawRange(0, 0);
    },
    update(car: CarState, onTrack: boolean, dt: number) {
      const activeSlide = Math.max(0, car.rearSlipVisual - 0.18);
      const heatBoost = 0.72 + car.tireHeat * 0.48;
      const strength = activeSlide * heatBoost * 1.18 * (onTrack ? 1 : 0.35);
      spawnDebt += strength * car.speed * dt * 0.3;

      while (spawnDebt > 1 && strength > 0.12) {
        spawn(car, strength);
        spawnDebt -= 1;
      }

      for (let i = puffs.length - 1; i >= 0; i--) {
        const puff = puffs[i];
        puff.life -= dt;
        puff.y += dt * 0.46;
        if (puff.life <= 0) puffs.splice(i, 1);
      }
      syncBuffers();
    },
  };
}
