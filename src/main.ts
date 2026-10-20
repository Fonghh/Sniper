import * as THREE from 'three';
import { Deer } from './animals/deer';
import { Herd, createHerd } from './animals/herd';
import type { PlayerSignal } from './animals/perception';
import { mulberry32 } from './world/random';
import { STANDARD_ATMOSPHERE, FlightEnv } from './ballistics/ballistics';
import { angleInfo, boreDirection, muzzleOrigin } from './ballistics/shot';
import { vec3 } from './core/vec3';
import { BulletSystem, Impact } from './game/bullets';
import { LOOK } from './game/config';
import { Player } from './game/player';
import { EYE_ZOOM, Rifle, SIGHT_HEIGHT } from './game/rifle';
import type { Target } from './game/targets';
import { STRINGS } from './i18n';
import { Actions, Input } from './input/input';
import { Hud, SCOPE_CENTER_Y } from './ui/hud';
import { Terrain } from './world/terrain';
import { createTerrainObject } from './world/terrainMesh';
import { createVegetation, windUniforms } from './world/vegetation';
import { Wind } from './world/wind';

// P5: the herd sees, hears and flees; wounded deer bed down. Tracking arrives in P6.

const SEED = 1234;
const RANGE_MAX = 1200;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const hint = document.getElementById('hint')!;
const windArrow = document.getElementById('wind-arrow')!;
const windText = document.getElementById('wind-text')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const SKY = 0xa9cbe0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 350, 1300);

const camera = new THREE.PerspectiveCamera(LOOK.verticalFov, 9 / 16, 0.1, 2500);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a2a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
sun.position.set(300, 400, 150);
scene.add(sun);

const terrain = new Terrain(SEED);
const wind = new Wind(SEED);
scene.add(createTerrainObject(terrain));
const vegetation = createVegetation(terrain);
scene.add(vegetation.group);

const player = new Player(terrain, vegetation.rests);
const spawn = terrain.spawnPoint();
player.spawn(spawn.x, spawn.z, spawn.yaw, spawn.pitch);

// Practice boards (createRange) are kept in code for a future practice range in the cabin.
const targets: Target[] = [];

const herd: Deer[] = createHerd(terrain, spawn.target, 5, SEED + 7);
for (const d of herd) scene.add(d.object);
const herdAI = new Herd(herd, terrain, mulberry32(SEED + 8));

const rifle = new Rifle();
let elapsed = 0;

/** Wind at a point, using height above the local valley floor for exposure. */
let windScale = 1; // test hook: 0 disables wind to isolate other effects
function windAt(t: number, p: { x: number; y: number; z: number }) {
  const floor = terrain.height(terrain.riverX(p.z), p.z);
  const w = wind.at(t, p.y - floor);
  return { x: w.x * windScale, y: w.y * windScale, z: w.z * windScale };
}
const flightEnv = (t: number): FlightEnv => ({ atmosphere: STANDARD_ATMOSPHERE, wind: (p) => windAt(t, p) });

const actions: Actions = {
  toggleScope: () => {
    player.scoped = !player.scoped;
    if (!player.scoped) player.stability.endHold();
  },
  toggleStance: () => player.toggleStance(),
  beginShot: () => {
    if (player.scoped) player.stability.startHold();
  },
  releaseShot: (fire) => {
    if (fire && player.scoped && rifle.tryFire()) shoot();
    player.stability.endHold();
  },
  stepZero: (d) => {
    if (rifle.setZeroIndex(rifle.zeroIndex + d)) navigator.vibrate?.(8);
  },
  cycleMagnification: () => rifle.cycleMagnification(),
  isScoped: () => player.scoped,
};

const input = new Input(canvas, document.getElementById('joystick-knob')!, actions);
const hud = new Hud(actions);
hint.textContent = input.isTouch ? STRINGS.hintTouch : STRINGS.hintDesktop;

// Report the moment each deer first falls (CNS hits go straight from wounded to dead).
const fallen = new Set<Deer>();
for (const d of herd) {
  d.onConditionChange = (deer, condition) => {
    const first = deer.hits[0];
    if ((condition === 'down' || condition === 'dead') && first && !fallen.has(deer)) {
      fallen.add(deer);
      hud.showToast(STRINGS.deerDown(elapsed - first.time), 4);
    }
  };
}

function onImpact(impact: Impact) {
  switch (impact.kind) {
    case 'animal': {
      const w = impact.hit.wound;
      hud.showToast(`${STRINGS.hitAnimal(w.organs.map((o) => o.organ.name), !!w.exit)}\n${STRINGS.flight(impact.range, impact.time)}`, 4);
      break;
    }
    case 'target': {
      const { hit } = impact;
      const head = hit.inBull ? STRINGS.hitBull : STRINGS.hitBoard;
      hud.showToast(`${head} ${STRINGS.offset(hit.offsetRight, hit.offsetUp)}\n${STRINGS.flight(impact.range, impact.time)}`);
      break;
    }
    case 'ground':
      herdAI.impact(impact.point);
      hud.showToast(`${STRINGS.hitGround} · ${STRINGS.flight(impact.range, impact.time)}`);
      break;
    case 'lost':
      hud.showToast(STRINGS.miss);
      break;
  }
}
const bullets = new BulletSystem(scene, terrain, targets, herd, flightEnv, onImpact);

