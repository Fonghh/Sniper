import * as THREE from 'three';
import createFireball, { VFXHandle } from '../vfx/fireball';

// Hit effects: additive spark/puff particles, lightning bolts, explosions.

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A pool of glowing particles sharing one size. */
class Pool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private base: Float32Array;
  private grav: Float32Array;
  private next = 0;

  constructor(
    scene: THREE.Scene,
    private max: number,
    size: number,
    additive: boolean,
    tex: THREE.Texture,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1e5;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size,
        map: tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number, gravity: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = gravity;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1e5;
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = 1 - 2 * dt;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;
const tmpC = new THREE.Color();

interface Timed {
  update(dt: number): boolean;
  dispose(): void;
}

export class Fx {
  private sparks: Pool;
  private puffs: Pool;
  private timed: Timed[] = [];

  constructor(private scene: THREE.Scene) {
    const tex = dotTexture();
    this.sparks = new Pool(scene, 1400, 0.22, true, tex);
    this.puffs = new Pool(scene, 500, 0.9, false, tex);
  }

  /** Bright burst where an arrow hits. */
  burst(p: THREE.Vector3, color: number, count = 14, speed = 6) {
    tmpC.setHex(color);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.set(rnd(1), Math.random() * 1.2, rnd(1)).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.sparks.spawn(p, v, tmpC, 0.3 + Math.random() * 0.35, 9);
    }
  }

  /** Soft smoke/snow puff. */
  puff(p: THREE.Vector3, color: number, count = 8, spread = 1.2) {
    tmpC.setHex(color);
    const v = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      q.set(p.x + rnd(spread * 0.4), p.y + rnd(spread * 0.3), p.z + rnd(spread * 0.4));
      v.set(rnd(spread), Math.random() * spread, rnd(spread));
      this.puffs.spawn(q, v, tmpC, 0.5 + Math.random() * 0.4, -0.5);
    }
  }

  /** A trickle from an enemy under a status effect. */
  status(p: THREE.Vector3, color: number, rising: boolean) {
    tmpC.setHex(color);
    const q = new THREE.Vector3(p.x + rnd(0.3), p.y + rnd(0.3), p.z + rnd(0.3));
    this.sparks.spawn(q, new THREE.Vector3(rnd(0.4), rising ? 1.5 : -0.5, rnd(0.4)), tmpC, 0.5, rising ? -1 : 2);
  }

  /** Jagged bolt from a to b that flickers out. */
  bolt(a: THREE.Vector3, b: THREE.Vector3, color = 0xc58bff) {
    const pts: THREE.Vector3[] = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(new THREE.Vector3(rnd(0.35), rnd(0.35), rnd(0.35)));
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    const glow = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending }));
    this.scene.add(line, glow);
    let t = 0;
    this.timed.push({
      update: (dt) => {
        t += dt;
        mat.opacity = Math.max(0, 1 - t / 0.25) * (Math.random() > 0.3 ? 1 : 0.3);
        (glow.material as THREE.LineBasicMaterial).opacity = mat.opacity * 0.6;
        return t < 0.25;
      },
      dispose: () => {
        this.scene.remove(line, glow);
        geo.dispose();
      },
    });
    this.burst(b, color, 10, 4);
  }

  /** Fireball burst plus a flash sphere and sparks. */
  explosion(p: THREE.Vector3, radius: number, color = 0xffa13a) {
    const fx: VFXHandle = createFireball();
    fx.group.scale.setScalar(radius * 0.55);
    fx.group.position.copy(p);
    this.scene.add(fx.group);
    fx.update(0.05);
    fx.hit(p, new THREE.Vector3(0, 1, 0));
    const flash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    flash.position.copy(p);
    this.scene.add(flash);
    let t = 0;
    this.timed.push({
      update: (dt) => {
        t += dt;
        fx.update(dt);
        const k = Math.min(1, t / 0.25);
        flash.scale.setScalar(radius * (0.3 + k * 0.9));
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        return !(fx.finished && t > 0.25) && t < 3;
      },
      dispose: () => {
        this.scene.remove(fx.group, flash);
        fx.dispose();
        flash.geometry.dispose();
      },
    });
    this.burst(p, 0xffd25a, 24, 9);
    this.puff(p, 0xe2d6c4, 4, radius * 0.7); // light dust: dark smoke would hide the targets
  }

  /** Expanding ring on the ground (bomb warnings, shockwaves). */
  ring(p: THREE.Vector3, radius: number, color: number, life: number): { done: () => void } {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 32).rotateX(-Math.PI / 2), mat);
    mesh.position.copy(p).setY(p.y + 0.06);
    this.scene.add(mesh);
    let t = 0;
    let over = false;
    this.timed.push({
      update: (dt) => {
        t += dt;
        mat.opacity = 0.45 + 0.35 * Math.sin(t * 14);
        return !over && t < life;
      },
      dispose: () => {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mat.dispose();
      },
    });
    return { done: () => (over = true) };
  }

  update(dt: number) {
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.timed = this.timed.filter((e) => {
      const keep = e.update(dt);
      if (!keep) e.dispose();
      return keep;
    });
  }
}
