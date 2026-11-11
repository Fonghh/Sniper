import { describe, expect, it } from 'vitest';
import { DeerSenses, PlayerSignal, hearingRate, noiseRadius, sightRange, sightRate } from '../src/animals/perception';

// Deer at the origin facing +z (yaw 0), head up.
const deer: DeerSenses = { x: 0, y: 1.4, z: 0, yaw: 0, headDown: false };
const player = (over: Partial<PlayerSignal> = {}): PlayerSignal => ({
  x: 0, y: 1.6, z: 80, prone: false, speed: 2.4, running: false, ...over,
});

describe('deer sight', () => {
  it('sees a walking person in front at 80 m', () => {
    expect(sightRate(deer, player(), true)).toBeGreaterThan(0);
  });

  it('is blocked by terrain', () => {
    expect(sightRate(deer, player(), false)).toBe(0);
  });

  it('has a blind spot directly behind', () => {
    expect(sightRate(deer, player({ z: -30 }), true)).toBe(0);
    expect(sightRate(deer, player({ x: 30, z: 0 }), true)).toBeGreaterThan(0); // side is seen
  });

  it('prone, still, and grazing deer all shrink the range', () => {
    const base = sightRange(deer, player());
    expect(sightRange(deer, player({ prone: true }))).toBeLessThan(base);
    expect(sightRange(deer, player({ speed: 0 }))).toBeLessThan(base);
    expect(sightRange({ ...deer, headDown: true }, player())).toBeLessThan(base);
    expect(sightRange(deer, player({ running: true, speed: 6 }))).toBeGreaterThan(base);
  });

  it('high ground helps: a player well above the deer is harder to see', () => {
    const level = sightRange(deer, player());
    const above = sightRange(deer, player({ y: 40 }));
    expect(above).toBeLessThan(level * 0.5);
  });

  it('a still, prone player on a ridge at 250 m is effectively invisible', () => {
    expect(sightRate(deer, player({ z: 250, y: 120, prone: true, speed: 0 }), true)).toBe(0);
  });
});

describe('deer hearing', () => {
  it('running is loud, walking moderate, crawling quiet, standing still silent', () => {
    expect(noiseRadius(player({ running: true }))).toBeGreaterThan(noiseRadius(player()));
    expect(noiseRadius(player())).toBeGreaterThan(noiseRadius(player({ prone: true })));
    expect(noiseRadius(player({ speed: 0 }))).toBe(0);
  });

  it('hears a walking person nearby but not at 80 m', () => {
    expect(hearingRate(deer, player({ z: 20 }))).toBeGreaterThan(0);
    expect(hearingRate(deer, player())).toBe(0);
  });
});
