import { describe, expect, it } from 'vitest';
import { waveHp, waveRoster } from '../src/archer/enemies';
import { SKILLS, bowStats, drawCards, rankFor } from '../src/archer/skills';
import { mulberry32 } from '../src/world/random';

describe('archer skills', () => {
  it('stacks cards into bow stats', () => {
    const base = bowStats({});
    expect(base.arrows).toBe(1);
    const built = bowStats({ rapid: 2, multishot: 2, power: 1, crossbow: 1, giant: 1 });
    expect(built.interval).toBeLessThan(base.interval);
    expect(built.arrows).toBe(3);
    expect(built.damage).toBeGreaterThan(base.damage * 1.6);
    expect(built.speed).toBeGreaterThan(base.speed); // crossbow shoots flatter
    expect(built.giantEvery).toBe(5);
  });

  it('draws three different cards and stops offering maxed ones', () => {
    const rand = mulberry32(1);
    const cards = drawCards({}, rand);
    expect(new Set(cards).size).toBe(3);
    const maxed = { crossbow: 1 };
    for (let i = 0; i < 50; i++) expect(drawCards(maxed, rand)).not.toContain('crossbow');
    expect(SKILLS.heal.max).toBeGreaterThan(10);
  });

  it('ranks up with cleared waves', () => {
    expect(rankFor(0)).toBe('NOOB');
    expect(rankFor(4)).toBe('PRO');
    expect(rankFor(20)).toBe('ARCHERO');
  });
});

describe('archer waves', () => {
  it('grows and brings a boss every fifth wave', () => {
    expect(waveRoster(1).every((k) => k === 'grunt')).toBe(true);
    expect(waveRoster(3)).toContain('shield');
    expect(waveRoster(5)).toContain('boss');
    expect(waveRoster(6)).not.toContain('boss');
    expect(waveRoster(8).length).toBeGreaterThan(waveRoster(4).length);
    expect(waveHp(5)).toBeGreaterThan(waveHp(1));
  });
});

import { CORRIDOR_LEN, STRIDE, ZONE_LEN, zoneLayout } from '../src/archer/level';

describe('archer level', () => {
  it('runs forward in clearings with a gate in each corridor', () => {
    for (let i = 0; i < 6; i++) {
      const { zone } = zoneLayout(11, i);
      expect(zone.z0).toBe(i * STRIDE);
      expect(zone.z1).toBe(zone.z0 + ZONE_LEN);
      const gz = (zone.gate.min.z + zone.gate.max.z) / 2;
      expect(gz).toBeGreaterThan(zone.z1);
      expect(gz).toBeLessThan(zone.z1 + CORRIDOR_LEN);
    }
  });

  it('has platforms for shooters from the second clearing, and forks every third', () => {
    expect(zoneLayout(11, 0).zone.platforms.length).toBe(0);
    for (let i = 1; i < 8; i++) {
      const { zone } = zoneLayout(11, i);
      expect(zone.platforms.length).toBeGreaterThan(0);
      for (const p of zone.platforms) expect(p.max.y).toBeGreaterThanOrEqual(3.5);
    }
    expect(zoneLayout(11, 2).zone.fork).toBe(true);
    expect(zoneLayout(11, 2).boxes.some((b) => b.kind === 'block')).toBe(true);
  });
});
