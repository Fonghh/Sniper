import { describe, expect, it } from 'vitest';
import { AMMO } from '../src/ballistics/ammo';
import {
  DEFAULT_ENV,
  FlightEnv,
  GRAVITY,
  trajectory,
  zeroElevation,
} from '../src/ballistics/ballistics';
import { g7Cd } from '../src/ballistics/dragG7';
import { vec3 } from '../src/core/vec3';

const sp = AMMO['308-sp-165'];
const RANGES = [100, 200, 300, 400];

describe('G7 drag table', () => {
  it('peaks just above Mach 1 and is flat subsonic', () => {
    expect(g7Cd(0.5)).toBeCloseTo(0.1194, 4);
    expect(g7Cd(1.05)).toBeGreaterThan(g7Cd(0.9));
    expect(g7Cd(1.05)).toBeGreaterThan(g7Cd(2.0));
  });

  it('interpolates between table points and clamps at the ends', () => {
    expect(g7Cd(1.0125)).toBeCloseTo((0.3803 + 0.4015) / 2, 4);
    expect(g7Cd(-1)).toBe(g7Cd(0));
    expect(g7Cd(99)).toBe(g7Cd(5));
  });
});

describe('trajectory', () => {
  const zero100 = zeroElevation(sp, 100);

  it('crosses the line of sight at the zero range', () => {
    for (const zero of [100, 200, 300, 400]) {
      const el = zeroElevation(sp, zero);
      const [s] = trajectory(sp, el, [zero]);
      expect(Math.abs(s.drop)).toBeLessThan(0.001);
    }
  });

  it('matches published .308 165gr drop with a 100 m zero (±25%)', () => {
    // Reference values derived from common factory .308 165gr ballistic charts.
    const expected: Record<number, number> = { 200: -0.13, 300: -0.47, 400: -1.05 };
    const samples = trajectory(sp, zero100, RANGES);
    for (const s of samples) {
      if (!(s.range in expected)) continue;
      const ref = expected[s.range];
      expect(s.drop).toBeLessThan(ref * 0.75);
      expect(s.drop).toBeGreaterThan(ref * 1.25);
    }
  });

  it('loses velocity and energy monotonically', () => {
    const samples = trajectory(sp, zero100, RANGES);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].velocity).toBeLessThan(samples[i - 1].velocity);
      expect(samples[i].energy).toBeLessThan(samples[i - 1].energy);
    }
    // .308 stays supersonic well past the 400 m the map allows.
    expect(samples[samples.length - 1].velocity).toBeGreaterThan(450);
  });

  it('drops more than a vacuum trajectory would', () => {
    const [s] = trajectory(sp, 0, [300], { sightHeight: 0 });
    const vacuumDrop = -0.5 * GRAVITY * (300 / sp.muzzleVelocity) ** 2;
    expect(s.drop).toBeLessThan(vacuumDrop);
  });

  it('drifts downwind, roughly 20–30 cm at 300 m in a 4.5 m/s full crosswind', () => {
    const env: FlightEnv = { ...DEFAULT_ENV, wind: () => vec3(4.47, 0, 0) };
    const [calm] = trajectory(sp, zero100, [300]);
    const [windy] = trajectory(sp, zero100, [300], { env });
    expect(calm.drift).toBeCloseTo(0, 6);
    expect(windy.drift).toBeGreaterThan(0.2);
    expect(windy.drift).toBeLessThan(0.3);
  });

  it('flight time is long enough to require lead on moving targets', () => {
    const [s] = trajectory(sp, zero100, [250]);
    // A deer running at 10 m/s moves several metres while the bullet is in flight.
    expect(s.time * 10).toBeGreaterThan(3);
  });

  it('is stable with respect to the integration step', () => {
    const [coarse] = trajectory(sp, zero100, [400], { dt: 0.005 });
    const [fine] = trajectory(sp, zero100, [400], { dt: 0.0005 });
    expect(Math.abs(coarse.drop - fine.drop)).toBeLessThan(0.002);
  });
});
