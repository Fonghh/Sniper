import * as THREE from 'three';

// First-person bow (or crossbow after the skill) held in front of the camera. The string
// draws back between shots and snaps forward when an arrow leaves.

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function buildBow() {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.32, 0), new THREE.Vector3(0, 0, -0.22), new THREE.Vector3(0, -0.32, 0));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.018, 6), lambert(0xd8352f)));
  for (const y of [0.1, -0.1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), lambert(0xffd23c));
    trim.position.set(0, y, -0.165);
    g.add(trim);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.05), lambert(0x5a3a22));
  grip.position.z = -0.11;
  g.add(grip);
  return g;
}

function buildCrossbow() {
  const g = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.6), lambert(0x2f6fd6));
  stock.position.z = -0.1;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.6), lambert(0x222833));
  rail.position.set(0, 0.045, -0.12);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.3, 0, -0.32), new THREE.Vector3(0, 0, -0.46), new THREE.Vector3(0.3, 0, -0.32));
  const limbs = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.02, 6), lambert(0x2f6fd6));
  limbs.position.y = 0.03;
  g.add(stock, rail, limbs);
  return g;
}

export class BowView {
  readonly group = new THREE.Group();
  private bow = buildBow();
  private crossbow = buildCrossbow();
  private string: THREE.Line;
  private arrow: THREE.Group;
  private hand: THREE.Mesh;
  private kick = 0;
  private bob = 0;
  crossbowMode = false;

  constructor(camera: THREE.Camera) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    this.string = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfaf6ea }));
    this.string.frustumCulled = false;
    this.arrow = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.7).translate(0, 0, -0.35), lambert(0xb07a45));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    tip.position.z = -0.72;
    this.arrow.add(shaft, tip);
    this.hand = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.06), lambert(0xe8b98c));
    this.group.add(this.bow, this.crossbow, this.string, this.arrow, this.hand);
    camera.add(this.group);
  }

  shot() {
    this.kick = 1;
  }

  /** `draw` 0..1 is how far the string is pulled (rises toward the next shot). */
  update(dt: number, draw: number, moving: number) {
    this.kick *= Math.exp(-dt * 16);
    this.bob += dt * moving * 9;
    const bx = Math.sin(this.bob) * 0.006 * Math.min(1, moving);
    const by = -Math.abs(Math.cos(this.bob)) * 0.008 * Math.min(1, moving);
    this.bow.visible = !this.crossbowMode;
    this.crossbow.visible = this.crossbowMode;
    const pts = this.string.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (this.crossbowMode) {
      const g = this.crossbow;
      g.position.set(0.07 + bx, -0.13 + by, -0.32 + this.kick * 0.05);
      g.rotation.set(this.kick * 0.08, 0, 0);
      const back = -0.3 + draw * 0.1;
      pts.setXYZ(0, g.position.x - 0.3, g.position.y + 0.03, g.position.z - 0.32);
      pts.setXYZ(1, g.position.x, g.position.y + 0.04, g.position.z + back + 0.2);
      pts.setXYZ(2, g.position.x + 0.3, g.position.y + 0.03, g.position.z - 0.32);
      this.arrow.position.set(g.position.x, g.position.y + 0.05, g.position.z + 0.12);
      this.arrow.scale.setScalar(0.65);
      this.arrow.visible = draw > 0.3;
      this.hand.position.set(g.position.x + 0.02, g.position.y - 0.07, g.position.z + 0.15);
    } else {
      const g = this.bow;
      // Held canted almost flat across the bottom of the view, like the reference.
      g.position.set(0.04 + bx, -0.17 + by, -0.42 + this.kick * 0.03);
      g.rotation.set(0.12, 0.04, 1.25);
      const nock = 0.02 + draw * 0.24;
      const p = (y: number, z: number) => new THREE.Vector3(0, y, z).applyEuler(g.rotation).add(g.position);
      const top = p(0.32, 0);
      const mid = p(0, nock);
      const bot = p(-0.32, 0);
      pts.setXYZ(0, top.x, top.y, top.z);
      pts.setXYZ(1, mid.x, mid.y, mid.z);
      pts.setXYZ(2, bot.x, bot.y, bot.z);
      this.arrow.position.copy(mid);
      this.arrow.quaternion.setFromEuler(new THREE.Euler(0.03, 0, 0));
      this.arrow.scale.setScalar(1);
      this.arrow.visible = draw > 0.15;
      this.hand.position.copy(p(0, -0.11));
    }
    pts.needsUpdate = true;
  }
}