function aimDirection(): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
}

function shoot() {
  const eye = player.eye;
  const d = aimDirection();
  const sight = vec3(d.x, d.y, d.z);
  const bore = boreDirection(sight, rifle.elevation);
  const muzzle = muzzleOrigin(vec3(eye.x, eye.y, eye.z), sight, SIGHT_HEIGHT);
  herdAI.gunshot({ x: eye.x, z: eye.z });
  bullets.fire(rifle.ammo, new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z), new THREE.Vector3(bore.x, bore.y, bore.z));
  navigator.vibrate?.(30);
}

/** Auto rangefinder: first thing the sight line meets (targets or terrain). */
function rangeReading(): string {
  const eye = player.eye;
  const dir = aimDirection();
  const far = eye.clone().addScaledVector(dir, RANGE_MAX);
  let best: THREE.Vector3 | null = null;
  for (const t of targets) {
    const hit = t.intersect(eye, far, false);
    if (hit && (!best || hit.point.distanceTo(eye) < best.distanceTo(eye))) best = hit.point;
  }
  const limit = best ? best.distanceTo(eye) : RANGE_MAX;
  let prev = 0;
  for (let d = 2; d < limit; d += 3) {
    const p = eye.clone().addScaledVector(dir, d);
    if (p.y < terrain.height(p.x, p.z)) {
      let lo = prev;
      let hi = d;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const q = eye.clone().addScaledVector(dir, mid);
        if (q.y < terrain.height(q.x, q.z)) hi = mid;
        else lo = mid;
      }
      best = eye.clone().addScaledVector(dir, hi);
      break;
    }
    prev = d;
  }
  if (!best) return STRINGS.noRange;
  const a = angleInfo(vec3(eye.x, eye.y, eye.z), vec3(best.x, best.y, best.z));
  return STRINGS.range(a.compensated, (a.angle * 180) / Math.PI);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = 0; // forces the view offset and projection to be rebuilt next frame
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Exposed for automated checks and debugging in the browser console.
(window as unknown as { __sniper: object }).__sniper = {
  player,
  rifle,
  actions,
  targets,
  herd,
  setTimeScale: (s: number) => (timeScale = s),
  setWindScale: (s: number) => (windScale = s),
};

/** Debug/test hook to fast-forward animal physiology and bullets. */
let timeScale = 1;
const clock = new THREE.Clock();
let rangeTimer = 0;
let rangeText: string = STRINGS.noRange;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt * timeScale;
  const f = input.sample();

  player.update(dt, f, rifle.magnification * EYE_ZOOM);
  rifle.update(dt);
  const view = player.viewAngles();
  camera.position.copy(player.eye);
  camera.rotation.set(view.pitch, view.yaw, 0);
  const fov = player.scoped
    ? (2 * Math.atan(Math.tan(((LOOK.verticalFov / 2) * Math.PI) / 180) / (rifle.magnification * EYE_ZOOM)) * 180) / Math.PI
    : LOOK.verticalFov;
  if (camera.fov !== fov) {
    camera.fov = fov;
    // Shift the projection centre up to the lens centre so the reticle marks the true aim point.
    const { clientWidth: w, clientHeight: h } = canvas;
    if (player.scoped) camera.setViewOffset(w, h, 0, (0.5 - SCOPE_CENTER_Y) * h, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  bullets.update(dt * timeScale, elapsed);
  const signal: PlayerSignal = {
    x: player.eye.x,
    y: player.eye.y,
    z: player.eye.z,
    prone: player.stance === 'prone',
    speed: player.speed,
    running: player.running,
  };
  herdAI.update(dt * timeScale, signal);

  const w = windAt(elapsed, player.eye);
  windUniforms.uTime.value = elapsed;
  windUniforms.uWind.value.set(w.x, w.z);
  const windHeading = Math.atan2(-w.x, -w.z);
  windArrow.style.transform = `rotate(${player.yaw - windHeading}rad)`;
  windText.textContent = STRINGS.wind(Math.hypot(w.x, w.z));
  info.textContent = `${STRINGS.altitude(player.pos.y)} · ${STRINGS.speed(player.speed)}`;

  rangeTimer -= dt;
  if (player.scoped && rangeTimer <= 0) {
    rangeTimer = 0.15;
    rangeText = rangeReading();
  }
  const st = player.stability;
  hud.update(
    dt,
    {
      scoped: player.scoped,
      prone: player.stance === 'prone',
      rested: player.rested,
      cycling: rifle.cycling,
      zeroIndex: rifle.zeroIndex,
      magnification: rifle.magnification,
      stamina: st.stamina,
      exhausted: st.exhausted > 0,
      heartRate: st.heartRate,
      rangeText,
    },
    camera.fov,
    canvas.clientHeight,
  );

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
