import * as THREE from 'three';
import { Deer } from './animals/deer';
import { Herd, createHerd } from './animals/herd';
import type { PlayerSignal } from './animals/perception';
import { mulberry32 } from './world/random';
import { STANDARD_ATMOSPHERE, FlightEnv } from './ballistics/ballistics';
import { angleInfo, boreDirection, muzzleOrigin } from './ballistics/shot';
import { vec3 } from './core/vec3';
import { categorize } from './animals/physiology';
import { BulletHandle, BulletSystem, Impact } from './game/bullets';
import { recordHarvest } from './game/records';
import { AnimalScore, scoreAnimal } from './game/scoring';
import { HarvestScreen } from './ui/harvest';
import { LOOK } from './game/config';
import { Player } from './game/player';
import { EYE_ZOOM, Rifle, SIGHT_HEIGHT } from './game/rifle';
import type { Target } from './game/targets';
import { STRINGS } from './i18n';
import { Actions, Input } from './input/input';
import { Hud, SCOPE_CENTER_Y } from './ui/hud';
import type { Sign } from './tracking/signs';
import { SignView } from './tracking/signView';
import { Terrain } from './world/terrain';
import { createTerrainObject } from './world/terrainMesh';
import { createVegetation, windUniforms } from './world/vegetation';
import { Wind } from './world/wind';

// P7: bullet cam, harvesting, X-ray and ethical scoring.

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
const signView = new SignView(scene, terrain, herdAI.signs);
let tracking = false;
let debugHits = false; // shows organ names on hit; for development only

function signHint(s: Sign): string {
  switch (s.kind) {
    case 'hitSite':
      return s.blood ? STRINGS.sign.hitSite : STRINGS.sign.hitSiteClean;
    case 'track':
      return STRINGS.sign.track(s.running);
    case 'bed':
      return STRINGS.sign.bed;
    case 'blood':
      return STRINGS.sign.blood[s.blood!];
  }
}

/** Explains newly noticed signs, without repeating the same kind of sign on a trail. */
const explained = new Set<string>();
function explainDiscoveries(found: Sign[]) {
  for (const s of found) {
    const key = `${s.deerId}:${s.kind}:${s.kind === 'track' ? s.running : s.blood}`;
    if (explained.has(key)) continue;
    explained.add(key);
    hud.showToast(signHint(s), 4);
    return; // one hint at a time
  }
}

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
    if (player.scoped) tracking = false;
    if (!player.scoped) player.stability.endHold();
  },
  toggleStance: () => player.toggleStance(),
  toggleTracking: () => {
    tracking = !tracking;
    if (tracking && player.scoped) player.scoped = false;
  },
  tap: (cx, cy) => {
    if (bulletCam) {
      endBulletCam();
      return;
    }
    if (!tracking || player.scoped) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const s = signView.pick(ray);
    if (s) {
      s.discovered = true;
      hud.showToast(signHint(s), 4);
    }
  },
  beginShot: () => {
    if (player.scoped) player.stability.startHold();
  },
  releaseShot: (fire) => {
    if (bulletCam) {
      endBulletCam();
      return;
    }
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
      deer.downAt = elapsed;
      deer.downPos = { x: deer.brain.x, z: deer.brain.z };
      hud.showToast(STRINGS.deerDown(elapsed - first.time), 4);
    }
  };
}

