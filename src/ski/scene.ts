import * as THREE from 'three';
import { mulberry32 } from '../world/random';
import { COURSE_LENGTH, Course, FINISH_Z, START_Z } from './course';

// Builds the visible mountain: a fine mesh that follows the run, a coarse one for the
// surrounding peaks and the valley below, trees, rocks, start and finish gates, and a low
// morning sun so the walls throw long shadows across the snow.

const SNOW = new THREE.Color(0xf6f9ff);
const SNOW_SHADE = new THREE.Color(0xdbe6f5);
const ROCK = new THREE.Color(0x6e655c);
const ROCK_DARK = new THREE.Color(0x4f4943);
const FOREST = new THREE.Color(0x5b6b58);

/** Lateral offsets across the run (±250 m): fine near the centre, coarse at the edges. */
function columns(): number[] {
  const out: number[] = [];
  for (let u = 0; u <= 250; ) {
    out.push(u);
    u += u < 50 ? 1.5 : u < 100 ? 4 : 10;
  }
  return [...out.slice(1).map((u) => -u).reverse(), ...out];
}

const KICKER = new THREE.Color(0xa9c8f5);

/** `wild` is 0 on the groomed run and 1 beyond its edges, where steep faces turn to rock. */
function surfaceColor(z: number, ny: number, out: THREE.Color, rand: number, wild = 1) {
  out.copy(SNOW).lerp(SNOW_SHADE, rand * 0.5);
  // Steep faces shed their snow.
  const rock = (1 - THREE.MathUtils.smoothstep(ny, 0.6, 0.8)) * wild;
  out.lerp(rand > 0.5 ? ROCK : ROCK_DARK, rock);
  // Far below the run, the valley floor is wooded.
  if (z > COURSE_LENGTH) out.lerp(FOREST, THREE.MathUtils.smoothstep(z, COURSE_LENGTH, COURSE_LENGTH + 250) * 0.6);
  return out;
}

function buildRunMesh(course: Course, z0: number, z1: number, cols: number[]): THREE.Mesh {
  const step = 1.5;
  const rows = Math.ceil((z1 - z0) / step) + 1;
  const nc = cols.length;
  const pos = new Float32Array(rows * nc * 3);
  const col = new Float32Array(rows * nc * 3);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < rows; j++) {
    const z = Math.min(z1, z0 + j * step);
    const cx = course.centerX(z);
    for (let i = 0; i < nc; i++) {
      const x = cx + cols[i];
      const k = (j * nc + i) * 3;
      pos[k] = x;
      pos[k + 1] = course.height(x, z);
      pos[k + 2] = z;
      course.normal(x, z, n);
      const r = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      const w = course.halfWidth(z);
      surfaceColor(z, n.y, c, Math.abs(r), THREE.MathUtils.smoothstep(Math.abs(cols[i]), w - 1, w + 5));
      c.lerp(KICKER, course.onKicker(x, z) * 0.6);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i;
      index.push(a, a + nc, a + 1, a + 1, a + nc, a + nc + 1); // counter-clockwise from above
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

/** Peaks around the run and the valley beyond the finish, coarse. Sinks under the fine mesh. */
function buildSurroundings(course: Course): THREE.Mesh {
  const size = 7000;
  const seg = 140;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(0, 0, COURSE_LENGTH / 2);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    // Under the detailed run mesh, sink the coarse surface well below the whole run (not just
    // below the local height: a coarse triangle reaching from a high wall vertex would
    // otherwise cut across the run and show as patches above the real snow).
    const inside = z > -80 && z < COURSE_LENGTH + 420 && Math.abs(x - course.centerX(z)) < 200;
    const h = inside ? course.height(course.centerX(z), z) - 120 : course.height(x, z);
    p.setY(i, h);
    course.normal(x, z, n);
    surfaceColor(z, n.y * 1.05, c, ((i * 7919) % 100) / 100);
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildObstacles(course: Course): THREE.Group {
  const g = new THREE.Group();
  const rocks = course.obstacles.filter((o) => o.kind === 'rock');
  const trees = course.obstacles.filter((o) => o.kind === 'tree');
  const rand = mulberry32(5);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();

  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x6a625a, flatShading: true }), rocks.length);
  rocks.forEach((o, i) => {
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    s.set(o.r, o.top * 0.9, o.r * (0.8 + rand() * 0.4));
    v.set(o.x, course.height(o.x, o.z) + o.top * 0.3, o.z);
    rockMesh.setMatrixAt(i, m.compose(v, q, s));
  });
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  g.add(rockMesh);

  // Snowy pines: two stacked cones and a trunk.
  const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x2f5a3c, flatShading: true }), trees.length);
  const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xe9f1f8, flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.22, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), trees.length);
  trees.forEach((o, i) => {
    const base = course.height(o.x, o.z);
    const yaw = rand() * 6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const w = o.top * 0.32;
    lower.setMatrixAt(i, m.compose(v.set(o.x, base + o.top * 0.15, o.z), q, s.set(w, o.top * 0.7, w)));
    upper.setMatrixAt(i, m.compose(v.set(o.x, base + o.top * 0.55, o.z), q, s.set(w * 0.62, o.top * 0.45, w * 0.62)));
    trunk.setMatrixAt(i, m.compose(v.set(o.x, base - 0.2, o.z), q, s.set(1, o.top * 0.3, 1)));
  });
  for (const t of [lower, upper, trunk]) {
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

function banner(text: string, color: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  return new THREE.Mesh(new THREE.PlaneGeometry(8, 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
}

function gate(course: Course, z: number, text: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const x = course.centerX(z);
  const pole = new THREE.MeshLambertMaterial({ color: 0x333a44 });
  for (const s of [-4.5, 4.5]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5), pole);
    p.position.set(x + s, course.height(x + s, z) + 2.5, z);
    p.castShadow = true;
    g.add(p);
  }
  const b = banner(text, color);
  b.rotation.y = Math.PI; // face the riders coming down (-z)
  b.position.set(x, course.height(x, z) + 4.6, z);
  g.add(b);
  return g;
}

export interface SkiScene {
  sun: THREE.DirectionalLight;
}

export function buildSkiScene(scene: THREE.Scene, course: Course): SkiScene {
  scene.background = new THREE.Color(0x9cc8ef);
  scene.fog = new THREE.Fog(0xc9def2, 400, 3200);
  scene.add(new THREE.HemisphereLight(0xd6e6ff, 0xb4bfd2, 1.8));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 600;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  const cols = columns();
  for (let z = -60; z < COURSE_LENGTH + 380; z += 120) scene.add(buildRunMesh(course, z, Math.min(z + 120, COURSE_LENGTH + 380), cols));
  scene.add(buildSurroundings(course));
  scene.add(buildObstacles(course));
  scene.add(gate(course, START_Z + 4, 'START', '#2a7de1'), gate(course, FINISH_Z, 'FINISH', '#e1462a'));
  return { sun };
}

/** Keeps the shadow box centred on the rider, with the sun low in the east. */
export function followSun(s: SkiScene, at: THREE.Vector3) {
  s.sun.position.set(at.x + 140, at.y + 260, at.z - 90);
  s.sun.target.position.copy(at);
  s.sun.target.updateMatrixWorld();
}
