import { mulberry32 } from '../world/random';
import { Terrain, WATER_LEVEL } from '../world/terrain';
import { Deer } from './deer';

/** Places a small grazing herd around a meadow point. */
export function createHerd(terrain: Terrain, center: { x: number; z: number }, count: number, seed: number): Deer[] {
  const rand = mulberry32(seed);
  const herd: Deer[] = [];
  for (let tries = 0; herd.length < count && tries < 200; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 22;
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    const y = terrain.height(x, z);
    if (y < WATER_LEVEL + 0.5 || terrain.slope(x, z) > 0.5) continue;
    if (herd.some((d) => Math.hypot(d.object.position.x - x, d.object.position.z - z) < 3)) continue;
    herd.push(new Deer(herd.length, x, y, z, rand() * Math.PI * 2, herd.length === 0, rand));
  }
  return herd;
}
