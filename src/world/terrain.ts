import { createNoise2D, fbm, Noise2D } from './noise';

export const MAP_SIZE = 1000; // m, square map centred on the origin
export const HALF_MAP = MAP_SIZE / 2;
export const WATER_LEVEL = 1.5;

export interface SpawnPoint {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** The meadow the opening herd grazes on. */
  target: { x: number; z: number };
}

/**
 * Procedural heightfield shaped for portrait-mode hunting: a meandering river valley
 * through the middle, ridges on both flanks and broken slopes in between, giving
 * roughly 150–200 m of relief. Pure and deterministic for a given seed.
 */
export class Terrain {
  private detail: Noise2D;
  private ridge: Noise2D;
  private meander: Noise2D;
  readonly seed: number;

  /**
   * `relief` scales the hills (1 = the hunting valley). A low value flattens the same landscape,
   * e.g. for close-quarters arenas; the riverbed and map rim are unchanged.
   */
  constructor(
    seed: number,
    readonly relief = 1,
  ) {
    this.seed = seed;
    this.detail = createNoise2D(seed);
    this.ridge = createNoise2D(seed + 1);
    this.meander = createNoise2D(seed + 2);
  }

  /** X coordinate of the river centreline at a given z. */
  riverX(z: number): number {
    return 140 * this.meander(z / 600, 0.5) + 60 * this.meander(z / 180, 3.7);
  }

  height(x: number, z: number): number {
    const d = Math.abs(x - this.riverX(z));
    // Valley profile: flat floor, steepening flanks, rounded ridge tops.
    const t = Math.min(d / 360, 1);
    const profile = 150 * (t * t * (3 - 2 * t));
    // Ridged noise breaks the flanks into spurs, gullies and cliffs.
    const r = 1 - Math.abs(this.ridge(x / 260, z / 260));
    const ridged = 40 * r * r * Math.min(d / 120, 1);
    // Detail fades out near the river so the valley floor stays flat and wet.
    const detail = 9 * fbm(this.detail, x / 90, z / 90, 4) * Math.min(d / 60, 1);
    // Carve the riverbed below the water line.
    const bed = d < 14 ? -4 * (1 - d / 14) : 0;
    // Raise the outer border so the playable area feels enclosed.
    const edge = Math.max(Math.abs(x), Math.abs(z)) - (HALF_MAP - 60);
    const rim = edge > 0 ? (edge / 60) ** 2 * 40 : 0;
    return 2 + (profile + ridged + detail) * this.relief + bed + rim;
  }

  /** Surface slope as rise over run (0 = flat). */
  slope(x: number, z: number, eps = 1): number {
    const dx = this.height(x + eps, z) - this.height(x - eps, z);
    const dz = this.height(x, z + eps) - this.height(x, z - eps);
    return Math.hypot(dx, dz) / (2 * eps);
  }

  /** True if the straight segment between two points clears the ground by `clearance` metres. */
  lineOfSight(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    clearance = 1,
  ): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (ay + (by - ay) * t < this.height(x, z) + clearance) return false;
    }
    return true;
  }

  /**
   * Good opening positions: high on a flank with a clear view down to a valley meadow
   * 200–350 m away, where the herd will graze. Sorted best first and spread at least
   * `spacing` metres apart so each hunt can start somewhere different.
   * Yaw/pitch (Three.js convention: yaw 0 looks toward -z) aim the camera at the meadow.
   */
  spawnPoints(count: number, spacing = 150): SpawnPoint[] {
    const candidates: Array<{ score: number; x: number; z: number; tx: number; tz: number }> = [];
    for (const side of [1, -1]) {
      for (let z = -320; z <= 320; z += 40) {
        for (let dx = 150; dx <= 330; dx += 30) {
          const x = this.riverX(z) + side * dx;
          if (Math.abs(x) > HALF_MAP - 90) continue;
          const eye = this.height(x, z) + 1.65;
          let best: { score: number; x: number; z: number; tx: number; tz: number } | null = null;
          for (const tzOff of [-200, -120, 0, 120, 200]) {
            const tz = z + tzOff;
            if (Math.abs(tz) > HALF_MAP - 90) continue;
            // Target on the meadow beside the river, on the spawn side.
            const tx = this.riverX(tz) + side * 30;
            const range = Math.hypot(tx - x, tz - z);
            if (range < 200 || range > 350) continue;
            const ty = this.height(tx, tz) + 1;
            const drop = eye - ty;
            if (drop < 60) continue;
            if (!this.lineOfSight(x, eye, z, tx, ty, tz, 2)) continue;
            // Prefer a commanding but not extreme angle, and ranges near the middle of the band.
            const score = Math.min(drop, 140) - Math.abs(range - 270) * 0.3;
            if (!best || score > best.score) best = { score, x, z, tx, tz };
          }
          if (best) candidates.push(best);
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const picked: typeof candidates = [];
    for (const c of candidates) {
      if (picked.length >= count) break;
      if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= spacing)) picked.push(c);
    }
    if (!picked.length) {
      const z = 0;
      const x = this.riverX(z) + 250;
      picked.push({ score: 0, x, z, tx: this.riverX(z - 250), tz: z - 250 });
    }
    return picked.map(({ x, z, tx, tz }) => {
      const dy = this.height(tx, tz) + 1 - (this.height(x, z) + 1.65);
      const flat = Math.hypot(tx - x, tz - z);
      const yaw = Math.atan2(-(tx - x), -(tz - z));
      // Put the target a little below screen centre so more of the valley is in view.
      const pitch = Math.atan2(dy, flat) + 0.12;
      return { x, z, yaw, pitch, target: { x: tx, z: tz } };
    });
  }

  /** The single best opening position. */
  spawnPoint(): SpawnPoint {
    return this.spawnPoints(1)[0];
  }

  /**
   * Lookout points: local high spots that overlook the valley, spread across the map.
   * Visiting one unlocks fast travel to it.
   */
  lookouts(count: number, spacing = 220): Array<{ x: number; z: number }> {
    const limit = HALF_MAP - 90;
    const candidates: Array<{ x: number; z: number; h: number }> = [];
    for (let x = -limit; x <= limit; x += 20) {
      for (let z = -limit; z <= limit; z += 20) {
        const h = this.height(x, z);
        // A local peak: higher than everything 30 m around, and not too steep to stand on.
        let peak = true;
        for (let a = 0; a < 8 && peak; a++) {
          const ang = (a / 8) * Math.PI * 2;
          if (this.height(x + Math.cos(ang) * 30, z + Math.sin(ang) * 30) > h) peak = false;
        }
        if (peak && this.slope(x, z) < 0.6) candidates.push({ x, z, h });
      }
    }
    candidates.sort((a, b) => b.h - a.h);
    const out: Array<{ x: number; z: number }> = [];
    for (const c of candidates) {
      if (out.length >= count) break;
      if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= spacing)) out.push({ x: c.x, z: c.z });
    }
    return out;
  }
}
