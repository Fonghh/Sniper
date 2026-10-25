import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { hitZone } from '../src/arena/hitbox';
import { Projectiles } from '../src/arena/projectiles';
import type { Hittable } from '../src/arena/targets';
import { WEAPONS } from '../src/arena/weapons';
import { ArenaWorld } from '../src/arena/world';

vi.mock('../src/vfx/fireball', () => ({
  default: () => ({ group: new THREE.Group(), update() {}, hit() {}, dispose() {}, finished: true }),
}));

function dummy(pos: THREE.Vector3): Hittable & { hp: number } {
  return {
    hp: 100,
    get alive() {
      return this.hp > 0;
    },
    position: pos,
    test(a, b) {
      return hitZone({ x: a.x - pos.x, y: a.y - pos.y, z: a.z - pos.z }, { x: b.x - pos.x, y: b.y - pos.y, z: b.z - pos.z });
    },
    damage(n) {
      this.hp -= n;
      return this.hp <= 0;
    },
  };
}

describe('arena projectiles', () => {
  const scene = new THREE.Scene();
  const world = new ArenaWorld(scene, 7);
  world.layout(true);

  it('a grenade lobbed toward a target explodes next to it and hurts it', () => {
    const from = world.at(0, -45);
    const target = dummy(world.at(0.5, -17));
    const sys = new Projectiles(scene, world, () => [target]);
    const hits: number[] = [];
    sys.onHit = (e) => hits.push(e.damage);
    const origin = from.clone().setY(from.y + 1.6);
    // Aim 0.45 rad up: lands about 28 m out.
    sys.fire({ weapon: WEAPONS.grenade, power: 1 }, origin, new THREE.Vector3(0, Math.sin(0.45), Math.cos(0.45)), null, true);
    for (let i = 0; i < 200; i++) sys.update(1 / 60);
    expect(hits.length).toBe(1);
    expect(target.hp).toBeLessThan(80);
  });

  it('a rifle bullet hits a target 30 m away', () => {
    const from = world.at(0, -45);
    const target = dummy(world.at(0, -15));
    const sys = new Projectiles(scene, world, () => [target]);
    const zones: string[] = [];
    sys.onHit = (e) => zones.push(e.zone);
    const origin = from.clone().setY(from.y + 1.6);
    const aim = target.position.clone().setY(target.position.y + 1.2).sub(origin).normalize();
    sys.fire({ weapon: WEAPONS.rifle, power: 1 }, origin, aim, null, true);
    for (let i = 0; i < 30; i++) sys.update(1 / 60);
    expect(zones).toEqual(['torso']);
  });
});
