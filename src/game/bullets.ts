import * as THREE from 'three';
import type { Ammo } from '../ballistics/ammo';
import { BulletState, DEFAULT_STEP, FlightEnv, stepBullet } from '../ballistics/ballistics';
import type { Deer, DeerHit } from '../animals/deer';
import { length, vec3 } from '../core/vec3';
import createFireball, { VFXHandle } from '../vfx/fireball';
import { HALF_MAP, Terrain } from '../world/terrain';

/** World scale of the fireball VFX: its model is ~4 m long, so this makes it ~1.2 m. */
export const FIREBALL_SCALE = 0.3;
import type { Target, TargetHit } from './targets';

const MAX_FLIGHT = 3; // s
const TRAIL_LIFE = 1.6; // s the tracer stays visible after impact
/**
 * Ground is ignored for the first metres of flight: lying prone on a slope puts the muzzle
 * within centimetres of the ground, where a real rifle would rest over the lip.
 */
const MUZZLE_CLEARANCE = 2; // m

export type Impact =
  | { kind: 'animal'; deer: Deer; hit: DeerHit; range: number; time: number }
  | { kind: 'antler'; deer: Deer; range: number; time: number }
  | { kind: 'target'; hit: TargetHit; range: number; time: number; velocity: number }
  | { kind: 'ground'; point: THREE.Vector3; range: number; time: number }
  | { kind: 'lost' };

/** Read-only view of a bullet in flight, for the bullet camera. */
export interface BulletHandle {
  readonly mesh: THREE.Object3D;
  readonly fireball: boolean;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly done: boolean;
}

interface LiveBullet {
  mesh: THREE.Mesh;
  /** Optional fireball visual that follows the bullet and bursts on impact. */
  fx: VFXHandle | null;
  ammo: Ammo;
  state: BulletState;
  origin: THREE.Vector3;
  trail: THREE.Vector3[];
  line: THREE.Line;
  done: boolean;
  fade: number;
  /** Animals already passed through, so an exiting bullet does not re-hit them. */
  passed: Set<Deer>;
}

/** After passing through an animal, later ground/lost impacts are not reported (the hit already was). */
const quiet = (b: LiveBullet) => b.passed.size > 0;

interface Puff {
  mesh: THREE.Mesh;
  age: number;
}

const toV3 = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

/**
 * Flies bullets through the world in real time with the shared ballistics solver,
 * colliding with terrain and practice targets, and draws a faint tracer.
 */
