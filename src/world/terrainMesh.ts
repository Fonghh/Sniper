import * as THREE from 'three';
import { HALF_MAP, MAP_SIZE, Terrain, WATER_LEVEL } from './terrain';

const CHUNKS = 8; // per side → 125 m chunks
const CHUNK_SIZE = MAP_SIZE / CHUNKS;
const LODS: ReadonlyArray<{ segments: number; distance: number }> = [
  { segments: 48, distance: 0 },
  { segments: 24, distance: 200 },
  { segments: 12, distance: 420 },
];
const SKIRT_DEPTH = 4; // hides cracks between neighbouring chunks at different LODs

const SAND = new THREE.Color(0xc8b98a);
const GRASS = new THREE.Color(0x6b8f3a);
const GRASS_DARK = new THREE.Color(0x4f7330);
const DRY = new THREE.Color(0xa59a52);
const ROCK = new THREE.Color(0x7d7b72);

function surfaceColor(terrain: Terrain, x: number, z: number, h: number, out: THREE.Color) {
  const slope = terrain.slope(x, z, 2);
  if (h < WATER_LEVEL + 1.2) return out.copy(SAND);
  out.copy(GRASS).lerp(GRASS_DARK, 0.5 + 0.5 * Math.sin(x * 0.05) * Math.cos(z * 0.043));
  out.lerp(DRY, THREE.MathUtils.smoothstep(h, 90, 160) * 0.8);
  return out.lerp(ROCK, THREE.MathUtils.smoothstep(slope, 0.95, 1.4));
}

function buildChunkGeometry(terrain: Terrain, x0: number, z0: number, n: number) {
  const step = CHUNK_SIZE / n;
  const side = n + 3; // one extra skirt ring on each side
  const positions = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  const color = new THREE.Color();
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const gi = Math.min(Math.max(i - 1, 0), n);
      const gj = Math.min(Math.max(j - 1, 0), n);
      const x = x0 + gi * step;
      const z = z0 + gj * step;
      const h = terrain.height(x, z);
      const skirt = i === 0 || j === 0 || i === side - 1 || j === side - 1;
      const k = (j * side + i) * 3;
      positions[k] = x;
      positions[k + 1] = skirt ? h - SKIRT_DEPTH : h;
      positions[k + 2] = z;
      surfaceColor(terrain, x, z, h, color);
      colors[k] = color.r;
      colors[k + 1] = color.g;
      colors[k + 2] = color.b;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Builds the chunked, LOD'd terrain plus the water surface. */
export function createTerrainObject(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  for (let cz = 0; cz < CHUNKS; cz++) {
    for (let cx = 0; cx < CHUNKS; cx++) {
      const x0 = -HALF_MAP + cx * CHUNK_SIZE;
      const z0 = -HALF_MAP + cz * CHUNK_SIZE;
      const lod = new THREE.LOD();
      for (const level of LODS) {
        lod.addLevel(new THREE.Mesh(buildChunkGeometry(terrain, x0, z0, level.segments), material), level.distance);
      }
      // LOD distances are measured from the object origin, so centre it on the chunk.
      lod.position.set(x0 + CHUNK_SIZE / 2, 0, z0 + CHUNK_SIZE / 2);
      for (const level of lod.levels) level.object.position.set(-lod.position.x, 0, -lod.position.z);
      group.add(lod);
    }
  }
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x4f86a8, transparent: true, opacity: 0.8 }),
  );
  water.position.y = WATER_LEVEL;
  group.add(water);
  return group;
}
