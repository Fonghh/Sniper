import * as THREE from 'three';
import type { Course } from './course';

// Snow spray off the board's edge and the track it leaves in the snow.

const SPRAY_MAX = 600;

export class Spray {
  readonly points: THREE.Points;
  private pos = new Float32Array(SPRAY_MAX * 3);
  private vel = new Float32Array(SPRAY_MAX * 3);
  private life = new Float32Array(SPRAY_MAX);
  private next = 0;
  private carry = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.28, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < SPRAY_MAX; i++) this.pos[i * 3 + 1] = -1e5;
    scene.add(this.points);
  }

  /** Emits `rate` particles per second from `at`, thrown along `dir`. */
  emit(dt: number, rate: number, at: THREE.Vector3, dir: THREE.Vector3, carry: THREE.Vector3) {
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const i = this.next;
      this.next = (this.next + 1) % SPRAY_MAX;
      const k = i * 3;
      this.pos[k] = at.x + (Math.random() - 0.5) * 0.6;
      this.pos[k + 1] = at.y + 0.05;
      this.pos[k + 2] = at.z + (Math.random() - 0.5) * 0.6;
      const s = 2 + Math.random() * 4;
      this.vel[k] = dir.x * s + carry.x * 0.6 + (Math.random() - 0.5);
      this.vel[k + 1] = 1.5 + Math.random() * 2.5;
      this.vel[k + 2] = dir.z * s + carry.z * 0.6 + (Math.random() - 0.5);
      this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number) {
    for (let i = 0; i < SPRAY_MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -1e5;
        continue;
      }
      this.vel[k + 1] -= 6 * dt;
      const drag = 1 - 2.5 * dt;
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < SPRAY_MAX; i++) this.pos[i * 3 + 1] = -1e5;
  }
}

const TRACK_MAX = 900;

/** A strip pressed into the snow behind the board; wider where it skidded. */
export class Track {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(TRACK_MAX * 2 * 3);
  private n = 0;
  private last = new THREE.Vector3(1e9, 0, 0);

  constructor(scene: THREE.Scene, private course: Course) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < TRACK_MAX - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: 0xc4d3e8,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  /** Adds a point when the board has moved far enough; width 0 breaks the strip (in the air). */
  add(at: THREE.Vector3, travel: THREE.Vector3, width: number, force = false) {
    if (!force && at.distanceToSquared(this.last) < 0.36) return;
    this.last.copy(at);
    if (this.n >= TRACK_MAX) {
      this.pos.copyWithin(0, 6);
      this.n -= 1;
    }
    const side = new THREE.Vector3(-travel.z, 0, travel.x).normalize().multiplyScalar(width / 2);
    const k = this.n * 6;
    for (const [i, s] of [[0, 1], [1, -1]] as const) {
      const x = at.x + side.x * s;
      const z = at.z + side.z * s;
      this.pos[k + i * 3] = x;
      this.pos[k + i * 3 + 1] = this.course.height(x, z) + 0.02;
      this.pos[k + i * 3 + 2] = z;
    }
    this.n += 1;
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, this.n - 1) * 6);
  }

  clear() {
    this.n = 0;
    this.last.set(1e9, 0, 0);
    this.mesh.geometry.setDrawRange(0, 0);
  }
}
