import * as THREE from 'three';
import { mulberry32 } from '../world/random';
import type { Terrain } from '../world/terrain';
import { WATER_LEVEL } from '../world/terrain';

// "Picture book" look: soft cel shading, warm brown ink outlines with a hand-drawn wobble,
// a pastel watercolour wash and paper grain. Implemented as a material swap plus one
// full-screen post-process pass, so it can be switched on without touching game code.

const INK = new THREE.Color(0x5b4636);
const PAPER = new THREE.Color(0xf4efe4);

/** Three-step toon ramp with soft shoulders, like flat watercolour washes. */
function toonRamp(): THREE.DataTexture {
  const data = new Uint8Array([196, 196, 196, 255, 228, 228, 228, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Brighter, softer palette: lift colours toward pastel, and pull greens toward the fresh
 * yellow-green of a watercolour meadow rather than olive.
 */
function pastel(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  let h = hsl.h;
  if (h > 0.15 && h < 0.4) h = h * 0.7 + 0.25 * 0.3; // greens and olives → yellow-green
  const s = Math.min(hsl.s * 1.05, 0.62);
  return new THREE.Color().setHSL(h, s, 0.42 + hsl.l * 0.6);
}

/** Replaces Lambert materials with toon materials, keeping colours, vertex colours and shader hooks. */
export function toonify(root: THREE.Object3D) {
  const ramp = toonRamp();
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material): THREE.Material => {
      if (!(m instanceof THREE.MeshLambertMaterial)) return m;
      let t = cache.get(m);
      if (!t) {
        const toon = new THREE.MeshToonMaterial({
          color: pastel(m.color),
          vertexColors: m.vertexColors,
          gradientMap: ramp,
          transparent: m.transparent,
          opacity: m.opacity,
          side: m.side,
          emissive: m.emissive,
        });
        toon.onBeforeCompile = m.onBeforeCompile; // keeps wind sway on vegetation
        t = toon;
        cache.set(m, t);
      }
      return t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

/** Pastel-shift vertex colours (terrain) the same way as material colours. */
export function pastelVertexColors(root: THREE.Object3D) {
  const c = new THREE.Color();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const col = o.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col || o.geometry.userData.pastel) return;
    o.geometry.userData.pastel = true;
    for (let i = 0; i < col.count; i++) {
      c.fromBufferAttribute(col, i);
      pastel(c).toArray(col.array as Float32Array, i * 3);
    }
    col.needsUpdate = true;
  });
}

/** Wildflowers scattered across the gentle slopes: the picture-book signature. */
export function createFlowers(terrain: Terrain, count: number): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(terrain.seed + 300);
  const colours = [0xf2c94c, 0xf4a6b8, 0xffffff, 0xe8865a];
  const petal = new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2);
  const heart = new THREE.CircleGeometry(0.024, 6).rotateX(-Math.PI / 2).translate(0, 0.005, 0);
  const stem = new THREE.CylinderGeometry(0.005, 0.007, 0.25, 4).translate(0, 0.125, 0);
  const stemMat = new THREE.MeshBasicMaterial({ color: 0x7aa35a });
  const heartMat = new THREE.MeshBasicMaterial({ color: 0xf6d36b });
  const m = new THREE.Matrix4();
  for (const colour of colours) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; pts.length < count / colours.length && i < count * 10; i++) {
      const x = (rand() - 0.5) * 880;
      const z = (rand() - 0.5) * 880;
      const h = terrain.height(x, z);
      if (h < WATER_LEVEL + 0.8 || h > 140 || terrain.slope(x, z, 2) > 0.5) continue;
      pts.push(new THREE.Vector3(x, h, z));
    }
    const petals = new THREE.InstancedMesh(petal, new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide }), pts.length);
    const hearts = new THREE.InstancedMesh(heart, heartMat, pts.length);
    const stems = new THREE.InstancedMesh(stem, stemMat, pts.length);
    pts.forEach((p, i) => {
      const s = 0.8 + rand() * 0.8;
      m.makeScale(s, s, s).setPosition(p);
      stems.setMatrixAt(i, m);
      m.makeScale(s, s, s).setPosition(p.x, p.y + 0.25 * s, p.z);
      petals.setMatrixAt(i, m);
      hearts.setMatrixAt(i, m);
    });
    group.add(stems, petals, hearts);
  }
  return group;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform vec3 ink;
