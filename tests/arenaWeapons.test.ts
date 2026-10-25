import { describe, expect, it } from 'vitest';
import { WEAPONS, WeaponState, hitDamage, launchSpeed } from '../src/arena/weapons';

function tick(w: WeaponState, seconds: number) {
  const shots = [];
  for (let t = 0; t < seconds; t += 1 / 60) shots.push(...w.update(1 / 60));
  return shots;
}

describe('rifle', () => {
  it('fires on press and keeps firing while held at its fire rate', () => {
    const w = new WeaponState(WEAPONS.rifle);
    expect(w.triggerDown()).not.toBeNull();
    const auto = tick(w, 1);
    expect(auto.length).toBeGreaterThanOrEqual(5);
    expect(auto.length).toBeLessThanOrEqual(7);
    w.triggerUp();
    expect(tick(w, 0.5)).toEqual([]);
  });

  it('reloads after emptying the magazine', () => {
    const w = new WeaponState(WEAPONS.rifle);
    w.triggerDown();
    tick(w, WEAPONS.rifle.magazine * WEAPONS.rifle.interval + 0.05);
    w.triggerUp();
    expect(w.ammo).toBe(0);
    expect(w.reloading).toBe(true);
    tick(w, WEAPONS.rifle.reload + 0.1);
    expect(w.ammo).toBe(WEAPONS.rifle.magazine);
  });

  it('a headshot is a one-shot kill, body shots take three', () => {
    const shot = { weapon: WEAPONS.rifle, power: 1 };
    expect(hitDamage(shot, true)).toBeGreaterThanOrEqual(100);
    expect(hitDamage(shot, false) * 3).toBeGreaterThanOrEqual(100);
  });
});

describe('bow', () => {
  it('draw time sets arrow speed and damage', () => {
    const w = new WeaponState(WEAPONS.bow);
    w.triggerDown();
    tick(w, 0.3);
    const quick = w.triggerUp()!;
    tick(w, 1);
    w.triggerDown();
    tick(w, 1.2);
    const full = w.triggerUp()!;
    expect(full.power).toBe(1);
    expect(quick.power).toBeLessThan(0.5);
    expect(launchSpeed(full)).toBeGreaterThan(launchSpeed(quick));
    expect(hitDamage(full, false)).toBeGreaterThan(hitDamage(quick, false));
  });

  it('a tap without drawing does not shoot', () => {
    const w = new WeaponState(WEAPONS.bow);
    w.triggerDown();
    tick(w, 0.05);
    expect(w.triggerUp()).toBeNull();
  });
});

describe('grenade', () => {
  it('throws on release, can be cancelled, and regenerates over time', () => {
    const w = new WeaponState(WEAPONS.grenade);
    w.triggerDown();
    expect(w.triggerUp(true)).toBeNull();
    expect(w.ammo).toBe(3);
    w.triggerDown();
    expect(w.triggerUp()).not.toBeNull();
    expect(w.ammo).toBe(2);
    tick(w, WEAPONS.grenade.reload + 0.1);
    expect(w.ammo).toBe(3);
  });
});
