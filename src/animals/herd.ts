import { mulberry32 } from '../world/random';
import { HALF_MAP, Terrain, WATER_LEVEL } from '../world/terrain';
import type { World } from './brain';
import { Deer } from './deer';
import type { PlayerSignal } from './perception';
import { SignBook } from '../tracking/trail';

const CONTAGION_RADIUS = 90; // m: herd-mates within this follow a bolting deer
const CONTAGION_DELAY: readonly [number, number] = [0.15, 0.6]; // s reaction time
const GUNSHOT_RADIUS = 600; // m: every deer that hears the shot flees
const SPEED_OF_SOUND = 343; // m/s: the supersonic bullet arrives before the report does
const STARTLE_DELAY = 0.2; // s to react once the sound arrives
const IMPACT_RADIUS = 25; // m: a bullet striking nearby startles

/** Owns the deer, routes world events (shots, impacts) to them and spreads panic through the herd. */
export class Herd {
  private pending: Array<{ deer: Deer; at: number; from: { x: number; z: number } }> = [];
  private time = 0;
  readonly world: World;
  /** Every sign left by wounded deer. */
  readonly signs = new SignBook();

  constructor(
    readonly deer: Deer[],
    terrain: Terrain,
    private rand: () => number,
  ) {
    this.world = {
      height: (x, z) => terrain.height(x, z),
      limit: HALF_MAP - 70,
      lineOfSight: (ax, ay, az, bx, by, bz) => terrain.lineOfSight(ax, ay, az, bx, by, bz, 0.5),
    };
    for (const d of deer) {
      d.brain.onFlee = (_brain, from) => this.spread(d, from);
      d.signSink = (sign) => this.signs.add(sign);
    }
  }

  private spread(source: Deer, from: { x: number; z: number }) {
    const p = source.object.position;
    for (const d of this.deer) {
      if (d === source || this.pending.some((q) => q.deer === d)) continue;
      if (d.object.position.distanceTo(p) > CONTAGION_RADIUS) continue;
      const delay = CONTAGION_DELAY[0] + this.rand() * (CONTAGION_DELAY[1] - CONTAGION_DELAY[0]);
      this.pending.push({ deer: d, at: this.time + delay, from });
    }
  }

  /**
   * A gunshot from `origin`. Each deer reacts once the sound reaches it, so the first shot
   * lands before the herd moves. Deer only roughly localise where the shot came from.
   */
  gunshot(origin: { x: number; z: number }) {
    for (const d of this.deer) {
      const p = d.object.position;
      const dist = Math.hypot(p.x - origin.x, p.z - origin.z);
      if (dist > GUNSHOT_RADIUS) continue;
      const err = (this.rand() - 0.5) * 60;
      const at = this.time + dist / SPEED_OF_SOUND + STARTLE_DELAY + this.rand() * 0.2;
      this.pending.push({ deer: d, at, from: { x: origin.x + err, z: origin.z + err } });
    }
  }

  impact(point: { x: number; z: number }) {
    for (const d of this.deer) {
      const p = d.object.position;
      if (Math.hypot(p.x - point.x, p.z - point.z) < IMPACT_RADIUS) d.scare(point);
    }
  }

  update(dt: number, player: PlayerSignal) {
    this.time += dt;
    const due = this.pending.filter((q) => q.at <= this.time);
    this.pending = this.pending.filter((q) => q.at > this.time);
    for (const q of due) q.deer.scare(q.from);
    for (const d of this.deer) d.update(dt, this.world, player);
  }
}

/** Places a small grazing herd around a meadow point. */
export function createHerd(terrain: Terrain, center: { x: number; z: number }, count: number, seed: number): Deer[] {
  const rand = mulberry32(seed);
  const herd: Deer[] = [];
  for (let tries = 0; herd.length < count && tries < 200; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 22;
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    const y = terrain.height(x, z);
    if (y < WATER_LEVEL + 0.5 || terrain.slope(x, z) > 0.5) continue;
    if (herd.some((d) => Math.hypot(d.object.position.x - x, d.object.position.z - z) < 3)) continue;
    herd.push(new Deer(herd.length, x, y, z, rand() * Math.PI * 2, herd.length === 0, rand));
  }
  return herd;
}
