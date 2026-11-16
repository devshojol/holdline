import { describe, expect, it } from 'vitest';
import { splitSteps, trimSilence } from '../src/game/audio/AudioEngine';

/** Minimal stand-ins for AudioBuffer / BaseAudioContext (enough for the trimming helpers). */
class FakeBuffer {
  readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
  copyToChannel(src: Float32Array, c: number) {
    this.data[c].set(src);
  }
}
const ctx = { createBuffer: (ch: number, len: number, rate: number) => new FakeBuffer(ch, len, rate) } as unknown as BaseAudioContext;
const RATE = 8000;

/** A take with decaying 120 Hz thumps at the given times (seconds). */
function take(seconds: number, hits: number[]): AudioBuffer {
  const b = new FakeBuffer(2, Math.floor(seconds * RATE), RATE);
  for (const t of hits) {
    const s = Math.floor(t * RATE);
    for (let i = 0; i < 0.12 * RATE && s + i < b.length; i++) {
      const v = Math.sin((2 * Math.PI * 120 * i) / RATE) * Math.exp(-i / (0.03 * RATE)) * 0.8;
      b.data[0][s + i] += v;
      b.data[1][s + i] += v;
    }
  }
  return b as unknown as AudioBuffer;
}

describe('recording clean-up', () => {
  it('trims leading and trailing silence', () => {
    const out = trimSilence(ctx, take(3, [0.5]));
    expect(out.duration).toBeLessThan(0.25);
    expect(Math.abs(out.getChannelData(0)[Math.floor(0.01 * RATE)])).toBeGreaterThan(0);
  });

  it('cuts a walking take into single steps', () => {
    const hits = [0.5, 1.0, 1.55, 2.05, 2.6, 3.1];
    const steps = splitSteps(ctx, take(4, hits));
    expect(steps.length).toBe(hits.length);
    for (const s of steps) expect(s.duration).toBeLessThanOrEqual(0.4);
  });

  it('keeps a heel-and-toe pair as one step', () => {
    const steps = splitSteps(ctx, take(3, [0.5, 0.58, 1.2, 1.28, 1.9, 1.98]));
    expect(steps.length).toBe(3);
  });
});

describe('weighStep', () => {
  const sr = 44100;
  /** A thin, quiet step: 60 ms of decaying high-passed noise at a tenth of full level. */
  function thinStep() {
    const x = new Float32Array(Math.floor(0.06 * sr));
    let seed = 7;
    let low = 0;
    for (let i = 0; i < x.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = seed / 2147483648 - 1;
      low += 0.2 * (n - low);
      x[i] = (n - low) * 0.1 * Math.exp(-i / (0.015 * sr));
    }
    return x;
  }
  const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  /** Energy below ~200 Hz (one-pole low-pass). */
  const lowRms = (x: Float32Array) => {
    const a = 1 - Math.exp((-2 * Math.PI * 200) / sr);
    let y = 0;
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      y += a * (x[i] - y);
      sum += y * y;
    }
    return Math.sqrt(sum / x.length);
  };

  it('brings a quiet step up to full level and gives it low end', async () => {
    const { weighStep } = await import('../src/game/audio/AudioEngine');
    const thin = thinStep();
    const heavy = weighStep(thin, sr, 'stone');
    const peak = heavy.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThanOrEqual(1);
    expect(rms(heavy)).toBeGreaterThan(rms(thin) * 4);
    expect(lowRms(heavy)).toBeGreaterThan(lowRms(thin) * 5);
    // ends silent, so steps never click
    expect(Math.abs(heavy[heavy.length - 1])).toBeLessThan(0.01);
  });

  it('makes a different sound for each surface, metal ringing longest', async () => {
    const { weighStep } = await import('../src/game/audio/AudioEngine');
    const thin = thinStep();
    const stone = weighStep(thin, sr, 'stone');
    const wood = weighStep(thin, sr, 'wood');
    const metal = weighStep(thin, sr, 'metal');
    expect(metal.length).toBeGreaterThan(stone.length);
    const tail = (x: Float32Array) => rms(x.subarray(Math.floor(0.12 * sr), Math.floor(0.2 * sr)));
    expect(tail(metal)).toBeGreaterThan(0.01);
    let diff = 0;
    for (let i = 0; i < stone.length; i++) diff += Math.abs(stone[i] - wood[i]);
    expect(diff / stone.length).toBeGreaterThan(0.01);
  });
});

describe('gateStep', () => {
  const sr = 44100;
  it('keeps the step and removes the room noise around it', async () => {
    const { gateStep, weighStep } = await import('../src/game/audio/AudioEngine');
    // 0.4 s of steady background noise with one short, loud step 50 ms in
    const x = new Float32Array(Math.floor(0.4 * sr));
    let seed = 3;
    const noise = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2147483648 - 1;
    };
    const start = Math.floor(0.05 * sr);
    for (let i = 0; i < x.length; i++) {
      x[i] = noise() * 0.03;
      if (i >= start) x[i] += noise() * 0.6 * Math.exp(-(i - start) / (0.012 * sr));
    }
    const rms = (a: Float32Array, from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += a[i] * a[i];
      return Math.sqrt(sum / (to - from));
    };
    const gated = gateStep(x, sr);
    // only the step is left: the lead-in and the trailing room tone are gone
    expect(gated.length).toBeLessThan(0.2 * sr);
    expect(rms(gated, 0, Math.floor(0.012 * sr))).toBeGreaterThan(rms(x, start, start + Math.floor(0.012 * sr)) * 0.7);
    expect(rms(gated, gated.length - Math.floor(0.02 * sr), gated.length)).toBeLessThan(0.005);
    // brought up to full level, the finished step still ends in silence rather than amplified noise
    const heavy = weighStep(x, sr, 'stone');
    expect(heavy.length).toBeLessThan(0.3 * sr);
    expect(rms(heavy, heavy.length - Math.floor(0.03 * sr), heavy.length)).toBeLessThan(0.03);
  });
});
