import type { OrganId } from './anatomy';
import type { WoundResult } from './anatomy';

// Physiological wound model: animals die from blood loss or lack of oxygen, or drop
// instantly from central-nervous-system hits. Rates are tuned so that, for an expanded
// .308 soft point, heart ≈ seconds, lungs ≈ tens of seconds, liver ≈ minutes, gut ≈ hours.

export const BLOOD_VOLUME = 5; // litres
export const COLLAPSE_LOSS = 0.35; // fraction of blood lost at which the animal goes down
const REFERENCE_CHANNEL = 0.0235; // m, an expanded .308 soft point

/** Bleed rate in L/s per metre of wound channel through the organ (reference channel). */
const BLEED: Partial<Record<OrganId, number>> = {
  heart: 2.2,
  aorta: 4,
  lungL: 0.25,
  lungR: 0.25,
  liver: 0.055,
  gut: 0.0015,
  femoralL: 1.0,
  femoralR: 1.0,
};
/** Bleeding (L/s) per joule left in the body: an expanding bullet's trauma bleeds wherever it lands. */
const ENERGY_BLEED = 0.000012;
/** Immediate blood loss (L) per joule: shock and tissue destruction, so follow-up shots stack up. */
const ENERGY_SHOCK = 0.00012;
const MUSCLE_BLEED = 0.002; // L/s for any wound; clots over time
const CLOT_TAU = 90; // s
/** Oxygen lost per second per metre of lung channel. */
const LUNG_OXYGEN = 0.12;

export type Condition = 'healthy' | 'wounded' | 'down' | 'dead';

export type HitCategory = 'cns' | 'heart' | 'lungs' | 'hip' | 'liver' | 'gut' | 'leg' | 'muscle';

export function categorize(w: WoundResult): HitCategory {
  const ids = new Set(w.organs.map((o) => o.organ.id));
  if (ids.has('brain') || ids.has('neckSpine') || ids.has('spine')) return 'cns';
  if (ids.has('heart') || ids.has('aorta')) return 'heart';
  if (ids.has('lungL') || ids.has('lungR')) return 'lungs';
  if (ids.has('pelvis') || ids.has('femoralL') || ids.has('femoralR')) return 'hip';
  if (ids.has('liver')) return 'liver';
  if (ids.has('gut')) return 'gut';
  if (['legFL', 'legFR', 'legHL', 'legHR'].some((l) => ids.has(l as OrganId))) return 'leg';
  return 'muscle';
}

export class Physiology {
  blood = BLOOD_VOLUME;
  oxygen = 1;
  condition: Condition = 'healthy';
  /** 0..1 multiplier on running speed (broken legs). */
  mobility = 1;
  /** Paralysed by a spinal hit: alive but cannot move. */
  paralysed = false;
  private organBleed = 0; // L/s, persistent
  private muscleBleed = 0; // L/s, clots over time
  private oxygenLoss = 0; // per second
  private downTime = 0;

  applyWound(w: WoundResult) {
    const width = w.channel / REFERENCE_CHANNEL;
    for (const h of w.organs) {
      const id = h.organ.id;
      if (id === 'brain' || id === 'neckSpine') {
        this.condition = 'dead';
        this.blood = Math.min(this.blood, BLOOD_VOLUME * (1 - COLLAPSE_LOSS));
        return;
      }
      // A broken spine or pelvis drops the deer where it stands.
      if (id === 'spine' || id === 'pelvis') this.paralysed = true;
      if (id.startsWith('leg')) this.mobility *= 0.45;
      this.organBleed += (BLEED[id] ?? 0) * h.length * width;
      if (id === 'lungL' || id === 'lungR') this.oxygenLoss += LUNG_OXYGEN * h.length * width;
    }
    this.muscleBleed += MUSCLE_BLEED * width;
    this.organBleed += ENERGY_BLEED * w.energy;
    this.blood -= ENERGY_SHOCK * w.energy;
    if (this.condition === 'healthy') this.condition = 'wounded';
    if (this.paralysed) this.condition = 'down';
  }

  update(dt: number) {
    if (this.condition === 'healthy' || this.condition === 'dead') return;
    this.blood -= (this.organBleed + this.muscleBleed) * dt;
    this.muscleBleed *= Math.exp(-dt / CLOT_TAU);
    this.oxygen -= this.oxygenLoss * dt;
    const lost = 1 - this.blood / BLOOD_VOLUME;
    if (this.condition === 'wounded' && (lost >= COLLAPSE_LOSS || this.oxygen <= 0)) this.condition = 'down';
    if (this.condition === 'down') {
      this.downTime += dt;
      // Once down, death follows shortly unless the animal is merely paralysed.
      if (lost >= COLLAPSE_LOSS + 0.1 || this.oxygen <= -0.3 || (!this.paralysed && this.downTime > 8)) {
        this.condition = 'dead';
      }
    }
  }

  /** Simulates forward until the animal goes down; returns seconds, or Infinity past `limit`. */
  static timeToCollapse(wounds: WoundResult[], limit = 3600): number {
    const p = new Physiology();
    for (const w of wounds) p.applyWound(w);
    let t = 0;
    while (t < limit) {
      if (p.condition === 'down' || p.condition === 'dead') return t;
      p.update(0.1);
      t += 0.1;
    }
    return Infinity;
  }
}
