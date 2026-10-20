import { describe, expect, it } from 'vitest';
import { BRAIN, BodyState, DeerBrain, World } from '../src/animals/brain';
import type { PlayerSignal } from '../src/animals/perception';
import { mulberry32 } from '../src/world/random';

const flat: World = { height: () => 0, limit: 430, lineOfSight: () => true };
const healthy: BodyState = { canMove: true, wounded: false, speedScale: 1 };
const wounded: BodyState = { canMove: true, wounded: true, speedScale: 0.8 };

function run(b: DeerBrain, seconds: number, body = healthy, world = flat, player: PlayerSignal | null = null) {
  const yaws: number[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    b.update(0.05, world, body, player);
    yaws.push(b.yaw);
  }
  return yaws;
}

const far: PlayerSignal = { x: 0, y: 200, z: 400, prone: true, speed: 0, running: false };

describe('deer behaviour', () => {
  it('a scared healthy deer flees 150–250 m, then stops and stays alert', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(1));
    b.scare({ x: 0, z: -50 }, healthy);
    expect(b.behavior).toBe('flee');
    run(b, 40, healthy, flat, far);
    const dist = Math.hypot(b.x, b.z);
    expect(dist).toBeGreaterThan(140);
    expect(dist).toBeLessThan(270);
    expect(['alert', 'graze']).toContain(b.behavior);
    expect(b.speed).toBeLessThan(1);
  });

  it('flees away from the threat', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(2));
    b.scare({ x: 0, z: -50 }, healthy);
    run(b, 10);
    expect(b.z).toBeGreaterThan(40);
  });

  it('zigzags while fleeing (heading keeps changing)', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(3));
    b.scare({ x: 0, z: -50 }, healthy);
    const yaws = run(b, 8);
    const min = Math.min(...yaws.slice(20));
    const max = Math.max(...yaws.slice(20));
    expect(max - min).toBeGreaterThan(0.5);
  });

  it('a wounded deer runs at most ~150 m and beds down', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(4));
    b.scare({ x: 0, z: -50 }, wounded);
    run(b, 40, wounded, flat, far);
    expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(BRAIN.woundedFleeDistance[1] + 15);
    expect(b.behavior).toBe('bedded');
  });

  it('a bedded deer bolts again when the hunter gets close', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(5));
    b.scare({ x: 0, z: -50 }, wounded);
    run(b, 40, wounded, flat, far);
    const near: PlayerSignal = { x: b.x + 10, y: 1.6, z: b.z, prone: false, speed: 2.4, running: false };
    b.update(0.05, flat, wounded, near);
    expect(b.behavior).toBe('flee');
  });

  it('stays inside the map when chased toward the edge', () => {
    const b = new DeerBrain(400, 0, Math.PI / 2, mulberry32(6));
    b.scare({ x: 300, z: 0 }, healthy);
    run(b, 30);
    expect(Math.abs(b.x)).toBeLessThanOrEqual(flat.limit);
    expect(Math.abs(b.z)).toBeLessThanOrEqual(flat.limit);
  });

  it('a hunter walking up in the open is noticed and the deer flees', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(7));
    const walker: PlayerSignal = { x: 0, y: 1.6, z: 60, prone: false, speed: 2.4, running: false };
    run(b, 10, healthy, flat, walker);
    expect(['alert', 'flee']).toContain(b.behavior);
  });

  it('a still, prone hunter on a ridge 250 m away goes unnoticed', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(8));
    run(b, 30, healthy, flat, { x: 0, y: 120, z: 250, prone: true, speed: 0, running: false });
    expect(b.behavior).toBe('graze');
  });

  it('does not move once down', () => {
    const b = new DeerBrain(0, 0, 0, mulberry32(9));
    b.scare({ x: 0, z: -50 }, healthy);
    run(b, 1);
    const x = b.x;
    const z = b.z;
    run(b, 5, { canMove: false, wounded: true, speedScale: 0 });
    expect(b.behavior).toBe('down');
    expect(Math.hypot(b.x - x, b.z - z)).toBeLessThan(1.5); // only the deceleration step
  });
});