function onImpact(impact: Impact) {
  switch (impact.kind) {
    case 'animal': {
      const w = impact.hit.wound;
      const head = debugHits ? STRINGS.hitAnimal(w.organs.map((o) => o.organ.name), !!w.exit) : STRINGS.hitAnimalPlain;
      hud.showToast(`${head}\n${STRINGS.flight(impact.range, impact.time)}`, 4);
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
  const from = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
  const dir = new THREE.Vector3(bore.x, bore.y, bore.z);
  const forecast = bulletCamEnabled ? bullets.predictAnimalHit(rifle.ammo, from, dir, elapsed) : null;
  const handle = bullets.fire(rifle.ammo, from, dir);
  if (forecast && forecast.range > BULLET_CAM_MIN_RANGE) startBulletCam(handle);
  navigator.vibrate?.(30);
}

// ---- Bullet cam: slow-motion follow of long shots that will hit an animal ----

const BULLET_CAM_MIN_RANGE = 150; // m
const BULLET_CAM_SLOW = 0.06; // world time scale while the bullet flies
const BULLET_CAM_HOLD = 1.3; // s of real time to linger on the impact
let bulletCamEnabled = true;
let bulletCam: { bullet: BulletHandle; hold: number; wasScoped: boolean } | null = null;

function startBulletCam(bullet: BulletHandle) {
  bulletCam = { bullet, hold: BULLET_CAM_HOLD, wasScoped: player.scoped };
  bullet.mesh.scale.setScalar(3); // a real bullet is too small to read on a phone
  player.stability.endHold();
  document.body.classList.add('bulletcam');
  camera.clearViewOffset();
  camera.fov = 40;
  camera.updateProjectionMatrix();
}

function endBulletCam() {
  if (!bulletCam) return;
  player.scoped = bulletCam.wasScoped;
  bulletCam = null;
  document.body.classList.remove('bulletcam');
  camera.fov = 0; // forces the normal projection to be rebuilt next frame
}

/** World time scale for this frame of the bullet cam; ends the cam after lingering on the impact. */
function bulletCamTimeScale(dt: number): number {
  const cam = bulletCam!;
  if (!cam.bullet.done) return BULLET_CAM_SLOW;
  cam.hold -= dt;
  if (cam.hold <= 0) {
    endBulletCam();
    return 1;
  }
  return 0.3;
}

/** Chases the bullet from just behind and beside it. Call after bullets have moved this frame. */
function placeBulletCam() {
  const cam = bulletCam!;
  if (cam.bullet.done) {
    camera.lookAt(cam.bullet.position);
    return;
  }
  const up = new THREE.Vector3(0, 1, 0);
  const v = cam.bullet.velocity.clone().normalize();
  const side = new THREE.Vector3().crossVectors(v, up).normalize();
  // Portrait view is only ~±9° wide, so stay nearly in line with the bullet to keep it in frame.
  camera.position.copy(cam.bullet.position).addScaledVector(v, -0.6).addScaledVector(side, 0.03).addScaledVector(up, 0.08);
  camera.lookAt(cam.bullet.position.clone().addScaledVector(v, 1.5));
}

// ---- Harvest ----

const HARVEST_REACH = 4; // m
const harvestScreen = new HarvestScreen();
const harvestBtn = document.getElementById('btn-harvest')!;
harvestBtn.textContent = STRINGS.harvest;
const harvestedScores: AnimalScore[] = [];
let sessionScore = 0;

function nearestHarvestable(): Deer | null {
  let best: Deer | null = null;
  let bestD = HARVEST_REACH;
  for (const d of herd) {
    if (!d.harvestable) continue;
    const dist = Math.hypot(d.brain.x - player.pos.x, d.brain.z - player.pos.z);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

function harvest(deer: Deer) {
  const first = deer.hits[0];
  const shots = deer.hits.map((h) => ({ category: categorize(h.wound), range: h.range, time: h.time }));
  const down = deer.downPos ?? { x: deer.brain.x, z: deer.brain.z };
  const runDistance = Math.hypot(down.x - first.entryWorld.x, down.z - first.entryWorld.z);
  const score = scoreAnimal({ shots, downAt: deer.downAt, runDistance });
  harvestedScores.push(score);
  sessionScore += score.total;
  const organs = [...new Set(deer.hits.flatMap((h) => h.wound.organs.map((o) => o.organ.name)))];
  deer.harvested = true;
  scene.remove(deer.object);
  harvestScreen.show({
    deer,
    buck: deer.buck,
    score,
    firstCategory: shots[0].category,
    firstRange: first.range,
    extraShots: shots.length - 1,
    runDistance,
    organs: organs.length ? organs : [STRINGS.category.muscle],
    newBest: recordHarvest(score.total),
  });
}
harvestBtn.addEventListener('click', () => {
  const d = nearestHarvestable();
  if (d) harvest(d);
});

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
  setDebugHits: (on: boolean) => (debugHits = on),
  setBulletCam: (on: boolean) => (bulletCamEnabled = on),
  harvestNearest: () => {
    const d = nearestHarvestable();
    if (d) harvest(d);
    return !!d;
  },
  signs: herdAI.signs,
};

/** Debug/test hook to fast-forward animal physiology and bullets. */
let timeScale = 1;
const clock = new THREE.Clock();
let rangeTimer = 0;
let rangeText: string = STRINGS.noRange;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const f = input.sample();
  // World time runs slow during the bullet cam; the player is frozen while it plays.
  const camScale = bulletCam ? bulletCamTimeScale(dt) : 1;
  const worldDt = dt * timeScale * camScale;
  elapsed += worldDt;

  if (!bulletCam && !harvestScreen.open) player.update(dt, f, rifle.magnification * EYE_ZOOM);
  rifle.update(dt);
  const view = player.viewAngles();
  if (!bulletCam) {
    camera.position.copy(player.eye);
    camera.rotation.set(view.pitch, view.yaw, 0);
  }
  const fov = player.scoped
    ? (2 * Math.atan(Math.tan(((LOOK.verticalFov / 2) * Math.PI) / 180) / (rifle.magnification * EYE_ZOOM)) * 180) / Math.PI
    : LOOK.verticalFov;
  if (!bulletCam && camera.fov !== fov) {
    camera.fov = fov;
    // Shift the projection centre up to the lens centre so the reticle marks the true aim point.
    const { clientWidth: w, clientHeight: h } = canvas;
    if (player.scoped) camera.setViewOffset(w, h, 0, (0.5 - SCOPE_CENTER_Y) * h, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();

  bullets.update(worldDt, elapsed);
  if (bulletCam) placeBulletCam();
  const signal: PlayerSignal = {
    x: player.eye.x,
    y: player.eye.y,
    z: player.eye.z,
    prone: player.stance === 'prone',
    speed: player.speed,
    running: player.running,
  };
  herdAI.update(worldDt, signal);
  document.body.classList.toggle('can-harvest', !!nearestHarvestable());
  if (tracking) explainDiscoveries(herdAI.signs.discover(player.pos.x, player.pos.z));
  signView.update(dt, tracking, player.pos.x, player.pos.z);

  const w = windAt(elapsed, player.eye);
  windUniforms.uTime.value = elapsed;
  windUniforms.uWind.value.set(w.x, w.z);
  const windHeading = Math.atan2(-w.x, -w.z);
  windArrow.style.transform = `rotate(${player.yaw - windHeading}rad)`;
  windText.textContent = STRINGS.wind(Math.hypot(w.x, w.z));
  info.textContent = `${STRINGS.altitude(player.pos.y)} · ${STRINGS.speed(player.speed)}${sessionScore ? ` · ${STRINGS.score(sessionScore)}` : ''}`;

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
      tracking,
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
