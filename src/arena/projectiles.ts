import * as THREE from 'three';
import createFireball, { VFXHandle } from '../vfx/fireball';
import type { Zone } from './hitbox';
import { ProjectileState, STEP, stepProjectile } from './projectile';
import type { Hittable } from './targets';
import { Trail } from './trails';
import { ProjectileKind, Shot, hitDamage, launchSpeed } from './weapons';
import type { ArenaWorld } from './world';

// Live projectiles: rifle tracers, arrows that stick, grenades that bounce and explode,
// spitter acid. Each leaves a fading flight-path ribbon and an impact mark where it lands.
// Everything advances in the same fixed steps as the pure physics module.

export interface HitEvent {
  target: Hittable;
  zone: Zone;
  damage: number;
  killed: boolean;
  point: THREE.Vector3;
  weapon: ProjectileKind;
  owner: Hittable | null;
  byPlayer: boolean;
}

interface Live {
  shot: Shot;
  state: ProjectileState;
  owner: Hittable | null;
  byPlayer: boolean;
  mesh: THREE.Object3D;
  start: THREE.Vector3;
  done: boolean;
  stuck: number; // arrows: seconds left stuck in a surface
  resting: boolean; // grenades: stopped rolling
  trail: Trail;
  steps: number;
}

interface Effect {
  update(dt: number): boolean; // false when finished
  dispose(): void;
}

const MAX_FLIGHT = 4; // s
const RESTITUTION = 0.35;
const ARROW_STICK = 8; // s
const TRACER_HIDE = 3; // m: keep the tracer from flashing across the camera
const TRAIL_EVERY = 3; // physics steps per trail sample
const TRAIL_START = 2.5; // m: the first stretch would smear across the whole view
const MAX_DECALS = 60;

const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 2.4).translate(0, 0, -1.2);
const playerTracer = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const enemyTracer = new THREE.MeshBasicMaterial({ color: 0xff5a4a });

function arrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.75).translate(0, 0, -0.4), new THREE.MeshLambertMaterial({ color: 0x9b6b3d }));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x55595e }));
  const fletch = new THREE.MeshLambertMaterial({ color: 0xff5470, side: THREE.DoubleSide });
  g.add(shaft, tip);
  for (const r of [0, Math.PI / 2]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.14), fletch);
    f.position.z = -0.7;
    f.rotation.set(Math.PI / 2, r, 0);
    g.add(f);
  }
  return g;
}

