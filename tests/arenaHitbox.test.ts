import { describe, expect, it } from 'vitest';
import { hitZone, segmentBox } from '../src/arena/hitbox';

const shot = (y: number, x = 0) => hitZone({ x, y, z: -5 }, { x, y, z: 5 });

describe('humanoid hit zones', () => {
  it('distinguishes head, torso and legs', () => {
    expect(shot(1.62)?.zone).toBe('head');
    expect(shot(1.2)?.zone).toBe('torso');
    expect(shot(0.5)?.zone).toBe('legs');
  });

  it('misses above the head and beside the body', () => {
    expect(shot(1.9)).toBeNull();
    expect(shot(1.2, 0.6)).toBeNull();
  });

  it('reports the nearest zone first', () => {
    // Coming down from above, the head is struck before the torso.
    const h = hitZone({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(h?.zone).toBe('head');
  });

  it('box test finds the entry point', () => {
    const t = segmentBox({ x: -2, y: 0.5, z: 0 }, { x: 2, y: 0.5, z: 0 }, { x: -1, y: 0, z: -1 }, { x: 1, y: 1, z: 1 });
    expect(t).toBeCloseTo(0.25);
  });
});
