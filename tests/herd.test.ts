import { describe, expect, it } from 'vitest';
import { Herd, createHerd } from '../src/animals/herd';
import type { PlayerSignal } from '../src/animals/perception';
import { mulberry32 } from '../src/world/random';
import { Terrain } from '../src/world/terrain';

const terrain = new Terrain(1234);
const spawn = terrain.spawnPoint();
const hidden: PlayerSignal = { x: spawn.x, y: terrain.height(spawn.x, spawn.z) + 0.35, z: spawn.z, prone: true, speed: 0, running: false };

function setup() {
  const deer = createHerd(terrain, spawn.target, 5, 99);
  return { deer, herd: new Herd(deer, terrain, mulberry32(1)) };
}

describe('herd', () => {
  it('a hidden, still hunter on the ridge does not disturb the grazing herd', () => {
    const { deer, herd } = setup();
    for (let t = 0; t < 30; t += 0.05) herd.update(0.05, hidden);
    expect(deer.every((d) => d.brain.behavior !== 'flee')).toBe(true);
  });

  it('deer only react to a gunshot after the sound reaches them', () => {
    const { deer, herd } = setup();
    herd.gunshot({ x: spawn.x, z: spawn.z });
    // 0.5 s later the bullet (≈0.45 s flight to ~300 m) has landed but the sound has not arrived.
    for (let t = 0; t < 0.5; t += 0.05) herd.update(0.05, hidden);
    expect(deer.every((d) => d.brain.behavior !== 'flee')).toBe(true);
    for (let t = 0; t < 1.5; t += 0.05) herd.update(0.05, hidden);
    expect(deer.every((d) => d.brain.behavior === 'flee')).toBe(true);
  });

  it('one bolting deer sets off its herd-mates', () => {
    const { deer, herd } = setup();
    deer[0].scare({ x: spawn.x, z: spawn.z });
    for (let t = 0; t < 1; t += 0.05) herd.update(0.05, hidden);
    expect(deer.filter((d) => d.brain.behavior === 'flee').length).toBeGreaterThan(1);
  });
});