uniform vec3 paper;
uniform float time;
uniform mat4 invProjection;
uniform mat4 cameraWorld;
uniform vec3 skyTop;
uniform vec3 skyHorizon;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  // Hand-drawn wobble: nudge the sampling position by slow noise so lines are not ruler-straight.
  vec2 px = 1.0 / resolution;
  vec2 wobble = (vec2(noise(vUv * 90.0), noise(vUv * 90.0 + 7.3)) - 0.5) * px * 2.2;
  vec2 uv = vUv + wobble;

  vec3 col = texture2D(tColor, uv).rgb;
  float rawDepth = texture2D(tDepth, uv).x;

  // Sky: a painted wash from blue overhead to warm paper at the horizon, with soft clouds.
  if (rawDepth >= 0.9999) {
    vec4 view = invProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dir = normalize((cameraWorld * vec4(normalize(view.xyz / view.w), 0.0)).xyz);
    float up = clamp(dir.y * 2.2, 0.0, 1.0);
    vec3 sky = mix(skyHorizon, skyTop, smoothstep(0.0, 1.0, up));
    vec2 cp = dir.xz / max(dir.y + 0.25, 0.1) * 1.6;
    float cloud = smoothstep(0.55, 0.8, noise(cp * 1.3) * 0.65 + noise(cp * 3.1) * 0.35);
    sky = mix(sky, vec3(1.0, 0.99, 0.96), cloud * 0.85 * smoothstep(0.02, 0.25, dir.y));
    float g = hash(floor(vUv * resolution / 1.5)) * 0.03 + noise(vUv * resolution / 3.0) * 0.03;
    gl_FragColor = vec4(sky - g, 1.0);
    return;
  }

  // Ink outlines from depth discontinuities (silhouettes) and colour edges (shapes).
  float d = linearDepth(uv);
  float dl = linearDepth(uv - vec2(px.x, 0.0)), dr = linearDepth(uv + vec2(px.x, 0.0));
  float du = linearDepth(uv + vec2(0.0, px.y)), dd = linearDepth(uv - vec2(0.0, px.y));
  float depthEdge = (abs(dl - dr) + abs(du - dd)) / max(d, 1.0);
  float cl = luma(texture2D(tColor, uv - vec2(px.x, 0.0)).rgb), cr = luma(texture2D(tColor, uv + vec2(px.x, 0.0)).rgb);
  float cu = luma(texture2D(tColor, uv + vec2(0.0, px.y)).rgb), cd = luma(texture2D(tColor, uv - vec2(0.0, px.y)).rgb);
  float colourEdge = abs(cl - cr) + abs(cu - cd);
  // Mostly silhouettes; lines fade with distance, like a painter simplifying the background.
  float far = smoothstep(25.0, 260.0, d);
  float edge = clamp(smoothstep(0.06, 0.16, depthEdge) + smoothstep(0.25, 0.45, colourEdge) * 0.4, 0.0, 1.0) * (1.0 - far * 0.9);

  // Watercolour: soft pastel wash, pigment pooling at shape edges, uneven density.
  float l = luma(col);
  col = mix(col, vec3(l), 0.12);
  col = col * 0.8 + paper * 0.24;
  float pigment = noise(vUv * resolution / 22.0) * 0.6 + noise(vUv * resolution / 7.0) * 0.4;
  col *= 0.95 + 0.08 * pigment;
  col = mix(col, col * 0.88, smoothstep(0.02, 0.2, colourEdge) * 0.5);
  // Distant haze dissolves into the paper.
  col = mix(col, mix(paper, skyHorizon, 0.5), far * 0.45);

  // Paper grain over everything.
  float grain = hash(floor(vUv * resolution / 1.5)) * 0.05 + noise(vUv * resolution / 3.0) * 0.04;
  col -= grain * 0.6;

  col = mix(col, ink, edge * 0.85);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Renders the scene into an offscreen target, then paints it to the screen with the book look. */
export class BookRenderer {
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 2500 },
        ink: { value: INK },
        paper: { value: PAPER },
        time: { value: 0 },
        invProjection: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        skyTop: { value: new THREE.Color(0x9cc3e6) },
        skyHorizon: { value: new THREE.Color(0xf3efe2) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.postScene.add(this.quad);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target.width !== size.x || this.target.height !== size.y) {
      this.target.setSize(size.x, size.y);
      this.material.uniforms.resolution.value.copy(size);
    }
    this.material.uniforms.cameraNear.value = camera.near;
    this.material.uniforms.cameraFar.value = camera.far;
    this.material.uniforms.invProjection.value.copy(camera.projectionMatrixInverse);
    this.material.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }
}

/** Sky and fog colours for the book look: soft blue fading to warm paper. */
export function bookSky(scene: THREE.Scene) {
  const sky = new THREE.Color(0xcfe0ee);
  (scene.background as THREE.Color).copy(sky);
  (scene.fog as THREE.Fog).color.copy(new THREE.Color(0xe9eee9));
}
