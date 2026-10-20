import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import { BloodType, HIGHLIGHT_RADIUS, Sign } from './signs';
import type { SignBook } from './trail';

const BLOOD_COLOR: Record<BloodType, number> = {
  bright: 0xc0141c,
  frothy: 0xe0657a,
  dark: 0x5a0d12,
  gut: 0x6b5a2a,
  sparse: 0xb3191f,
};
const BLOOD_SIZE: Record<BloodType, number> = { bright: 0.14, frothy: 0.1, dark: 0.1, gut: 0.09, sparse: 0.06 };
const HOOF_MAT = new THREE.MeshLambertMaterial({ color: 0x3b2a1c });
const HAIR_MAT = new THREE.MeshLambertMaterial({ color: 0xcfb08a });
const HIGHLIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false });
const NEXT_MAT = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9, depthWrite: false });

interface View {
  sign: Sign;
  root: THREE.Group;
  ring: THREE.Mesh;
  pick: THREE.Mesh; // generous invisible sphere for tapping
}

/** Draws trail signs on the terrain and highlights them in tracking mode. */
export class SignView {
  private views = new Map<number, View>();
  private group = new THREE.Group();
  private arrows: THREE.Mesh[] = [];
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
    private book: SignBook,
  ) {
    scene.add(this.group);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  private build(sign: Sign): View {
    const root = new THREE.Group();
    const y = this.terrain.height(sign.x, sign.z);
    root.position.set(sign.x, y + 0.03, sign.z);
    // Lie flat on the slope.
    const e = 0.5;
    const n = new THREE.Vector3(
      this.terrain.height(sign.x - e, sign.z) - this.terrain.height(sign.x + e, sign.z),
      2 * e,
      this.terrain.height(sign.x, sign.z - e) - this.terrain.height(sign.x, sign.z + e),
    ).normalize();
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const flat = new THREE.Group();
    flat.rotation.y = sign.heading;
    root.add(flat);
    const disc = (r: number, mat: THREE.Material, x = 0, z = 0, sx = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 7).rotateX(-Math.PI / 2), mat);
      m.position.set(x, 0, z);
      m.scale.set(sx, 1, sz);
      flat.add(m);
    };

    const bloodMat = sign.blood ? new THREE.MeshLambertMaterial({ color: BLOOD_COLOR[sign.blood] }) : null;
    switch (sign.kind) {
      case 'blood': {
        const r = BLOOD_SIZE[sign.blood!];
        disc(r, bloodMat!);
        disc(r * 0.5, bloodMat!, r * 1.3, r * 0.8);
        if (sign.blood === 'frothy') disc(r * 0.45, new THREE.MeshLambertMaterial({ color: 0xf6c9d2 }), -r * 0.2, -r * 0.3);
        if (sign.blood === 'gut') disc(r * 0.6, new THREE.MeshLambertMaterial({ color: 0x55602a }), r * 0.4, -r * 0.5);
        break;
      }
      case 'track': {
        // A pair of split hoof prints; a running deer spreads its toes.
        const spread = sign.running ? 0.035 : 0.022;
        for (const side of [-1, 1]) disc(0.03, HOOF_MAT, side * spread, 0, 0.7, 1.5);
        break;
      }
      case 'hitSite':
        if (bloodMat) disc(0.22, bloodMat);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          disc(0.04, HAIR_MAT, Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0.4, 1.8);
        }
        break;
      case 'bed':
        disc(0.6, new THREE.MeshLambertMaterial({ color: 0x5e5a3a }), 0, 0, 0.7, 1.3); // flattened grass
        if (bloodMat) disc(0.3, bloodMat, 0.05, 0.1);
        break;
    }

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 20).rotateX(-Math.PI / 2), HIGHLIGHT_MAT);
    ring.position.y = 0.02;
    ring.visible = false;
    root.add(ring);
    const pick = new THREE.Mesh(new THREE.SphereGeometry(1.2, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.signId = sign.id;
    root.add(pick);
    this.group.add(root);
    return { sign, root, ring, pick };
  }

  update(dt: number, tracking: boolean, px: number, pz: number) {
    this.time += dt;
    for (const s of this.book.signs) if (!this.views.has(s.id)) this.views.set(s.id, this.build(s));
    const pulse = 1 + 0.15 * Math.sin(this.time * 5);
    for (const v of this.views.values()) {
      const near = Math.hypot(v.sign.x - px, v.sign.z - pz) <= HIGHLIGHT_RADIUS;
      v.ring.visible = tracking && near;
      if (v.ring.visible) v.ring.scale.setScalar(pulse * (v.sign.kind === 'track' ? 0.6 : 1));
    }
    // Floating marker over the next clue on each trail.
    const next = tracking ? this.book.nextClues() : [];
    while (this.arrows.length < next.length) {
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4).rotateX(Math.PI), NEXT_MAT);
      this.group.add(a);
      this.arrows.push(a);
    }
    this.arrows.forEach((a, i) => {
      const s = next[i];
      a.visible = !!s;
      if (s) a.position.set(s.x, this.terrain.height(s.x, s.z) + 0.9 + 0.12 * Math.sin(this.time * 3), s.z);
    });
  }

  /** Sign under a screen ray, if any (for tap-to-read). */
  pick(raycaster: THREE.Raycaster): Sign | null {
    const hits = raycaster.intersectObjects([...this.views.values()].map((v) => v.pick), false);
    const id = hits[0]?.object.userData.signId as number | undefined;
    return id === undefined ? null : this.views.get(id)!.sign;
  }
}
