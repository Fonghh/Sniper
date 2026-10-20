import { describe, expect, it } from 'vitest';
import { length } from '../src/core/vec3';
import { createNoise2D } from '../src/world/noise';
import { HALF_MAP, Terrain, WATER_LEVEL } from '../src/world/terrain';
import { MAX_WIND, Wind } from '../src/world/wind';

describe('noise', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createNoise2D(7);
    const b = createNoise2D(7);
    const c = createNoise2D(8);
    expect(a(12.3, 4.5)).toBe(b(12.3, 4.5));
    expect(a(12.3, 4.5)).not.toBe(c(12.3, 4.5));
  });
});

describe('terrain', () => {
  const terrain = new Terrain(1234);
  const samples: number[] = [];
  for (let x = -HALF_MAP + 80; x <= HALF_MAP - 80; x += 20)
    for (let z = -HALF_MAP + 80; z <= HALF_MAP - 80; z += 20) samples.push(terrain.height(x, z));

  it('has 140–210 m of relief inside the playable area', () => {
    const relief = Math.max(...samples) - Math.min(...samples);
    expect(relief).toBeGreaterThan(140);
    expect(relief).toBeLessThan(210);
  });

  it('has water in the river and is dry on the flanks', () => {
    const z = 0;
    expect(terrain.height(terrain.riverX(z), z)).toBeLessThan(WATER_LEVEL);
    expect(terrain.height(terrain.riverX(z) + 250, z)).toBeGreaterThan(50);
  });

  it('spawns high above the valley with a clear 200–350 m view of the target meadow', () => {
    for (const seed of [1234, 1, 42, 999]) {
      const t = new Terrain(seed);
      const s = t.spawnPoint();
      const eye = t.height(s.x, s.z) + 1.65;
      const ty = t.height(s.target.x, s.target.z) + 1;
      const range = Math.hypot(s.target.x - s.x, s.target.z - s.z);
      expect(eye - ty).toBeGreaterThan(60);
      expect(range).toBeGreaterThanOrEqual(200);
      expect(range).toBeLessThanOrEqual(350);
      expect(t.lineOfSight(s.x, eye, s.z, s.target.x, ty, s.target.z, 2)).toBe(true);
      expect(s.pitch).toBeLessThan(0);
    }
  });
});

describe('wind', () => {
  it('stays within 0..MAX_WIND and varies over time', () => {
    const wind = new Wind(5);
    const speeds = [];
    for (let t = 0; t < 1200; t += 7) speeds.push(length(wind.at(t, 100)));
    expect(Math.max(...speeds)).toBeLessThanOrEqual(MAX_WIND + 1e-9);
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
  });

  it('is calmer in the valley than on the ridge', () => {
    const wind = new Wind(5);
    expect(length(wind.at(30, 0))).toBeLessThan(length(wind.at(30, 170)));
  });
});
