import { describe, expect, it } from 'vitest';
import { dropAt, stepProjectile, traceArc } from '../src/arena/projectile';
import { WEAPONS } from '../src/arena/weapons';
import { Terrain } from '../src/world/terrain';

describe('arena projectiles', () => {
  it('rifle drop is small up close and noticeable at range', () => {
    const r = WEAPONS.rifle;
    const near = dropAt(r.speed, r.projectile, 20);
    const far = dropAt(r.speed, r.projectile, 80);
    expect(Math.abs(near)).toBeLessThan(0.1);
    expect(far).toBeLessThan(-0.4); // must hold over at 80 m
    expect(far).toBeGreaterThan(-1.2);
  });

  it('a fully drawn arrow arcs clearly at 30 m; a half-drawn one much more', () => {
    const b = WEAPONS.bow;
    const full = dropAt(b.speed, b.projectile, 30);
    const half = dropAt(b.minSpeed + (b.speed - b.minSpeed) * 0.5, b.projectile, 30);
    expect(full).toBeLessThan(-0.6);
    expect(half).toBeLessThan(full * 1.5);
  });

  it('the grenade preview lands exactly where the grenade does', () => {
    const g = WEAPONS.grenade;
    const start = { pos: { x: 0, y: 1.6, z: 0 }, vel: { x: 0, y: g.speed * 0.5, z: g.speed * 0.87 }, time: 0 };
    const ground = (a: { y: number }, b: { y: number }) => b.y <= 0 && a.y > 0;
    const arc = traceArc(start, g.projectile, ground);
    let s = start;
    while (!(s.pos.y > 0 && stepProjectile(s, g.projectile).pos.y <= 0)) s = stepProjectile(s, g.projectile);
    const landing = stepProjectile(s, g.projectile).pos;
    const last = arc[arc.length - 1];
    expect(Math.hypot(last.x - landing.x, last.z - landing.z)).toBeLessThan(1e-9);
    expect(landing.z).toBeGreaterThan(15);
    expect(landing.z).toBeLessThan(40);
  });

  it('drag slows a projectile over distance', () => {
    const r = WEAPONS.rifle;
    let s = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: r.speed }, time: 0 };
    while (s.pos.z < 80) s = stepProjectile(s, r.projectile);
    expect(Math.hypot(s.vel.x, s.vel.y, s.vel.z)).toBeLessThan(r.speed * 0.98);
  });
});

describe('flattened terrain', () => {
  it('relief scales the hills', () => {
    const full = new Terrain(1234);
    const flat = new Terrain(1234, 0.12);
    const span = (t: Terrain) => {
      const hs: number[] = [];
      for (let x = 100; x <= 220; x += 10) for (let z = -60; z <= 60; z += 10) hs.push(t.height(x, z));
      return Math.max(...hs) - Math.min(...hs);
    };
    expect(span(flat)).toBeLessThan(span(full) * 0.2);
  });
});
