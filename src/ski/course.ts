import { createNoise2D, fbm, Noise2D } from '../world/noise';
import { mulberry32 } from '../world/random';

// A big mountain face below a summit ridge; downhill is +z. You start on a narrow ridge crest
// that drops away on both sides, then the face opens up: rock ribs split it into chutes,
// bands of cliffs cross it with only a few gaps you can ride through (or jump off), and
// lower down it fans out into a treed apron with kickers before a short runout. It stays
// steep almost to the bottom. Pure.

export const COURSE_LENGTH = 1650; // m along z
export const START_Z = 12;
export const FINISH_Z = 1560;
export const TOP = 1000; // m, elevation at the start

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

interface Band {
  z: number; // where the cliff line crosses the centre
  drop: number; // m
  phase: number;
}

/** Slope angle (degrees) of the face at distance z down the course. */
function slopeAt(z: number): number {
  const keys: Array<[number, number]> = [
    [0, 2], [25, 2], [60, 38], [520, 40], [580, 35], [1100, 35], [1150, 31], [1480, 31], [1525, 8], [1600, 3], [COURSE_LENGTH, 3],
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

// Rock ribs (offsets from the centre line) that divide the face into chutes.
const RIBS = [-150, -88, -30, 34, 96, 158];
const RIB_WIDTH = 16; // m half-width at the base
const RIB_HEIGHT = 18; // m

export class Course {
  private profile: Float32Array; // face elevation per metre of z (before cliffs)
  private noise: Noise2D;
  private rock: Noise2D;
  readonly kickers: Kicker[] = [
    { z: 1190, height: 3.2 },
    { z: 1270, height: 4.4 },
    { z: 1350, height: 3.6 },
    { z: 1430, height: 5.2 },
  ];
  /** Cliff bands across the face; each has a few gaps where it is a steep ramp instead. */
  readonly bands: Band[] = [
    { z: 430, drop: 9, phase: 0.4 },
    { z: 760, drop: 13, phase: 2.1 },
    { z: 1020, drop: 8, phase: 4.0 },
  ];
  readonly obstacles: Obstacle[] = [];
  /** Points along the sheer parts of the cliff lips (for the dark rock line that warns of them). */
  readonly cliffLips: Array<{ x: number; z: number }> = [];
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
    for (const b of this.bands) {
      const cx = this.centerX(b.z);
      const w = this.halfWidth(b.z);
      for (let dx = -w; dx <= w; dx += 4) {
        if (this.gap(dx, b) > 0.15) continue;
        const x = cx + dx;
        this.cliffLips.push({ x, z: this.bandLine(x, b) - 2.5 });
      }
    }
  }

  private bandLine(x: number, b: Band): number {
    return b.z + 14 * Math.sin(x / 55 + b.phase);
  }

  /** 0 where a band is a sheer cliff, 1 in its gaps (a steep ramp you can ride). */
  private gap(dx: number, b: Band): number {
    return smooth(0.62, 0.74, 0.5 + 0.5 * Math.sin(dx / 33 + b.phase * 2));
  }

  /** x of the line down the middle of the face at z. */
  centerX(z: number): number {
    const fade = smooth(0, 160, z); // the summit ridge runs straight
    return fade * (30 * Math.sin(z / 230) + 10 * Math.sin(z / 83 + 1.3));
  }

  /** Half-width of the rideable face: the ridge crest at the top, then the full face. */
  halfWidth(z: number): number {
    return 40 + 180 * smooth(150, 520, z);
  }

  private face(z: number): number {
    const zc = Math.max(0, Math.min(this.profile.length - 2, z));
    const i = Math.floor(zc);
    const f = zc - i;
    const extra = z < 0 ? -z * 0.4 : 0; // the summit rises a little behind the start
    return this.profile[i] * (1 - f) + this.profile[i + 1] * f + extra;
  }

  /** Total cliff drop above z at lateral position x (a step where the band is a cliff). */
  private cliffs(x: number, z: number, dx: number): number {
    let drop = 0;
    for (const b of this.bands) {
      const line = this.bandLine(x, b);
      // Gaps: in about a quarter of the width the step spreads into a steep 50 m ramp.
      const len = 3 + 50 * this.gap(dx, b);
      drop += b.drop * smooth(line - len / 2, line + len / 2, z);
    }
    return drop;
  }

  /** Height of the rock ribs at (dx, z). */
  private ribs(dx: number, z: number): number {
    const on = smooth(170, 240, z) * (1 - smooth(1000, 1120, z));
    if (on <= 0) return 0;
    let h = 0;
    RIBS.forEach((off, i) => {
      const c = off + 12 * Math.sin(z / 90 + i * 1.7);
      const d = Math.abs(dx - c);
      if (d >= RIB_WIDTH) return;
      // Ribs come and go down the face, leaving gaps to cross between chutes.
      const present = smooth(-0.4, -0.05, this.rock(i * 9.1, z / 110));
      h = Math.max(h, RIB_HEIGHT * present * (1 - d / RIB_WIDTH) ** 1.4);
    });
    return h * on;
  }

  height(x: number, z: number): number {
    const dx = x - this.centerX(z);
    const d = Math.abs(dx);
    const w = this.halfWidth(z);
    let h = this.face(z) - this.cliffs(x, z, dx);
    // The summit ridge: a crest a few metres wide falling away steeply to both sides.
    const ridge = 1 - smooth(140, 230, z);
    h -= ridge * Math.max(0, d - 4) * 0.95;
    h += this.ribs(dx, z);
    if (d > w) {
      // Beyond the face: rising walls, craggy rock, big peaks further out.
      const o = d - w;
      const near = Math.min(o, 30);
      h += near * 0.85 + Math.max(0, o - 30) * 0.45;
      h += Math.abs(this.rock(x / 22, z / 22)) * near * 0.5;
      h += smooth(60, 500, o) * (1 - Math.abs(this.rock(x / 520, z / 520))) * 320;
    }
    // Surface texture, softer where you ride.
    h += fbm(this.noise, x / 30, z / 30, 3) * (d < w ? 0.6 : 1.2);
    for (const k of this.kickers) h += this.kicker(z - k.z, dx, k.height);
    // Flatten the start pad on the crest.
    h = h + (this.face(z) - h) * (1 - smooth(4, 20, z)) * (1 - smooth(5, 9, d));
    return h;
  }

  /** A jump across the centre: ramp up to a lip, then a long landing that falls away. */
  private kicker(s: number, dx: number, height: number): number {
    if (s < -22 || s > 34 || Math.abs(dx) > 11) return 0;
    const across = 1 - smooth(6, 11, Math.abs(dx));
    let y: number;
    if (s <= 0) y = height * ((s + 22) / 22) ** 2;
    else if (s < 3) y = height;
    else y = height * (1 - smooth(3, 34, s));
    return y * across;
  }

  /** 0..1 how much (x, z) is on a kicker's ramp or table (for colouring). */
  onKicker(x: number, z: number): number {
    const dx = Math.abs(x - this.centerX(z));
    for (const k of this.kickers) {
      const s = z - k.z;
      if (s > -22 && s < 5 && dx < 11) return 1 - smooth(6, 11, dx);
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
    const clear = (x: number, z: number) =>
      this.kickers.every((k) => Math.abs(z - k.z) > 45 || Math.abs(x - this.centerX(z)) > 16) &&
      Math.abs(x - this.centerX(z)) > 2;
    // Boulders scattered over the face below the ridge.
    for (let i = 0; i < 160; i++) {
      const z = 220 + rand() * 1200;
      const x = this.centerX(z) + (rand() - 0.5) * 2 * this.halfWidth(z) * 0.95;
      if (!clear(x, z)) continue;
      add({ x, z, r: 0.8 + rand() * 1.6, top: 0.7 + rand() * 1.6, kind: 'rock' });
    }
    // Trees: thin at first, a forest on the lower apron, thick along the edges.
    for (let i = 0; i < 900; i++) {
      const z = 900 + rand() * 720;
      const w = this.halfWidth(z);
      const edge = rand() < 0.4;
      const x = this.centerX(z) + (edge ? (w * 0.8 + rand() * 60) * (rand() < 0.5 ? -1 : 1) : (rand() - 0.5) * 2 * w * 0.8);
      const density = smooth(900, 1150, z);
      if (rand() > density || !clear(x, z)) continue;
      if (z > FINISH_Z - 40 && z < FINISH_Z + 20 && Math.abs(x - this.centerX(z)) < 30) continue;
      add({ x, z, r: 0.45, top: 4 + rand() * 6, kind: 'tree' });
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
