import * as THREE from 'three';
import { HULL, LEG_PARTS, ORGANS, PIVOTS, PartId, Pose, Shape } from '../animals/anatomy';
import type { DeerHit } from '../animals/deer';
import { shapeMesh } from '../animals/deerModel';

const SKIN = new THREE.MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.12, depthWrite: false });
const ORGAN_IDLE = new THREE.MeshLambertMaterial({ color: 0xb58a8a, transparent: true, opacity: 0.35 });
const BONE_IDLE = new THREE.MeshLambertMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.45 });
const ORGAN_HIT = new THREE.MeshLambertMaterial({ color: 0xff3030, emissive: 0x801010 });
const PATH = new THREE.MeshBasicMaterial({ color: 0xffd23f });
const ENTRY = new THREE.MeshBasicMaterial({ color: 0xffffff });

/**
 * X-ray of a harvested deer: translucent body, organs (hit ones in red) and each bullet's path,
 * slowly turning. Uses its own small renderer so it can sit in the harvest screen.
 */
export class XRay {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  private spin = new THREE.Group();
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    this.scene.add(this.spin);
    this.camera.position.set(0, 1.2, 3.6);
    this.camera.lookAt(0, 0.85, 0);
  }

  show(hits: DeerHit[]) {
    this.spin.clear();
    const pose: Pose = hits[0]?.pose ?? { neckPitch: 0, legs: [0, 0, 0, 0] };
    const hitIds = new Set(hits.flatMap((h) => h.wound.organs.map((o) => o.organ.id)));
    const body = new THREE.Group();
    body.position.set(0, 0, -0.1); // centre the animal on the turntable
    this.spin.add(body);

    // Posable part groups mirroring the deer model.
    const parts = new Map<PartId, THREE.Group>();
    for (const id of ['neck', ...LEG_PARTS] as PartId[]) {
      const g = new THREE.Group();
      g.position.set(PIVOTS[id].x, PIVOTS[id].y, PIVOTS[id].z);
      g.rotation.x = id === 'neck' ? pose.neckPitch : pose.legs[LEG_PARTS.indexOf(id)];
      parts.set(id, g);
      body.add(g);
    }
    const place = (shape: Shape, mat: THREE.Material) => {
      const parent = shape.part ? parts.get(shape.part)! : body;
      parent.add(shapeMesh(shape, shape.part ? parent.position : new THREE.Vector3(), mat));
    };
    for (const s of HULL) place(s, SKIN);
    for (const o of ORGANS) {
      const mat = hitIds.has(o.id) ? ORGAN_HIT : o.bone ? BONE_IDLE : ORGAN_IDLE;
      for (const s of o.shapes) place(s, mat);
    }

    // Bullet paths in the body frame (wounds are traced in the posed body frame).
    for (const h of hits) {
      const w = h.wound;
      const a = new THREE.Vector3(w.entry.x, w.entry.y, w.entry.z);
      const b = w.exit
        ? new THREE.Vector3(w.exit.x, w.exit.y, w.exit.z)
        : a.clone().addScaledVector(new THREE.Vector3(w.dir.x, w.dir.y, w.dir.z), w.penetration);
      // Extend a little beyond the body so entry and exit read clearly.
      const dir = b.clone().sub(a).normalize();
      const from = a.clone().addScaledVector(dir, -0.35);
      const to = w.exit ? b.clone().addScaledVector(dir, 0.35) : b;
      const len = from.distanceTo(to);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 6), PATH);
      rod.position.copy(from).add(to).multiplyScalar(0.5);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), ENTRY);
      dot.position.copy(a);
      body.add(rod, dot);
      if (!w.exit) {
        const slug = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), PATH);
        slug.position.copy(b);
        body.add(slug);
      }
    }
    this.resize();
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.spin.rotation.y += 0.008;
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    // Start broadside to the first bullet's entry side.
    this.spin.rotation.y = hits[0] && hits[0].wound.entry.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    loop();
  }

  hide() {
    cancelAnimationFrame(this.raf);
  }

  private resize() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 220;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
