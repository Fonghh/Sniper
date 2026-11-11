import { describe, expect, it } from 'vitest';
import { lobAngle, waveRoster } from '../src/arena/monsters';
import { ProjectileState, stepProjectile } from '../src/arena/projectile';

describe('monster waves', () => {
  it('starts with grunts only and adds tougher kinds in later waves', () => {
    expect(waveRoster(1)).toEqual(['grunt', 'grunt', 'grunt', 'grunt', 'grunt']);
    expect(waveRoster(2)).toContain('runner');
    expect(waveRoster(3)).toContain('spitter');
    expect(waveRoster(4)).toContain('brute');
    expect(waveRoster(5).length).toBeGreaterThan(waveRoster(4).length);
  });
});

describe('spitter lob', () => {
  it('finds a low arc that lands near the target without drag', () => {
    const v = 16;
    for (const [d, h] of [[12, 0], [24, -2], [20, 3]]) {
      const a = lobAngle(v, d, h)!;
      expect(a).not.toBeNull();
      let s: ProjectileState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: v * Math.sin(a), z: v * Math.cos(a) }, time: 0 };
      while (s.pos.z < d) s = stepProjectile(s, { drag: 0, gravity: 9.81 });
      expect(Math.abs(s.pos.y - h)).toBeLessThan(0.15);
    }
  });

  it('reports targets beyond reach', () => {
    expect(lobAngle(16, 60, 0)).toBeNull();
  });
});
