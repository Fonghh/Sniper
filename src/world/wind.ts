import { Vec3, vec3 } from '../core/vec3';
import { createNoise2D, Noise2D } from './noise';

export const MAX_WIND = 5; // m/s

/**
 * Slowly varying wind shared by ballistics and visuals. Direction wanders over minutes,
 * speed stays within 0..MAX_WIND, and exposed high ground is a little windier than
 * sheltered valley floors.
 */
export class Wind {
  private n: Noise2D;

  constructor(seed: number) {
    this.n = createNoise2D(seed + 100);
  }

  /** Base wind (horizontal) at time t in seconds, ignoring terrain exposure. */
  base(t: number): { dir: number; speed: number } {
    const dir = Math.PI * 2 * (0.5 + 0.5 * this.n(t / 240, 0.3));
    const speed = 0.5 + 3.5 * (0.5 + 0.5 * this.n(t / 60, 7.1));
    return { dir, speed };
  }

  /** Wind velocity at a point; `altitude` is height above the valley floor in metres. */
  at(t: number, altitude: number): Vec3 {
    const { dir, speed } = this.base(t);
    const exposure = 0.75 + 0.25 * Math.min(Math.max(altitude / 150, 0), 1);
    const s = Math.min(speed * exposure * 1.15, MAX_WIND);
    return vec3(Math.sin(dir) * s, 0, Math.cos(dir) * s);
  }
}