const grenadeGeo = new THREE.IcosahedronGeometry(0.08, 0);
const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x4f8f3a, flatShading: true });
const acidGeo = new THREE.IcosahedronGeometry(0.16, 1);
const acidMat = new THREE.MeshBasicMaterial({ color: 0x9dff3a });
const decalGeo = new THREE.CircleGeometry(0.09, 8);
const decalMat = new THREE.MeshBasicMaterial({
  color: 0x2a2620,
  transparent: true,
  opacity: 0.75,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const trailStyle = (kind: ProjectileKind, byPlayer: boolean): [number, number, number] =>
  kind === 'acid' ? [0x9dff3a, 0.55, 0.8] : byPlayer ? [0xfff2a8, 0.8, 1.6] : [0xff4a3a, 0.5, 0.8];

export class Projectiles {
  private live: Live[] = [];
  private effects: Effect[] = [];
  private trails: Trail[] = [];
  private decals: THREE.Mesh[] = [];
  private acc = 0;
  onHit: (e: HitEvent) => void = () => {};
  onImpact: (p: THREE.Vector3, weapon: ProjectileKind) => void = () => {};
  onBlast: (p: THREE.Vector3) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private world: ArenaWorld,
    private targets: () => Hittable[],
  ) {}

  fire(shot: Shot, origin: THREE.Vector3, dir: THREE.Vector3, owner: Hittable | null, byPlayer: boolean) {
    const v = dir.clone().normalize().multiplyScalar(launchSpeed(shot));
    let mesh: THREE.Object3D;
    if (shot.weapon.id === 'rifle') {
      mesh = new THREE.Mesh(tracerGeo, byPlayer ? playerTracer : enemyTracer);
      mesh.visible = false;
    } else if (shot.weapon.id === 'bow') mesh = arrowMesh();
    else if (shot.weapon.id === 'acid') mesh = new THREE.Mesh(acidGeo, acidMat);
    else {
      mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      mesh.castShadow = true;
    }
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const trail = new Trail(...trailStyle(shot.weapon.id, byPlayer));
    this.trails.push(trail);
    this.scene.add(trail.mesh);
    this.live.push({
      trail,
      steps: 0,
      shot,
      state: { pos: { x: origin.x, y: origin.y, z: origin.z }, vel: { x: v.x, y: v.y, z: v.z }, time: 0 },
      owner,
      byPlayer,
      mesh,
      start: origin.clone(),
      done: false,
      stuck: 0,
      resting: false,
    });
  }

  update(dt: number, camera: THREE.Vector3) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    const targets = this.targets();
    for (const p of this.live) {
      if (p.stuck > 0) {
        p.stuck -= dt;
        if (p.stuck <= 0) p.done = true;
        continue;
      }
      for (let i = 0; i < steps && !p.done && p.stuck <= 0; i++) this.step(p, targets);
      if (p.done || p.stuck > 0) continue;
      const s = p.state;
      p.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      if (p.shot.weapon.id === 'grenade') {
        p.mesh.rotation.x += dt * 9;
        p.mesh.rotation.z += dt * 5;
      } else {
        p.mesh.lookAt(s.pos.x + s.vel.x, s.pos.y + s.vel.y, s.pos.z + s.vel.z);
        if (p.shot.weapon.id === 'rifle') p.mesh.visible = p.mesh.position.distanceTo(p.start) > TRACER_HIDE;
      }
    }
    this.live = this.live.filter((p) => {
      if (p.done) {
        this.scene.remove(p.mesh);
        p.trail.finish();
      }
      return !p.done;
    });
    this.trails = this.trails.filter((t) => {
      const keep = t.update(dt, camera);
      if (!keep) {
        this.scene.remove(t.mesh);
        t.dispose();
      }
      return keep;
    });
    this.effects = this.effects.filter((e) => {
      const keep = e.update(dt);
      if (!keep) e.dispose();
      return keep;
    });
  }

  private step(p: Live, targets: Hittable[]) {
    const w = p.shot.weapon;
    const a = p.state.pos;
    if (w.id === 'grenade') {
      if (!p.resting) {
        const next = stepProjectile(p.state, w.projectile);
        const hit = this.world.collide(a, next.pos);
        if (hit) {
          const t = hit.t;
          const n = hit.normal;
          const v = new THREE.Vector3(next.vel.x, next.vel.y, next.vel.z);
          const vn = v.dot(n);
          if (vn < 0) v.addScaledVector(n, -(1 + RESTITUTION) * vn).multiplyScalar(0.75);
          next.pos = {
            x: a.x + (next.pos.x - a.x) * t + n.x * 0.01,
            y: a.y + (next.pos.y - a.y) * t + n.y * 0.01,
            z: a.z + (next.pos.z - a.z) * t + n.z * 0.01,
          };
          next.vel = { x: v.x, y: v.y, z: v.z };
          if (v.length() < 0.6 && n.y > 0.5) p.resting = true;
        }
        p.state = next;
        if (++p.steps % TRAIL_EVERY === 0 || hit) this.sample(p, next.pos);
      } else p.state = { ...p.state, time: p.state.time + STEP };
      if (p.state.time >= w.fuse) this.explode(p, targets);
      return;
    }
    const next = stepProjectile(p.state, w.projectile);
    const wall = this.world.collide(a, next.pos);
    let best: { target: Hittable; zone: Zone; t: number } | null = null;
    const reach = Math.hypot(next.pos.x - a.x, next.pos.z - a.z) + 2;
    for (const t of targets) {
      if (t === p.owner || !t.alive || (t.team && t.team === p.owner?.team)) continue;
      const dx = t.position.x - a.x;
      const dz = t.position.z - a.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      const r = t.test(a, next.pos);
      if (r && (!wall || r.t < wall.t) && (!best || r.t < best.t)) best = { target: t, zone: r.zone, t: r.t };
    }
    const at = (t: number) =>
      new THREE.Vector3(a.x + (next.pos.x - a.x) * t, a.y + (next.pos.y - a.y) * t, a.z + (next.pos.z - a.z) * t);
    if (best) {
      const damage = hitDamage(p.shot, best.zone === 'head');
      const killed = best.target.damage(damage, best.zone);
      const point = at(best.t);
      this.sample(p, point);
      this.onHit({ target: best.target, zone: best.zone, damage, killed, point, weapon: w.id, owner: p.owner, byPlayer: p.byPlayer });
      p.done = true;
      return;
    }
    if (wall) {
      const point = at(wall.t);
      this.sample(p, point);
      this.onImpact(point, w.id);
      this.puff(point, w.id === 'acid' ? 0x9dff3a : w.id === 'bow' ? 0xc8b48a : 0xe8e0cc);
      if (w.id !== 'acid') this.decal(point, wall.normal);
      if (w.id === 'bow') {
        p.stuck = ARROW_STICK;
        p.mesh.position.copy(point);
        p.mesh.lookAt(point.x + next.vel.x, point.y + next.vel.y, point.z + next.vel.z);
      } else p.done = true;
      return;
    }
    p.state = next;
    if (++p.steps % TRAIL_EVERY === 0) this.sample(p, next.pos);
    if (next.time > MAX_FLIGHT || next.pos.y < -50) p.done = true;
  }

  private explode(p: Live, targets: Hittable[]) {
    p.done = true;
    const w = p.shot.weapon;
    const c = new THREE.Vector3(p.state.pos.x, p.state.pos.y + 0.3, p.state.pos.z);
    for (const t of targets) {
      if (!t.alive) continue;
      const chest = t.position.clone().setY(t.position.y + 1.1);
      const d = chest.distanceTo(c);
      if (d > w.blastRadius || !this.world.lineOfSight(c, chest)) continue;
      let damage = Math.round(w.damage * (1 - d / w.blastRadius) ** 0.7);
      if (t === p.owner) damage = Math.round(damage * 0.5);
      if (damage <= 0) continue;
      const killed = t.damage(damage, 'torso');
      this.onHit({ target: t, zone: 'torso', damage, killed, point: chest, weapon: 'grenade', owner: p.owner, byPlayer: p.byPlayer });
    }
    this.blastFx(c);
    this.onBlast(c);
  }

  private blastFx(c: THREE.Vector3) {
    const fx: VFXHandle = createFireball();
    fx.group.scale.setScalar(2.6);
    fx.group.position.copy(c);
    this.scene.add(fx.group);
    fx.update(0.05);
    fx.hit(c, new THREE.Vector3(0, 1, 0));
    const flash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, depthWrite: false }),
    );
    flash.position.copy(c);
    this.scene.add(flash);
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        fx.update(dt);
        const k = Math.min(1, t / 0.3);
        flash.scale.setScalar(0.6 + k * 4);
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        flash.visible = k < 1;
        return !(fx.finished && t > 0.3) && t < 4;
      },
      dispose: () => {
        this.scene.remove(fx.group, flash);
        fx.dispose();
        flash.geometry.dispose();
      },
    });
    this.puff(c, 0x9a8f80, 18, 5);
  }

  private sample(p: Live, at: { x: number; y: number; z: number }) {
    const dx = at.x - p.start.x;
    const dy = at.y - p.start.y;
    const dz = at.z - p.start.z;
    if (dx * dx + dy * dy + dz * dz > TRAIL_START * TRAIL_START) p.trail.add(at);
  }

  /** A dark mark where a shot struck, so misses are easy to read. */
  private decal(p: THREE.Vector3, normal: THREE.Vector3) {
    const m = new THREE.Mesh(decalGeo, decalMat);
    m.position.copy(p).addScaledVector(normal, 0.01);
    m.lookAt(m.position.clone().add(normal));
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > MAX_DECALS) this.scene.remove(this.decals.shift()!);
  }

  /** Small chunky debris burst. */
  puff(p: THREE.Vector3, color: number, count = 6, speed = 2.5) {
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true });
    const geo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const bits = Array.from({ length: count }, () => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      this.scene.add(m);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      return { m, v };
    });
    let t = 0;
    this.effects.push({
      update: (dt) => {
        t += dt;
        for (const b of bits) {
          b.v.y -= 9.8 * dt;
          b.m.position.addScaledVector(b.v, dt);
          b.m.rotation.x += dt * 8;
        }
        mat.opacity = Math.max(0, 1 - t / 0.6);
        return t < 0.6;
      },
      dispose: () => {
        for (const b of bits) this.scene.remove(b.m);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  clear() {
    for (const p of this.live) this.scene.remove(p.mesh);
    for (const e of this.effects) e.dispose();
    for (const t of this.trails) {
      this.scene.remove(t.mesh);
      t.dispose();
    }
    for (const d of this.decals) this.scene.remove(d);
    this.live = [];
    this.effects = [];
    this.trails = [];
    this.decals = [];
  }
}
