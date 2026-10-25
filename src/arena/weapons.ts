import type { ProjectileSpec } from './projectile';

// Weapon tuning and firing state machines for the arena prototype. Pure logic.

export type WeaponId = 'rifle' | 'bow' | 'grenade';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Muzzle/launch speed, m/s (full draw for the bow). */
  speed: number;
  /** Bow only: launch speed at the shortest valid draw. */
  minSpeed: number;
  projectile: ProjectileSpec;
  /** Damage on a body hit at full power; headshots multiply it. */
  damage: number;
  headMultiplier: number;
  /** Seconds between shots (rifle holds to auto-fire). */
  interval: number;
  magazine: number;
  /** Reload time (rifle, bow nock) or regeneration time per grenade. */
  reload: number;
  /** Cone half-angle in radians, from the hip and aiming down sights. */
  spreadHip: number;
  spreadAds: number;
  adsZoom: number;
  /** View kick per shot, radians. */
  recoil: number;
  /** Bow: seconds to full draw. */
  drawTime: number;
  /** Grenade: fuse and blast radius. */
  fuse: number;
  blastRadius: number;
}

const base = { minSpeed: 0, drawTime: 0, fuse: 0, blastRadius: 0 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    ...base,
    id: 'rifle',
    name: '步槍',
    speed: 220,
    projectile: { drag: 0.0006, gravity: 9.81 },
    damage: 34,
    headMultiplier: 3, // one-shot headshot
    interval: 0.16,
    magazine: 20,
    reload: 1.4,
    spreadHip: 0.03,
    spreadAds: 0.003,
    adsZoom: 1.8,
    recoil: 0.018,
  },
  bow: {
    ...base,
    id: 'bow',
    name: '弓',
    speed: 62,
    minSpeed: 22,
    projectile: { drag: 0.0012, gravity: 9.81 },
    damage: 90,
    headMultiplier: 2,
    interval: 0.35,
    magazine: 1,
    reload: 0.45,
    spreadHip: 0.012,
    spreadAds: 0.002,
    adsZoom: 1.35,
    recoil: 0.01,
    drawTime: 0.8,
  },
  grenade: {
    ...base,
    id: 'grenade',
    name: '手雷',
    speed: 18,
    projectile: { drag: 0.006, gravity: 9.81 },
    damage: 120,
    headMultiplier: 1,
    interval: 0.8,
    magazine: 3,
    reload: 6,
    spreadHip: 0,
    spreadAds: 0,
    adsZoom: 1,
    recoil: 0.03,
    fuse: 2,
    blastRadius: 5,
  },
};

/** A projectile to launch: `power` is 0..1 (bow draw), 1 for other weapons. */
export interface Shot {
  weapon: WeaponDef;
  power: number;
}

const MIN_DRAW = 0.15; // s; releasing sooner cancels the arrow

export class WeaponState {
  ammo: number;
  private cooldown = 0;
  private reloadLeft = 0;
  private held = false;
  private heldFor = 0;

  constructor(readonly def: WeaponDef) {
    this.ammo = def.magazine;
  }

  get reloading(): boolean {
    return this.reloadLeft > 0 && this.def.id !== 'grenade';
  }

  /** Bow draw progress 0..1 while held. */
  get draw(): number {
    return this.def.id === 'bow' && this.held ? Math.min(1, this.heldFor / this.def.drawTime) : 0;
  }

  /** True while the trigger is held (bow drawn, grenade being aimed). */
  get aiming(): boolean {
    return this.held;
  }

  private canFire(): boolean {
    return this.cooldown <= 0 && this.ammo > 0 && !this.reloading;
  }

  private consume(): void {
    this.ammo -= 1;
    this.cooldown = this.def.interval;
    if (this.ammo === 0 && this.def.id !== 'grenade') this.reloadLeft = this.def.reload;
    if (this.def.id === 'grenade' && this.reloadLeft <= 0) this.reloadLeft = this.def.reload;
  }

  /** Rifle fires immediately; bow starts drawing; grenade starts aiming. */
  triggerDown(): Shot | null {
    this.held = true;
    this.heldFor = 0;
    if (this.def.id === 'rifle' && this.canFire()) {
      this.consume();
      return { weapon: this.def, power: 1 };
    }
    return null;
  }

  /** Bow looses the arrow; grenade is thrown. `cancel` drops the shot instead. */
  triggerUp(cancel = false): Shot | null {
    if (!this.held) return null;
    this.held = false;
    if (cancel || this.def.id === 'rifle' || !this.canFire()) return null;
    if (this.def.id === 'bow') {
      if (this.heldFor < MIN_DRAW) return null;
      this.consume();
      return { weapon: this.def, power: Math.min(1, this.heldFor / this.def.drawTime) };
    }
    this.consume();
    return { weapon: this.def, power: 1 };
  }

  startReload(): void {
    if (this.def.id === 'grenade' || this.ammo === this.def.magazine || this.reloading) return;
    this.reloadLeft = this.def.reload;
  }

  /** Advances timers; returns auto-fire shots from a held rifle trigger. */
  update(dt: number): Shot[] {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.held) this.heldFor += dt;
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        if (this.def.id === 'grenade') {
          this.ammo = Math.min(this.def.magazine, this.ammo + 1);
          if (this.ammo < this.def.magazine) this.reloadLeft = this.def.reload;
        } else {
          this.ammo = this.def.magazine;
        }
      }
    }
    const shots: Shot[] = [];
    if (this.def.id === 'rifle' && this.held && this.canFire()) {
      this.consume();
      shots.push({ weapon: this.def, power: 1 });
    }
    return shots;
  }
}

/** Launch speed for a shot (bow speed grows with draw). */
export function launchSpeed(shot: Shot): number {
  const w = shot.weapon;
  return w.id === 'bow' ? w.minSpeed + (w.speed - w.minSpeed) * shot.power : w.speed;
}

/** Damage for a hit; bow damage also grows with draw. */
export function hitDamage(shot: Shot, head: boolean): number {
  const w = shot.weapon;
  const scale = w.id === 'bow' ? 0.4 + 0.6 * shot.power : 1;
  return Math.round(w.damage * scale * (head ? w.headMultiplier : 1));
}
