import * as THREE from 'three';

const DAY_SKY = new THREE.Color(0xa9cbe0);
const DUSK_SKY = new THREE.Color(0x3b4562);
const DAY_SUN = new THREE.Color(0xfff2d6);
const DUSK_SUN = new THREE.Color(0xff9a5a);

/** Blends the scene from day to dusk. `t` is 0 (day) .. 1 (dusk). */
export function applyDaylight(
  t: number,
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  hemi: THREE.HemisphereLight,
) {
  const k = Math.max(0, Math.min(1, t));
  const sky = DAY_SKY.clone().lerp(DUSK_SKY, k);
  (scene.background as THREE.Color).copy(sky);
  (scene.fog as THREE.Fog).color.copy(sky);
  sun.color.copy(DAY_SUN).lerp(DUSK_SUN, k);
  sun.intensity = 1.7 * (1 - 0.6 * k);
  hemi.intensity = 1.1 * (1 - 0.55 * k);
}
