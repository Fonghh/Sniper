import * as THREE from 'three';
import { mulberry32 } from './random';
import { createNoise2D } from './noise';
import { HALF_MAP, Terrain, WATER_LEVEL } from './terrain';

/** Shared uniforms that drive wind sway on all vegetation. */
export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0, 0) }, // world-space wind velocity (x, z) in m/s
};

/**
 * Adds a vertex-shader sway proportional to height above the instance base.
 * Instances are never rotated, so local x/z stay aligned with world x/z.
 */
function swayMaterial(color: number, stiffness: number): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        float gust = 0.6 + 0.4 * sin(uTime * 1.7 + phase);
        float bend = max(position.y, 0.0) * ${stiffness.toFixed(4)};
        transformed.xz += uWind * bend * gust;`,
      );
  };
  return mat;
}

/** Horizontal distance from a point to the segment a→b. */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function scatter(
  terrain: Terrain,
  count: number,
  seed: number,
  accept: (x: number, z: number, h: number, slope: number, r: number) => boolean,
): THREE.Vector3[] {
  const rand = mulberry32(seed);
  const out: THREE.Vector3[] = [];
  const limit = HALF_MAP - 40;
  for (let tries = 0; tries < count * 12 && out.length < count; tries++) {
    const x = (rand() * 2 - 1) * limit;
    const z = (rand() * 2 - 1) * limit;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 0.8) continue;
    if (accept(x, z, h, terrain.slope(x, z, 2), rand())) out.push(new THREE.Vector3(x, h, z));
  }
  return out;
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, points: THREE.Vector3[], size: (i: number) => number) {
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  const m = new THREE.Matrix4();
  points.forEach((p, i) => {
    const s = size(i);
    m.makeScale(s, s, s).setPosition(p);
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/** Something the rifle can be rested on: a rock or a tree trunk. */
export interface RestPoint {
  x: number;
  z: number;
  radius: number;
}

export function createVegetation(terrain: Terrain): { group: THREE.Group; rests: RestPoint[] } {
  const group = new THREE.Group();
  const rests: RestPoint[] = [];
  const forest = createNoise2D(terrain.seed + 50);
  const spawn = terrain.spawnPoint();
  const rand = mulberry32(terrain.seed + 77);

  // Conifers grow in patches on the flanks; valley meadows stay open so deer are visible.
  const trees = scatter(terrain, 2200, terrain.seed + 10, (x, z, h, slope, r) => {
    if (slope > 0.75) return false;
    // Keep the opening shot's sight line clear.
    if (distToSegment(x, z, spawn.x, spawn.z, spawn.target.x, spawn.target.z) < 18) return false;
    const valley = Math.abs(x - terrain.riverX(z));
    const density = forest(x / 140, z / 140) + (valley < 110 ? -0.7 : 0) + (h > 150 ? -0.2 : 0);
    return density > 0.05 + r * 0.5;
  });
  const sizes = trees.map(() => 0.8 + rand() * 0.7);
  const crownGeo = new THREE.ConeGeometry(2.4, 7, 6).translate(0, 5.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5).translate(0, 1.1, 0);
  trees.forEach((p, i) => rests.push({ x: p.x, z: p.z, radius: 0.35 * sizes[i] }));
  group.add(instanced(crownGeo, swayMaterial(0x2f5a32, 0.012), trees, (i) => sizes[i]));
  group.add(instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a4030, flatShading: true }), trees, (i) => sizes[i]));

  // Rocks cluster on steep ground; they double as rifle rests later.
  const rocks = scatter(terrain, 500, terrain.seed + 11, (_x, _z, _h, slope, r) => slope > 0.45 && r < 0.6);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0).translate(0, 0.3, 0);
  const rockSizes = rocks.map(() => 0.7 + rand() * 1.6);
  rocks.forEach((p, i) => rests.push({ x: p.x, z: p.z, radius: rockSizes[i] }));
  group.add(instanced(rockGeo, new THREE.MeshLambertMaterial({ color: 0x86847a, flatShading: true }), rocks, (i) => rockSizes[i]));

  // Grass tufts: the main visual wind cue.
  const grass = scatter(terrain, 14000, terrain.seed + 12, (_x, _z, h, slope) => slope < 0.6 && h < 150);
  const tuftGeo = new THREE.ConeGeometry(0.18, 0.7, 3).translate(0, 0.35, 0);
  group.add(instanced(tuftGeo, swayMaterial(0x7fa043, 0.08), grass, () => 0.7 + rand() * 0.8));

  return { group, rests };
}
