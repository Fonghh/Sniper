import * as THREE from 'three';

// Flight-path ribbons: a camera-facing strip through the sampled positions, kept a constant
// width on screen so long shots stay readable, fading out after the projectile lands.

const MAX_POINTS = 160;

let indexArray: Uint16Array | null = null;
/** Each geometry gets its own attribute (disposing one must not free another's buffer). */
function quadIndex(): THREE.BufferAttribute {
  if (!indexArray) {
    const idx: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    indexArray = new Uint16Array(idx);
  }
  return new THREE.BufferAttribute(indexArray, 1);
}

const t = new THREE.Vector3();
const view = new THREE.Vector3();
const side = new THREE.Vector3();

export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private age = -1; // negative while the projectile is still flying
  private pos = new Float32Array(MAX_POINTS * 2 * 3);
  private mat: THREE.MeshBasicMaterial;

  constructor(
    color: number,
    private opacity: number,
    private life: number, // s to fade after landing
    private width = 0.0045, // half-width per metre of distance (≈ radians of view)
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setIndex(quadIndex());
    geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  add(p: { x: number; y: number; z: number }) {
    if (this.pts.length >= MAX_POINTS) this.pts.splice(1, 1); // thin out the middle
    this.pts.push(new THREE.Vector3(p.x, p.y, p.z));
  }

  finish() {
    if (this.age < 0) this.age = 0;
  }

  /** Rebuilds the strip facing the camera; false once fully faded. */
  update(dt: number, camera: THREE.Vector3): boolean {
    if (this.age >= 0) {
      this.age += dt;
      this.mat.opacity = this.opacity * Math.max(0, 1 - this.age / this.life);
      if (this.age > this.life) return false;
    }
    const n = this.pts.length;
    if (n < 2) return true;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      t.copy(this.pts[Math.min(n - 1, i + 1)]).sub(this.pts[Math.max(0, i - 1)]);
      view.copy(camera).sub(p);
      const w = Math.max(0.006, view.length() * this.width);
      side.crossVectors(t, view).normalize().multiplyScalar(w);
      this.pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    return true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
