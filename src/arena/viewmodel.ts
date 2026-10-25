import * as THREE from 'three';
import type { WeaponId } from './weapons';

// First-person weapon models attached to the camera (camera space: x right, y up, -z forward).

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const part = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

const SIGHT_Y = 0.09; // red dot height above the rifle's origin (on a riser mount)
const SIGHT_Z = -0.02;
const RIFLE_SCALE = 0.75;
const BOW_SCALE = 0.6;

function buildRifle() {
  const g = new THREE.Group();
  const dark = lambert(0x3a3f47);
  const orange = lambert(0xf08a24);
  const stock = part(0.045, 0.085, 0.18, 0, -0.012, 0.22, orange);
  g.add(
    part(0.05, 0.07, 0.32, 0, 0, 0, dark),
    part(0.024, 0.024, 0.3, 0, 0.012, -0.3, dark),
    part(0.056, 0.05, 0.16, 0, -0.005, -0.2, orange),
    part(0.02, 0.03, 0.03, 0, 0.045, -0.02, dark),
    stock,
    part(0.036, 0.11, 0.05, 0, -0.085, -0.05, dark),
    part(0.034, 0.08, 0.04, 0, -0.07, 0.07, dark),
  );
  // Red dot: a square frame around a glowing dot that lines up with the screen centre.
  const frame = lambert(0x22262c);
  const s = 0.042;
  g.add(
    part(s, 0.004, 0.02, 0, SIGHT_Y + s / 2, SIGHT_Z, frame),
    part(0.004, s, 0.02, -s / 2, SIGHT_Y, SIGHT_Z, frame),
    part(0.004, s, 0.02, s / 2, SIGHT_Y, SIGHT_Z, frame),
    part(s, 0.012, 0.03, 0, SIGHT_Y - s / 2 - 0.004, SIGHT_Z, frame),
  );
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  dot.position.set(0, SIGHT_Y, SIGHT_Z - 0.012);
  g.add(dot);
  const flash = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  flash.position.set(0, 0.012, -0.47);
  flash.visible = false;
  g.add(flash);
  return { group: g, flash, stock };
}

function buildBow() {
  const g = new THREE.Group();
  const limb = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, -0.3, 0));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(limb, 16, 0.012, 5), lambert(0x8b5a2b)));
  g.add(part(0.03, 0.08, 0.035, 0, 0, -0.1, lambert(0x3a2a20)));
  const stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xf5f0e0 }));
  string.frustumCulled = false;
  g.add(string);
  const arrow = new THREE.Group();
  arrow.add(part(0.008, 0.008, 0.75, 0, 0, -0.375, lambert(0x9b6b3d)));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4).rotateX(-Math.PI / 2), lambert(0x55595e));
  tip.position.z = -0.77;
  arrow.add(tip, part(0.002, 0.03, 0.08, 0, 0.012, -0.06, lambert(0xff5470)));
  g.add(arrow);
  return { group: g, string, arrow };
}

function buildGrenade() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.026, 0), lambert(0x4f8f3a)));
  g.add(part(0.01, 0.015, 0.01, 0, 0.029, 0, lambert(0x777777)));
  const hand = part(0.04, 0.03, 0.045, 0.008, -0.03, 0.012, lambert(0xe8b98c));
  g.add(hand);
  return g;
}

export class Viewmodel {
  readonly group = new THREE.Group();
  private rifle = buildRifle();
  private bow = buildBow();
  private grenade = buildGrenade();
  private weapon: WeaponId = 'rifle';
  private ads = 0;
  private recoil = 0;
  private flashLeft = 0;
  private swap = 0;
  private bob = 0;
  private hideGrenade = 0;

  constructor(camera: THREE.Camera) {
    this.group.add(this.rifle.group, this.bow.group, this.grenade);
    this.rifle.group.scale.setScalar(RIFLE_SCALE);
    this.bow.group.scale.setScalar(BOW_SCALE);
    camera.add(this.group);
    this.group.traverse((o) => {
      o.renderOrder = 10;
      o.castShadow = false;
    });
    this.setWeapon('rifle');
  }

  setWeapon(id: WeaponId) {
    if (id !== this.weapon) this.swap = 1;
    this.weapon = id;
    this.rifle.group.visible = id === 'rifle';
    this.bow.group.visible = id === 'bow';
    this.grenade.visible = id === 'grenade';
  }

  kick(amount: number) {
    this.recoil = Math.min(1.5, this.recoil + amount);
    if (this.weapon === 'rifle') this.flashLeft = 0.04;
    if (this.weapon === 'grenade') this.hideGrenade = 0.35;
  }

  update(dt: number, s: { ads: boolean; draw: number; aiming: boolean; speed: number; loaded: boolean; reloading: boolean }) {
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    this.recoil *= Math.exp(-dt * 14);
    this.swap = Math.max(0, this.swap - dt * 4);
    this.bob += dt * s.speed * 1.7;
    const bobAmt = (1 - this.ads * 0.85) * Math.min(1, s.speed / 5);
    const bx = Math.sin(this.bob) * 0.008 * bobAmt;
    const by = -Math.abs(Math.cos(this.bob)) * 0.01 * bobAmt;
    const lower = this.swap * 0.25 + (s.reloading ? 0.08 : 0);
    const a = this.ads;
    const lerp = (h: number, d: number) => h + (d - h) * a;

    if (this.weapon === 'rifle') {
      const g = this.rifle.group;
      g.position.set(lerp(0.085, 0) + bx, lerp(-0.12, -SIGHT_Y * RIFLE_SCALE) + by - lower, lerp(-0.36, -0.44) + this.recoil * 0.04);
      g.rotation.set(this.recoil * 0.12 + (s.reloading ? -0.5 : 0), lerp(0.06, 0), s.reloading ? 0.4 : 0);
      this.flashLeft -= dt;
      this.rifle.flash.visible = this.flashLeft > 0;
      this.rifle.stock.visible = a < 0.5; // it would fill the bottom of the screen when aiming
      this.rifle.flash.rotation.z = Math.random() * 6;
    } else if (this.weapon === 'bow') {
      const g = this.bow.group;
      g.position.set(lerp(0.02, 0) + bx, lerp(-0.07, -0.05) + by - lower, -0.45 + this.recoil * 0.03);
      g.rotation.set(0, 0, lerp(-0.25, -0.08));
      const nock = 0.02 + s.draw * 0.34;
      const pts = this.bow.string.geometry.getAttribute('position') as THREE.BufferAttribute;
      pts.setXYZ(0, 0, 0.3, 0);
      pts.setXYZ(1, 0, 0, nock);
      pts.setXYZ(2, 0, -0.3, 0);
      pts.needsUpdate = true;
      this.bow.arrow.visible = s.loaded;
      this.bow.arrow.position.set(0, 0, nock);
    } else {
      this.hideGrenade -= dt;
      const g = this.grenade;
      g.visible = s.loaded && this.hideGrenade <= 0;
      const pull = s.aiming ? 1 : 0;
      g.position.set(0.075 + bx, -0.11 + pull * 0.04 + by - lower, -0.36 + pull * 0.03);
    }
  }
}
