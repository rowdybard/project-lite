import type { CarState, CarTuning } from "../game/types";

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function createEngineSound() {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode;
  let engineGain: GainNode;
  let exhaustGain: GainNode;

  // Engine harmonics (oscillators simulating cylinder firing)
  let fundamental: OscillatorNode;
  let harmonic2: OscillatorNode;
  let harmonic3: OscillatorNode;
  let harmonic4: OscillatorNode;

  // Exhaust rumble (filtered noise)
  let exhaustNoise: AudioBufferSourceNode;
  let exhaustFilter: BiquadFilterNode;
  let exhaustFilter2: BiquadFilterNode;

  // Intake whoosh
  let intakeNoise: AudioBufferSourceNode;
  let intakeFilter: BiquadFilterNode;
  let intakeGain: GainNode;

  let started = false;
  let muted = false;

  function init() {
    if (ctx) return;
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.28;
    masterGain.connect(ctx.destination);

    // Engine oscillator bank
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.5;
    engineGain.connect(masterGain);

    fundamental = ctx.createOscillator();
    fundamental.type = "sawtooth";
    fundamental.frequency.value = 30;
    const fundGain = ctx.createGain();
    fundGain.gain.value = 0.45;
    fundamental.connect(fundGain).connect(engineGain);

    harmonic2 = ctx.createOscillator();
    harmonic2.type = "square";
    harmonic2.frequency.value = 60;
    const h2Gain = ctx.createGain();
    h2Gain.gain.value = 0.25;
    harmonic2.connect(h2Gain).connect(engineGain);

    harmonic3 = ctx.createOscillator();
    harmonic3.type = "sawtooth";
    harmonic3.frequency.value = 90;
    const h3Gain = ctx.createGain();
    h3Gain.gain.value = 0.15;
    harmonic3.connect(h3Gain).connect(engineGain);

    harmonic4 = ctx.createOscillator();
    harmonic4.type = "triangle";
    harmonic4.frequency.value = 120;
    const h4Gain = ctx.createGain();
    h4Gain.gain.value = 0.1;
    harmonic4.connect(h4Gain).connect(engineGain);

    // Engine low-pass to tame harshness
    const engineLP = ctx.createBiquadFilter();
    engineLP.type = "lowpass";
    engineLP.frequency.value = 1200;
    engineLP.Q.value = 1.2;
    engineGain.disconnect();
    engineGain.connect(engineLP).connect(masterGain);

    // Exhaust: filtered noise for rumble
    exhaustGain = ctx.createGain();
    exhaustGain.gain.value = 0.3;
    exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = "bandpass";
    exhaustFilter.frequency.value = 80;
    exhaustFilter.Q.value = 2.5;
    exhaustFilter2 = ctx.createBiquadFilter();
    exhaustFilter2.type = "lowpass";
    exhaustFilter2.frequency.value = 400;
    exhaustFilter2.Q.value = 0.8;

    const exhaustBuffer = createNoiseBuffer(ctx, 2);
    exhaustNoise = ctx.createBufferSource();
    exhaustNoise.buffer = exhaustBuffer;
    exhaustNoise.loop = true;
    exhaustNoise.connect(exhaustFilter).connect(exhaustFilter2).connect(exhaustGain).connect(masterGain);

    // Intake whoosh: high-passed noise modulated by throttle
    intakeGain = ctx.createGain();
    intakeGain.gain.value = 0;
    intakeFilter = ctx.createBiquadFilter();
    intakeFilter.type = "bandpass";
    intakeFilter.frequency.value = 600;
    intakeFilter.Q.value = 1.5;

    const intakeBuffer = createNoiseBuffer(ctx, 2);
    intakeNoise = ctx.createBufferSource();
    intakeNoise.buffer = intakeBuffer;
    intakeNoise.loop = true;
    intakeNoise.connect(intakeFilter).connect(intakeGain).connect(masterGain);

    // Start all sources
    fundamental.start();
    harmonic2.start();
    harmonic3.start();
    harmonic4.start();
    exhaustNoise.start();
    intakeNoise.start();

    started = true;
  }

  function createNoiseBuffer(audioCtx: AudioContext, duration: number) {
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function update(car: CarState, tuning: CarTuning) {
    if (!ctx || !started) return;
    if (ctx.state === "suspended") ctx.resume();

    const rpm = car.rpm;
    const throttle = car.throttleAxis;
    const rpmNorm = clamp((rpm - tuning.idleRpm) / (tuning.redlineRpm - tuning.idleRpm), 0, 1);

    // Cylinder firing frequency: RPM / 60 * (cylinders/2)
    // Assume 4-cylinder: firing freq = RPM / 60 * 2
    const firingFreq = (rpm / 60) * 2;

    const t = ctx.currentTime + 0.02;
    fundamental.frequency.setTargetAtTime(firingFreq, t, 0.03);
    harmonic2.frequency.setTargetAtTime(firingFreq * 2, t, 0.03);
    harmonic3.frequency.setTargetAtTime(firingFreq * 3, t, 0.03);
    harmonic4.frequency.setTargetAtTime(firingFreq * 4, t, 0.03);

    // Engine volume: louder with throttle and rpm
    const engineVol = 0.12 + throttle * 0.48 + rpmNorm * 0.22;
    engineGain.gain.setTargetAtTime(clamp(engineVol, 0.05, 0.78), t, 0.05);

    // Exhaust: gets louder and higher-pitched with RPM
    const exhaustVol = 0.045 + throttle * 0.32 + rpmNorm * 0.22;
    exhaustGain.gain.setTargetAtTime(clamp(exhaustVol, 0.018, 0.54), t, 0.06);
    exhaustFilter.frequency.setTargetAtTime(60 + rpmNorm * 140, t, 0.04);
    exhaustFilter2.frequency.setTargetAtTime(300 + rpmNorm * 600 + throttle * 200, t, 0.04);

    // Intake: whoosh on high throttle + high rpm
    const intakeVol = throttle * rpmNorm * 0.25;
    intakeGain.gain.setTargetAtTime(clamp(intakeVol, 0, 0.3), t, 0.08);
    intakeFilter.frequency.setTargetAtTime(400 + rpmNorm * 800, t, 0.05);
  }

  function setMuted(value: boolean) {
    muted = value;
    if (ctx && masterGain) {
      masterGain.gain.setTargetAtTime(value ? 0 : 0.28, ctx.currentTime, 0.05);
    }
  }

  function resume() {
    if (!ctx) {
      init();
    }
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      if (!muted) masterGain.gain.setTargetAtTime(0.28, ctx.currentTime + 0.01, 0.05);
    }
  }

  function suspend() {
    if (ctx && masterGain) {
      masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }
  }

  return {
    init,
    update,
    resume,
    suspend,
    setMuted,
    get started() { return started; },
    get muted() { return muted; },
  };
}