export class BulletSystem {
  private bullets: LiveBullet[] = [];
  private puffs: Puff[] = [];
  private now = 0; // world time of the current update, stamped on animal hits
  /** Bullet appearance: a plain round, or the fireball effect. */
  fireball = false;
  private bulletGeo = new THREE.CylinderGeometry(0.004, 0.0078, 0.03, 8).rotateX(Math.PI / 2);
  private bulletMat = new THREE.MeshLambertMaterial({ color: 0xc89b4a, emissive: 0x3a2a10 });
  private trailMat = new THREE.LineBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.7 });

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
    private targets: Target[],
    private animals: Deer[],
    private env: (t: number) => FlightEnv,
    private onImpact: (impact: Impact) => void,
  ) {}

  /**
   * Dry-runs a shot through the current world without changing anything. Returns the animal it
   * would hit and at what range, or null. Animals may move during flight, so this is a forecast.
   */
  predictAnimalHit(ammo: Ammo, origin: THREE.Vector3, dir: THREE.Vector3, worldTime: number): { deer: Deer; range: number } | null {
    const env = this.env(worldTime);
    const d = dir.clone().normalize();
    let s: BulletState = { pos: vec3(origin.x, origin.y, origin.z), vel: vec3(d.x * ammo.muzzleVelocity, d.y * ammo.muzzleVelocity, d.z * ammo.muzzleVelocity), time: 0 };
    while (s.time < MAX_FLIGHT) {
      const next = stepBullet(ammo, env, s, DEFAULT_STEP);
      const a = toV3(s.pos);
      const c = toV3(next.pos);
      for (const deer of this.animals) if (deer.probe(a, c)) return { deer, range: c.distanceTo(origin) };
      if (c.distanceTo(origin) > MUZZLE_CLEARANCE && next.pos.y < this.terrain.height(next.pos.x, next.pos.z)) return null;
      s = next;
    }
    return null;
  }

  fire(ammo: Ammo, origin: THREE.Vector3, dir: THREE.Vector3): BulletHandle {
    const d = dir.clone().normalize();
    const state: BulletState = {
      pos: vec3(origin.x, origin.y, origin.z),
      vel: vec3(d.x * ammo.muzzleVelocity, d.y * ammo.muzzleVelocity, d.z * ammo.muzzleVelocity),
      time: 0,
    };
    const line = new THREE.Line(new THREE.BufferGeometry(), this.trailMat.clone());
    line.frustumCulled = false;
    this.scene.add(line);
    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(origin);
    mesh.lookAt(origin.clone().add(d));
    this.scene.add(mesh);
    let fx: VFXHandle | null = null;
    if (this.fireball) {
      fx = createFireball();
      fx.group.scale.setScalar(FIREBALL_SCALE);
      fx.group.position.copy(origin);
      fx.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d);
      this.scene.add(fx.group);
      mesh.visible = false;
    }
    const live: LiveBullet = { mesh, fx, ammo, state, origin: origin.clone(), trail: [origin.clone()], line, done: false, fade: TRAIL_LIFE, passed: new Set() };
    this.bullets.push(live);
    // With a fireball, the cam follows the flame and treats its burst as the end of the flight.
    const burst = () => live.fx !== null && live.fx.phase !== 'starting' && live.fx.phase !== 'active';
    return {
      mesh,
      get position() {
        return live.fx ? live.fx.group.position : live.mesh.position;
      },
      get velocity() {
        return toV3(live.state.vel);
      },
      get done() {
        return live.done || burst();
      },
      get fireball() {
        return live.fx !== null;
      },
    };
  }

  /** Removes every bullet, tracer and puff (end of a hunt). */
  clear() {
    for (const b of this.bullets) {
      b.fx?.dispose();
      this.scene.remove(b.line, b.mesh);
      b.line.geometry.dispose();
    }
    for (const p of this.puffs) this.scene.remove(p.mesh);
    this.bullets = [];
    this.puffs = [];
  }

  update(dt: number, worldTime: number) {
    this.now = worldTime;
    const env = this.env(worldTime);
    for (const b of this.bullets) {
      if (b.done) {
        b.fade -= dt;
        (b.line.material as THREE.LineBasicMaterial).opacity = 0.7 * Math.max(b.fade / TRAIL_LIFE, 0);
        b.fx?.update(dt);
        continue;
      }
      const target = b.state.time + dt;
      while (!b.done && b.state.time < target) {
        let next = stepBullet(b.ammo, env, b.state, DEFAULT_STEP);
        next = this.collide(b, b.state, next);
        b.state = next;
        if (!b.done && (b.state.time > MAX_FLIGHT || Math.abs(next.pos.x) > HALF_MAP || Math.abs(next.pos.z) > HALF_MAP)) {
          b.done = true;
          b.fx?.stop();
          if (!quiet(b)) this.onImpact({ kind: 'lost' });
        }
      }
      if (!b.done) {
        b.trail.push(toV3(b.state.pos));
        b.mesh.position.copy(toV3(b.state.pos));
        b.mesh.lookAt(b.mesh.position.clone().add(toV3(b.state.vel)));
        // Follow the bullet until the fireball bursts; the burst then stays where it happened.
        if (b.fx && (b.fx.phase === 'starting' || b.fx.phase === 'active')) {
          // The effect's forward axis is +x.
          b.fx.group.position.copy(b.mesh.position);
          b.fx.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), toV3(b.state.vel).normalize());
        }
      } else {
        b.mesh.visible = false;
      }
      b.fx?.update(dt);
      b.line.geometry.setFromPoints(b.trail);
    }
    this.bullets = this.bullets.filter((b) => {
      if (b.fade > 0 || (b.fx && !b.fx.finished)) return true;
      b.fx?.dispose();
      this.scene.remove(b.line, b.mesh);
      b.line.geometry.dispose();
      return false;
    });

    for (const p of this.puffs) {
      p.age += dt;
      const k = p.age / 0.8;
      p.mesh.scale.setScalar(0.3 + k * 1.6);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - k));
    }
    this.puffs = this.puffs.filter((p) => {
      if (p.age < 0.8) return true;
      this.scene.remove(p.mesh);
      return false;
    });
  }

  /** Resolves collisions on one step; returns the (possibly redirected) next state. */
  private collide(b: LiveBullet, s: BulletState, next: BulletState): BulletState {
    const a = toV3(s.pos);
    const c = toV3(next.pos);
    for (const deer of this.animals) {
      if (b.passed.has(deer)) continue;
      const res = deer.testHit(a, c, b.ammo, length(s.vel), this.now, b.origin);
      if (!res) continue;
      if ('antler' in res) {
        // Glance off the antler: a few degrees off line and some speed lost.
        b.passed.add(deer);
        b.trail.push(res.antler.clone());
        this.onImpact({ kind: 'antler', deer, range: res.antler.distanceTo(b.origin), time: next.time });
        const v = toV3(next.vel);
        const speed = v.length() * 0.85;
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(v).normalize();
        const dir = v.normalize().applyAxisAngle(axis, ((2 + Math.random() * 4) * Math.PI) / 180);
        const from = res.antler.clone().addScaledVector(dir, 0.03);
        return { pos: vec3(from.x, from.y, from.z), vel: vec3(dir.x * speed, dir.y * speed, dir.z * speed), time: next.time };
      }
      const { hit } = res;
      b.passed.add(deer);
      // The fireball bursts on the animal even if the bullet itself passes through.
      b.fx?.hit(hit.entryWorld);
      b.trail.push(hit.entryWorld.clone());
      this.spawnPuff(hit.entryWorld, 0x9b1b1b, 0.25);
      this.onImpact({ kind: 'animal', deer, hit, range: hit.range, time: next.time });
      const w = hit.wound;
      if (!hit.exitWorld || w.exitVelocity < 80) {
        b.done = true;
        return next;
      }
      // Continue from the exit wound with the remaining velocity along the same line.
      const dir = c.clone().sub(a).normalize();
      const from = hit.exitWorld.clone().addScaledVector(dir, 0.02);
      b.trail.push(from.clone());
      return {
        pos: vec3(from.x, from.y, from.z),
        vel: vec3(dir.x * w.exitVelocity, dir.y * w.exitVelocity, dir.z * w.exitVelocity),
        time: next.time,
      };
    }
    for (const t of this.targets) {
      const hit = t.intersect(a, c);
      if (hit) {
        this.finish(b, hit.point, 0xffffff);
        this.onImpact({ kind: 'target', hit, range: hit.point.distanceTo(b.origin), time: next.time, velocity: length(next.vel) });
        return next;
      }
    }
    if (c.distanceTo(b.origin) > MUZZLE_CLEARANCE && next.pos.y < this.terrain.height(next.pos.x, next.pos.z)) {
      // Bisect for the ground contact point.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        const p = a.clone().lerp(c, mid);
        if (p.y < this.terrain.height(p.x, p.z)) hi = mid;
        else lo = mid;
      }
      const point = a.clone().lerp(c, hi);
      this.finish(b, point, 0xb59a6a);
      if (!quiet(b)) this.onImpact({ kind: 'ground', point, range: point.distanceTo(b.origin), time: next.time });
    }
    return next;
  }

  private finish(b: LiveBullet, point: THREE.Vector3, color: number) {
    b.done = true;
    b.trail.push(point);
    if (b.fx) b.fx.hit(point);
    else this.spawnPuff(point, color, 0.35);
  }

  private spawnPuff(point: THREE.Vector3, color: number, size: number) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 6, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    mesh.position.copy(point);
    this.scene.add(mesh);
    this.puffs.push({ mesh, age: 0 });
  }
}
