import { AMMO, Ammo } from '../ballistics/ammo';
import { zeroElevation } from '../ballistics/ballistics';

export const ZERO_STEPS = [100, 150, 200, 250, 300, 350, 400] as const;
export const MAGNIFICATIONS = [4, 8, 16] as const;
/**
 * The wide portrait view (75° vertical) is already "zoomed out" compared with the naked eye,
 * so nominal magnification is applied relative to a narrower eye-equivalent field of view.
 */
export const EYE_ZOOM = 2.5;
export const SIGHT_HEIGHT = 0.04; // m, scope centre above the bore
export const BOLT_CYCLE = 1.2; // s between shots

/** A bolt-action rifle with a precomputed zero table per ammo type. */
export class Rifle {
  ammo: Ammo = AMMO['308-sp-165'];
  zeroIndex = 0;
  magIndex = 0;
  private boltTimer = 0;
  private zeroTable = new Map<string, number[]>();

  constructor() {
    for (const a of Object.values(AMMO)) {
      this.zeroTable.set(a.id, ZERO_STEPS.map((z) => zeroElevation(a, z, { sightHeight: SIGHT_HEIGHT })));
    }
  }

  get zero(): number {
    return ZERO_STEPS[this.zeroIndex];
  }

  get magnification(): number {
    return MAGNIFICATIONS[this.magIndex];
  }

  /** Bore elevation above the sight line for the current zero, in radians. */
  get elevation(): number {
    return this.zeroTable.get(this.ammo.id)![this.zeroIndex];
  }

  get cycling(): boolean {
    return this.boltTimer > 0;
  }

  setZeroIndex(i: number): boolean {
    const clamped = Math.max(0, Math.min(ZERO_STEPS.length - 1, i));
    const changed = clamped !== this.zeroIndex;
    this.zeroIndex = clamped;
    return changed;
  }

  cycleMagnification() {
    this.magIndex = (this.magIndex + 1) % MAGNIFICATIONS.length;
  }

  /** Returns true if a round was fired (the bolt was ready). */
  tryFire(): boolean {
    if (this.boltTimer > 0) return false;
    this.boltTimer = BOLT_CYCLE;
    return true;
  }

  update(dt: number) {
    this.boltTimer = Math.max(0, this.boltTimer - dt);
  }
}
