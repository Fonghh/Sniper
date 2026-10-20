import * as THREE from 'three';
import type { Ammo } from '../ballistics/ammo';
import { BulletState, DEFAULT_STEP, FlightEnv, stepBullet } from '../ballistics/ballistics';
import { length, vec3 } from '../core/vec3';
import { HALF_MAP, Terrain } from '../world/terrain';
import type { Target, TargetHit } from './targets';

const MAX_FLIGHT = 3; // s
const TRAIL_LIFE = 1.6; // s the tracer stays visible after impact

export type Impact =
  | { kind: 'target'; hit: TargetHit; range: number; time: number; velocity: number }
  | { kind: 'ground'; point: THREE.Vector3; range: number; time: number }
  | { kind: 'lost' };

interface LiveBullet {
  ammo: Ammo;
  state: BulletState;
  origin: THREE.Vector3;
  trail: THREE.Vector3[];
  line: THREE.Line;
  done: boolean;
  fade: number;
}

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
  private trailMat = new THREE.LineBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0.7 });

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
    private targets: Target[],
    private env: (t: number) => FlightEnv,
    private onImpact: (impact: Impact) => void,
  ) {}

  fire(ammo: Ammo, origin: THREE.Vector3, dir: THREE.Vector3) {
    const d = dir.clone().normalize();
    const state: BulletState = {
      pos: vec3(origin.x, origin.y, origin.z),
      vel: vec3(d.x * ammo.muzzleVelocity, d.y * ammo.muzzleVelocity, d.z * ammo.muzzleVelocity),
      time: 0,
    };
    const line = new THREE.Line(new THREE.BufferGeometry(), this.trailMat.clone());
    line.frustumCulled = false;
    this.scene.add(line);
    this.bullets.push({ ammo, state, origin: origin.clone(), trail: [origin.clone()], line, done: false, fade: TRAIL_LIFE });
  }

  update(dt: number, worldTime: number) {
    const env = this.env(worldTime);
    for (const b of this.bullets) {
      if (b.done) {
        b.fade -= dt;
        (b.line.material as THREE.LineBasicMaterial).opacity = 0.7 * Math.max(b.fade / TRAIL_LIFE, 0);
        continue;
      }
      const target = b.state.time + dt;
      while (!b.done && b.state.time < target) {
        const next = stepBullet(b.ammo, env, b.state, DEFAULT_STEP);
        this.collide(b, b.state, next);
        b.state = next;
        if (!b.done && (b.state.time > MAX_FLIGHT || Math.abs(next.pos.x) > HALF_MAP || Math.abs(next.pos.z) > HALF_MAP)) {
          b.done = true;
          this.onImpact({ kind: 'lost' });
        }
      }
      if (!b.done) b.trail.push(toV3(b.state.pos));
      b.line.geometry.setFromPoints(b.trail);
    }
    this.bullets = this.bullets.filter((b) => {
      if (b.fade > 0) return true;
      this.scene.remove(b.line);
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

  private collide(b: LiveBullet, s: BulletState, next: BulletState) {
    const a = toV3(s.pos);
    const c = toV3(next.pos);
    for (const t of this.targets) {
      const hit = t.intersect(a, c);
      if (hit) {
        this.finish(b, hit.point, 0xffffff);
        this.onImpact({ kind: 'target', hit, range: hit.point.distanceTo(b.origin), time: next.time, velocity: length(next.vel) });
        return;
      }
    }
    if (next.pos.y < this.terrain.height(next.pos.x, next.pos.z)) {
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
      this.onImpact({ kind: 'ground', point, range: point.distanceTo(b.origin), time: next.time });
    }
  }

  private finish(b: LiveBullet, point: THREE.Vector3, color: number) {
    b.done = true;
    b.trail.push(point);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 6, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    mesh.position.copy(point);
    this.scene.add(mesh);
    this.puffs.push({ mesh, age: 0 });
  }
}
