import { describe, expect, it } from 'vitest';
import { STABILITY, Stability } from '../src/game/stability';

function run(s: Stability, seconds: number, running: boolean) {
  for (let t = 0; t < seconds; t += 0.05) s.update(0.05, running);
}

describe('stability', () => {
  it('orders postures: standing > standing rested > prone', () => {
    const s = new Stability();
    expect(s.amplitude('stand', false)).toBeGreaterThan(s.amplitude('stand', true));
    expect(s.amplitude('stand', true)).toBeGreaterThan(s.amplitude('prone', false));
  });

  it('running raises heart rate and sway, which recover within ~8 s', () => {
    const s = new Stability();
    const calm = s.amplitude('prone', false);
    run(s, 5, true);
    expect(s.heartRate).toBeGreaterThan(140);
    expect(s.amplitude('prone', false)).toBeGreaterThan(calm * 2);
    run(s, 8, false);
    expect(s.heartRate).toBeLessThan(STABILITY.restingHeartRate + 5);
  });

  it('holding breath steadies the aim but runs out and then exhausts', () => {
    const s = new Stability();
    const normal = s.amplitude('prone', false);
    expect(s.startHold()).toBe(true);
    expect(s.amplitude('prone', false)).toBeCloseTo(normal * STABILITY.holdFactor);
    run(s, STABILITY.holdMax + 0.2, false);
    expect(s.holding).toBe(false);
    expect(s.exhausted).toBeGreaterThan(0);
    expect(s.amplitude('prone', false)).toBeGreaterThan(normal);
    expect(s.startHold()).toBe(false);
  });

  it('breath reserve recovers after releasing', () => {
    const s = new Stability();
    s.startHold();
    run(s, 3, false);
    s.endHold();
    const after = s.stamina;
    run(s, 2, false);
    expect(s.stamina).toBeGreaterThan(after);
  });

  it('sway offset stays within a bounded envelope', () => {
    const s = new Stability();
    let max = 0;
    for (let i = 0; i < 400; i++) {
      s.update(0.05, false);
      const o = s.offset('stand', false);
      max = Math.max(max, Math.abs(o.yaw), Math.abs(o.pitch));
    }
    expect(max).toBeLessThan(s.amplitude('stand', false) * 1.6);
    expect(max).toBeGreaterThan(0);
  });
});
