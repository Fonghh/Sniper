import * as THREE from 'three';
import { createCharacter } from './character';
import { Zone, hitZone } from './hitbox';
import type { V3 } from './projectile';
import type { ArenaWorld } from './world';

// Practice targets: static dummies at marked distances, dummies sliding on rails, and one
// circling runner. They take damage like characters, fall over, and pop back up.

export type Motion =
  | { kind: 'static' }
  | { kind: 'rail'; axis: THREE.Vector3; amplitude: number; speed: number }
  | { kind: 'circle'; radius: number; speed: number };

const RESPAWN = 2.2; // s

/** Anything that can be shot: a target dummy or a bot. */
export interface Hittable {
  /** Members of the same team cannot hurt each other (bots have none: free-for-all). */
  readonly team?: string;
  readonly alive: boolean;
  readonly position: THREE.Vector3;
  /** First zone a world segment touches, with the fraction along it. */
  test(a: V3, b: V3): { zone: Zone; t: number } | null;
  damage(amount: number, zone: Zone): boolean; // true if this hit killed it
}

export class TargetDummy implements Hittable {
  readonly model = createCharacter({ body: 0xf4f1ea, legs: 0x8a5a3a, head: 0xf4d6a0, accent: 0xe04a3a });
  hp = 100;
  private anchor: THREE.Vector3;
  private time = Math.random() * 10;
  private downFor = 0;
  private inv = new THREE.Matrix4();
  readonly label: THREE.Sprite;

  constructor(
    private world: ArenaWorld,
    lx: number,
    lz: number,
    face: THREE.Vector3,
    private motion: Motion,
    labelText: string,
  ) {
    this.anchor = world.at(lx, lz);
    this.model.root.position.copy(this.anchor);
    this.model.root.lookAt(new THREE.Vector3(face.x, this.anchor.y, face.z));
    this.model.arms.visible = false;
    this.label = makeLabel(labelText);
    this.label.position.set(0, 2.25, 0);
    this.model.root.add(this.label);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get position(): THREE.Vector3 {
    return this.model.root.position;
  }

  update(dt: number) {
    this.time += dt;
    const root = this.model.root;
    if (this.motion.kind === 'rail') {
      const off = Math.sin((this.time * this.motion.speed) / this.motion.amplitude) * this.motion.amplitude;
      root.position.copy(this.anchor).addScaledVector(this.motion.axis, off);
    } else if (this.motion.kind === 'circle') {
      const a = (this.time * this.motion.speed) / this.motion.radius;
      root.position.set(this.anchor.x + Math.cos(a) * this.motion.radius, 0, this.anchor.z + Math.sin(a) * this.motion.radius);
      root.rotation.y = -a; // face along the direction of travel
    }
    root.position.y = this.world.height(root.position.x, root.position.z);

    if (!this.alive) {
      this.downFor += dt;
      this.model.body.rotation.x = -Math.min(1, this.downFor * 5) * (Math.PI / 2 - 0.1);
      if (this.downFor > RESPAWN) {
        this.hp = 100;
        this.downFor = 0;
        this.model.body.rotation.x = 0;
      }
    }
    root.updateMatrixWorld();
  }

  test(a: V3, b: V3) {
    if (!this.alive) return null;
    this.inv.copy(this.model.root.matrixWorld).invert();
    const la = new THREE.Vector3(a.x, a.y, a.z).applyMatrix4(this.inv);
    const lb = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(this.inv);
    return hitZone(la, lb);
  }

  damage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    return this.hp <= 0;
  }
}

function makeLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,24,20,0.7)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 40, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 25);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  sprite.scale.set(1.1, 0.42, 1);
  return sprite;
}

/** The practice range: static dummies at 10–70 m, two on rails, one running in a circle. */
export function createRange(world: ArenaWorld, playerSpawn: THREE.Vector3): TargetDummy[] {
  const face = playerSpawn;
  const out: TargetDummy[] = [];
  const spawnLocal = { x: playerSpawn.x - world.center.x, z: playerSpawn.z - world.center.z };
  for (const [d, x] of [[10, -4], [20, 3], [35, -6], [50, 5], [70, -2]] as const) {
    out.push(new TargetDummy(world, spawnLocal.x + x, spawnLocal.z + d, face, { kind: 'static' }, `${d} m`));
  }
  const across = new THREE.Vector3(1, 0, 0);
  out.push(new TargetDummy(world, spawnLocal.x, spawnLocal.z + 28, face, { kind: 'rail', axis: across, amplitude: 7, speed: 3 }, '28 m ↔'));
  out.push(new TargetDummy(world, spawnLocal.x + 4, spawnLocal.z + 45, face, { kind: 'rail', axis: across, amplitude: 9, speed: 5.5 }, '45 m ↔'));
  out.push(new TargetDummy(world, spawnLocal.x - 14, spawnLocal.z + 60, face, { kind: 'circle', radius: 8, speed: 6 }, '跑'));
  return out;
}
