import { createNoise2D, fbm, Noise2D } from '../world/noise';
import { mulberry32 } from '../world/random';

// A single downhill line from a summit to a valley floor. Downhill is +z. The run follows a
// meandering channel: a steep couloir between rock walls, an open bowl with rollers, a
// tree-lined middle section with kickers, then a flat runout to the finish. Pure.

export const COURSE_LENGTH = 1650; // m along z
export const START_Z = 12;
export const FINISH_Z = 1560;
export const TOP = 620; // m, elevation at the start

export interface Obstacle {
  x: number;
  z: number;
  r: number; // collision radius
  top: number; // height above its base
  kind: 'rock' | 'tree';
}

export interface Kicker {
  z: number; // lip position along the course
  height: number;
}

/** Slope angle (degrees) of the centre line at distance z down the course. */
function slopeAt(z: number): number {
  const keys: Array<[number, number]> = [
    [0, 2], [30, 2], [70, 42], [430, 42], [480, 32], [800, 32], [850, 26], [1250, 26], [1320, 17], [1480, 17], [1530, 3], [COURSE_LENGTH, 3],
  ];
  for (let i = 1; i < keys.length; i++) {
    const [z1, a1] = keys[i];
    if (z <= z1) {
      const [z0, a0] = keys[i - 1];
      const t = (z - z0) / (z1 - z0);
      return a0 + (a1 - a0) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Course {
  private profile: Float32Array; // centre-line elevation per metre of z
  private noise: Noise2D;
  private rock: Noise2D;
  readonly kickers: Kicker[] = [
    { z: 905, height: 1.6 },
    { z: 1040, height: 2.2 },
    { z: 1175, height: 1.8 },
    { z: 1380, height: 2.6 },
  ];
  readonly obstacles: Obstacle[] = [];
  private grid = new Map<number, Obstacle[]>();

  constructor(readonly seed = 3) {
    this.profile = new Float32Array(COURSE_LENGTH + 400);
    let h = TOP;
    for (let i = 0; i < this.profile.length; i++) {
      this.profile[i] = h;
      // Past the finish the valley keeps falling away (scenery only).
      h -= i > COURSE_LENGTH ? 0.2 : Math.tan((slopeAt(i) * Math.PI) / 180);
    }
    this.noise = createNoise2D(seed);
    this.rock = createNoise2D(seed + 1);
    this.placeObstacles();
  }

  /** x of the channel centre at z. */
  centerX(z: number): number {
    const fade = smooth(0, 120, z); // the start pad is straight
    return fade * (38 * Math.sin(z / 190) + 16 * Math.sin(z / 71 + 1.3));
  }

  /** Half-width of the rideable channel at z: narrow in the couloir, wide in the bowl. */
  halfWidth(z: number): number {
    const couloir = smooth(60, 120, z) * (1 - smooth(380, 470, z));
    const base = 26 + 10 * Math.sin(z / 230 + 0.5);
    return base - couloir * (base - 9) + smooth(450, 560, z) * (1 - smooth(780, 860, z)) * 22;
  }

  private centre(z: number): number {
    const zc = Math.max(0, Math.min(this.profile.length - 2, z));
    const i = Math.floor(zc);
    const f = zc - i;
    const extra = z < 0 ? -z * 0.2 : 0; // a little rise behind the start
    return this.profile[i] * (1 - f) + this.profile[i + 1] * f + extra;
  }

  height(x: number, z: number): number {
    let h = this.centre(z);
    const dx = x - this.centerX(z);
    const d = Math.abs(dx);
    const w = this.halfWidth(z);
    // Gentle U across the channel, then rising walls with craggy rock.
    if (d < w) h += (d / w) ** 2 * 3;
    else {
      // Steep near walls (sheer in the couloir), then broad slopes up to the ridges.
      const o = d - w;
      const couloir = smooth(50, 90, z) * (1 - smooth(440, 500, z));
      const steep = 0.7 + couloir * 0.9;
      const near = Math.min(o, 28);
      h += 3 + near * steep + Math.max(0, o - 28) * 0.45;
      h += Math.abs(this.rock(x / 22, z / 22)) * near * 0.5;
      // Big ridged peaks far from the run.
      h += smooth(60, 500, o) * (1 - Math.abs(this.rock(x / 520, z / 520))) * 320;
    }
    // Surface texture: soft rolls everywhere, bigger rollers in the bowl.
    // (Softer on the run itself, so speed doesn't turn every bump into a launch.)
    h += fbm(this.noise, x / 30, z / 30, 3) * (d < w ? 0.6 : 1.2);
    const bowl = smooth(480, 520, z) * (1 - smooth(760, 800, z));
    h += bowl * Math.sin(z / 9) * 0.9 * (1 - smooth(w * 0.7, w, d));
    for (const k of this.kickers) h += this.kicker(z - k.z, dx, k.height);
    // Flatten the start pad.
    h = h + (this.centre(z) - h) * (1 - smooth(4, 20, z)) * (1 - smooth(8, 16, d));
    return h;
  }

  /** A jump across the centre: ramp up to a lip, then a long landing that falls away. */
  private kicker(s: number, dx: number, height: number): number {
    if (s < -16 || s > 24 || Math.abs(dx) > 9) return 0;
    const across = 1 - smooth(5, 9, Math.abs(dx));
    let y: number;
    if (s <= 0) y = height * ((s + 16) / 16) ** 2;
    else if (s < 2) y = height;
    else y = height * (1 - smooth(2, 24, s));
    return y * across;
  }

  /** 0..1 how much (x, z) is on a kicker's ramp or table (for colouring). */
  onKicker(x: number, z: number): number {
    const dx = Math.abs(x - this.centerX(z));
    for (const k of this.kickers) {
      const s = z - k.z;
      if (s > -16 && s < 4 && dx < 9) return 1 - smooth(5, 9, dx);
    }
    return 0;
  }

  /** Surface normal by central differences (unit length). */
  normal(x: number, z: number, out = { x: 0, y: 1, z: 0 }) {
    const e = 0.4;
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const len = Math.hypot(hx, 1, hz);
    out.x = -hx / len;
    out.y = 1 / len;
    out.z = -hz / len;
    return out;
  }

  private placeObstacles() {
    const rand = mulberry32(this.seed + 77);
    const add = (o: Obstacle) => {
      this.obstacles.push(o);
      const key = this.cell(o.x, o.z);
      const list = this.grid.get(key) ?? [];
      list.push(o);
      this.grid.set(key, list);
    };
    const clearOfKickers = (z: number) => this.kickers.every((k) => Math.abs(z - k.z) > 40);
    // Rocks poking through the snow inside the channel (none in the narrowest couloir line).
    for (let i = 0; i < 70; i++) {
      const z = 130 + rand() * 1250;
      const w = this.halfWidth(z);
      const side = rand() < 0.5 ? -1 : 1;
      const off = w * (0.25 + rand() * 0.7) * side;
      if (!clearOfKickers(z) || w < 12) continue;
      add({ x: this.centerX(z) + off, z, r: 0.7 + rand() * 1.4, top: 0.6 + rand() * 1.4, kind: 'rock' });
    }
    // Trees: along the edges from the bowl down, plus a few islands in the wide parts.
    for (let i = 0; i < 420; i++) {
      const z = 480 + rand() * 1120;
      const w = this.halfWidth(z);
      const side = rand() < 0.5 ? -1 : 1;
      const inside = rand() < 0.18 && w > 20;
      const off = inside ? w * (0.45 + rand() * 0.45) * side : (w + 1 + rand() * 45) * side;
      if (inside && !clearOfKickers(z)) continue;
      if (z > FINISH_Z - 30 && z < FINISH_Z + 20 && Math.abs(off) < w + 4) continue;
      add({ x: this.centerX(z) + off, z, r: 0.45, top: 4 + rand() * 5, kind: 'tree' });
    }
  }

  private cell(x: number, z: number): number {
    return Math.floor(x / 10) * 100000 + Math.floor(z / 10);
  }

  /** Obstacles within about 10 m of (x, z). */
  near(x: number, z: number): Obstacle[] {
    const out: Obstacle[] = [];
    const cx = Math.floor(x / 10);
    const cz = Math.floor(z / 10);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(this.grid.get((cx + i) * 100000 + cz + j) ?? []));
    return out;
  }

  /** Downhill direction of the course line at z (unit, horizontal). */
  fallLine(z: number): { x: number; z: number } {
    const dx = this.centerX(z + 5) - this.centerX(z - 5);
    const len = Math.hypot(dx, 10);
    return { x: dx / len, z: 10 / len };
  }
}
