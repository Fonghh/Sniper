import * as THREE from 'three';
import { Deer } from './animals/deer';
import { Herd, createHerd } from './animals/herd';
import type { PlayerSignal } from './animals/perception';
import { categorize } from './animals/physiology';
import { STANDARD_ATMOSPHERE, FlightEnv } from './ballistics/ballistics';
import { angleInfo, boreDirection, muzzleOrigin } from './ballistics/shot';
import { vec3 } from './core/vec3';
import { BulletHandle, BulletSystem, Impact } from './game/bullets';
import { LOOK } from './game/config';
import { Player } from './game/player';
import { loadRecords, recordHarvest, recordSession } from './game/records';
import { EYE_ZOOM, Rifle, SIGHT_HEIGHT } from './game/rifle';
import { AnimalScore, UNRECOVERED_PENALTY, scoreAnimal, sessionTotal } from './game/scoring';
import { Settings, loadSettings, saveSettings } from './game/settings';
import type { Target } from './game/targets';
import { STRINGS } from './i18n';
import { Actions, Input } from './input/input';
import type { Sign } from './tracking/signs';
import { SignView } from './tracking/signView';
import { HarvestScreen } from './ui/harvest';
import { Hud, SCOPE_CENTER_Y } from './ui/hud';
import { MapView } from './ui/mapView';
import { Screens } from './ui/screens';
import { applyDaylight } from './world/daylight';
import { Lookouts } from './world/lookouts';
import { mulberry32 } from './world/random';
import { SpawnPoint, Terrain } from './world/terrain';
import { createTerrainObject } from './world/terrainMesh';
import { createVegetation, windUniforms } from './world/vegetation';
import { Wind } from './world/wind';

// Game flow: cabin → hunt (pause menu, map, harvests) → end-of-hunt summary → cabin.

const SEED = 1234;
const RANGE_MAX = 1200;
const HERD_SIZE = 5;
/** Hunt clock (seconds): light fades from DUSK_START, a warning at DUSK_WARN, the hunt ends at HUNT_END. */
const DUSK_START = 510;
const DUSK_WARN = 600;
const HUNT_END = 660;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const hint = document.getElementById('hint')!;
const windArrow = document.getElementById('wind-arrow')!;
const windText = document.getElementById('wind-text')!;

const settings: Settings = loadSettings();
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---- Renderer and static world ----

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch });
const MAX_PIXEL_RATIO = Math.min(devicePixelRatio, isTouch ? 1.75 : 2);
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9cbe0);
scene.fog = new THREE.Fog(0xa9cbe0, 350, 1300);
const camera = new THREE.PerspectiveCamera(LOOK.verticalFov, 9 / 16, 0.1, 2500);
camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a2a, 1.1);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
sun.position.set(300, 400, 150);
scene.add(hemi, sun);

const terrain = new Terrain(SEED);
const wind = new Wind(SEED);
scene.add(createTerrainObject(terrain));
// Phones get fewer grass tufts; they are the main fill-rate cost.
const vegetation = createVegetation(terrain, isTouch ? 0.55 : 1);
scene.add(vegetation.group);
const lookouts = new Lookouts(terrain, 5);
scene.add(lookouts.group);
const spawns: SpawnPoint[] = terrain.spawnPoints(4);

// Practice boards (createRange) are kept in code for a future practice range in the cabin.
const targets: Target[] = [];

const player = new Player(terrain, vegetation.rests);
const rifle = new Rifle();

let windScale = 1; // test hook: 0 disables wind to isolate other effects
/** Wind at a point, using height above the local valley floor for exposure. */
function windAt(t: number, p: { x: number; y: number; z: number }) {
  const floor = terrain.height(terrain.riverX(p.z), p.z);
  const w = wind.at(t, p.y - floor);
  return { x: w.x * windScale, y: w.y * windScale, z: w.z * windScale };
}
const flightEnv = (t: number): FlightEnv => ({ atmosphere: STANDARD_ATMOSPHERE, wind: (p) => windAt(t, p) });

const vibrate = (ms: number) => {
  if (settings.haptics) navigator.vibrate?.(ms);
};

// ---- Per-hunt state (rebuilt by startHunt) ----

type Phase = 'cabin' | 'hunt' | 'paused' | 'summary';
let phase: Phase = 'cabin';
let herd: Deer[] = [];
let herdAI: Herd;
let signView: SignView;
let bullets: BulletSystem;
let elapsed = 0;
let tracking = false;
let debugHits = false; // shows organ names on hit; for development only
let duskWarned = false;
const explained = new Set<string>();
const fallen = new Set<Deer>();
let harvested: Array<{ buck: boolean; score: AnimalScore }> = [];
let sessionScore = 0;

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
function explainDiscoveries(found: Sign[]) {
  for (const s of found) {
    const key = `${s.deerId}:${s.kind}:${s.kind === 'track' ? s.running : s.blood}`;
    if (explained.has(key)) continue;
    explained.add(key);
    hud.showToast(signHint(s), 4);
    return; // one hint at a time
  }
}

function startHunt() {
  // Tear down the previous hunt.
  for (const d of herd) scene.remove(d.object);
  signView?.dispose();
  bullets?.clear();
  endBulletCam();
  if (harvestScreen.open) harvestScreen.close();

  const huntSeed = Math.floor(Math.random() * 1e9);
  const spawn = spawns[huntSeed % spawns.length];
  player.reset();
  player.spawn(spawn.x, spawn.z, spawn.yaw, spawn.pitch);
  rifle.setZeroIndex(0);

  herd = createHerd(terrain, spawn.target, HERD_SIZE, huntSeed);
  for (const d of herd) {
    scene.add(d.object);
    d.onConditionChange = onDeerCondition;
  }
  herdAI = new Herd(herd, terrain, mulberry32(huntSeed + 1));
  signView = new SignView(scene, terrain, herdAI.signs);
  bullets = new BulletSystem(scene, terrain, targets, herd, flightEnv, onImpact);

  elapsed = 0;
  tracking = false;
  duskWarned = false;
  explained.clear();
  fallen.clear();
  harvested = [];
  sessionScore = 0;
  applyDaylight(0, scene, sun, hemi);
  phase = 'hunt';
  screens.show(null);
  hint.textContent = input.isTouch ? STRINGS.hintTouch : STRINGS.hintDesktop;
}

/** Ends the hunt: penalties for wounded deer left behind, records, then the summary screen. */
function endHunt() {
  endBulletCam();
  if (harvestScreen.open) harvestScreen.close();
  player.scoped = false;
  tracking = false;
  // The HUD is not updated outside a hunt, so clear its mode classes now.
  document.body.classList.remove('scoped', 'tracking', 'can-harvest');
  const unrecovered = herd.filter((d) => d.hits.length > 0 && !d.harvested).length;
  const total = sessionTotal(
    harvested.map((h) => h.score),
    unrecovered,
  );
  const best = harvested.length > 0 && recordSession(total);
  phase = 'summary';
  screens.showSummary(harvested, unrecovered, unrecovered * UNRECOVERED_PENALTY, total, best);
  screens.setCabinBest(loadRecords());
}

function pause() {
  if (phase !== 'hunt') return;
  phase = 'paused';
  player.stability.endHold();
  screens.setClock(elapsed);
  screens.show('menu');
}

function resume() {
  if (phase !== 'paused') return;
  phase = 'hunt';
  screens.show(null);
}

// ---- Input actions ----

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
    if (player.scoped && phase === 'hunt') player.stability.startHold();
  },
  releaseShot: (fire) => {
    if (bulletCam) {
      endBulletCam();
      return;
    }
    if (fire && player.scoped && phase === 'hunt' && rifle.tryFire()) shoot();
    player.stability.endHold();
  },
  stepZero: (d) => {
    if (rifle.setZeroIndex(rifle.zeroIndex + d)) vibrate(8);
  },
  cycleMagnification: () => rifle.cycleMagnification(),
  isScoped: () => player.scoped,
};

const input = new Input(canvas, document.getElementById('joystick-knob')!, actions);
const hud = new Hud(actions);
const harvestScreen = new HarvestScreen();
const mapView = new MapView(document.getElementById('map-canvas') as HTMLCanvasElement, terrain);
const screens = new Screens(
  {
    startHunt,
    resume,
    quit: endHunt,
    openMap: () => {
      screens.push('map');
      mapView.draw(lookouts.points, { x: player.pos.x, z: player.pos.z, yaw: player.yaw });
    },
    settingsChanged: (s) => {
      saveSettings(s);
      applySettings();
    },
  },
  settings,
);
screens.recordsSource = loadRecords;
screens.setCabinBest(loadRecords());
screens.show('cabin');
document.getElementById('btn-menu')!.addEventListener('click', pause);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') phase === 'hunt' ? pause() : resume();
});
// Leaving the app mid-hunt pauses it.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

mapView.onTravel = (l) => {
  player.spawn(l.x, l.z, player.yaw, -0.25);
  player.scoped = false;
  screens.pop();
  resume();
};

function applySettings() {
  windArrow.style.visibility = settings.windArrow ? 'visible' : 'hidden';
  input.setGyro(settings.gyroAim);
}
applySettings();

// ---- Shots and impacts ----

function onDeerCondition(deer: Deer, condition: string) {
  // Report the moment each deer first falls (CNS hits go straight from wounded to dead).
  const first = deer.hits[0];
  if ((condition === 'down' || condition === 'dead') && first && !fallen.has(deer)) {
    fallen.add(deer);
    deer.downAt = elapsed;
    deer.downPos = { x: deer.brain.x, z: deer.brain.z };
    hud.showToast(STRINGS.deerDown(elapsed - first.time), 4);
  }
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
  const forecast = settings.bulletCam ? bullets.predictAnimalHit(rifle.ammo, from, dir, elapsed) : null;
  const handle = bullets.fire(rifle.ammo, from, dir);
  if (forecast && forecast.range > BULLET_CAM_MIN_RANGE) startBulletCam(handle);
  vibrate(30);
}

// ---- Bullet cam: slow-motion follow of long shots that will hit an animal ----

const BULLET_CAM_MIN_RANGE = 150; // m
const BULLET_CAM_SLOW = 0.06; // world time scale while the bullet flies
const BULLET_CAM_HOLD = 1.3; // s of real time to linger on the impact
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
const harvestBtn = document.getElementById('btn-harvest')!;
harvestBtn.textContent = STRINGS.harvest;

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
  harvested.push({ buck: deer.buck, score });
  sessionScore += score.total;
  const organs = [...new Set(deer.hits.flatMap((h) => h.wound.organs.map((o) => o.organ.name)))];
  deer.harvested = true;
  scene.remove(deer.object);
  const newBest = recordHarvest({
    at: new Date().toISOString(),
    buck: deer.buck,
    grade: score.grade,
    score: score.total,
    range: first.range,
    category: shots[0].category,
  });
  harvestScreen.show({
    deer,
    buck: deer.buck,
    score,
    firstCategory: shots[0].category,
    firstRange: first.range,
    extraShots: shots.length - 1,
    runDistance,
    organs: organs.length ? organs : [STRINGS.category.muscle],
    newBest,
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

// ---- Adaptive resolution: trade sharpness for a steady frame rate on slower phones ----

let perfTime = 0;
let perfFrames = 0;
function adaptResolution(dt: number) {
  perfTime += dt;
  perfFrames++;
  if (perfTime < 2) return;
  const avg = perfTime / perfFrames;
  perfTime = 0;
  perfFrames = 0;
  const next = avg > 1 / 40 ? pixelRatio - 0.25 : avg < 1 / 58 ? pixelRatio + 0.25 : pixelRatio;
  const clamped = Math.max(1, Math.min(MAX_PIXEL_RATIO, next));
  if (clamped !== pixelRatio) {
    pixelRatio = clamped;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

// Exposed for automated checks and debugging in the browser console.
let timeScale = 1;
(window as unknown as { __sniper: object }).__sniper = {
  player,
  rifle,
  actions,
  targets,
  get herd() {
    return herd;
  },
  get signs() {
    return herdAI.signs;
  },
  get phase() {
    return phase;
  },
  lookouts,
  startHunt,
  endHunt,
  setElapsed: (t: number) => (elapsed = t),
  setTimeScale: (s: number) => (timeScale = s),
  setWindScale: (s: number) => (windScale = s),
  setDebugHits: (on: boolean) => (debugHits = on),
  harvestNearest: () => {
    const d = nearestHarvestable();
    if (d) harvest(d);
    return !!d;
  },
};

// ---- Frame loop ----

const clock = new THREE.Clock();
let rangeTimer = 0;
let rangeText: string = STRINGS.noRange;
let cabinTime = 0;

/** The cabin backdrop: a slow pan across the valley from the best overlook. */
function cabinCamera(dt: number) {
  cabinTime += dt;
  const s = spawns[0];
  camera.position.set(s.x, terrain.height(s.x, s.z) + 3, s.z);
  camera.rotation.set(s.pitch + 0.05, s.yaw + Math.sin(cabinTime * 0.08) * 0.5, 0);
  if (camera.fov !== LOOK.verticalFov) {
    camera.fov = LOOK.verticalFov;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  adaptResolution(dt);
  const f = input.sample();
  windUniforms.uTime.value += dt;

  if (phase !== 'hunt') {
    if (phase === 'cabin' || phase === 'summary') cabinCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
    return;
  }

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
  if (lookouts.visit(player.pos.x, player.pos.z).length) hud.showToast(STRINGS.map.discovered, 4);

  // Dusk: light fades, then a warning, then the hunt ends.
  applyDaylight((elapsed - DUSK_START) / (HUNT_END - DUSK_START), scene, sun, hemi);
  if (elapsed >= DUSK_WARN && !duskWarned) {
    duskWarned = true;
    hud.showToast(STRINGS.dusk, 5);
  }
  if (elapsed >= HUNT_END && !bulletCam && !harvestScreen.open) {
    hud.showToast(STRINGS.duskEnd, 3);
    endHunt();
  }

  const w = windAt(elapsed, player.eye);
  windUniforms.uWind.value.set(w.x, w.z);
  const windHeading = Math.atan2(-w.x, -w.z);
  windArrow.style.transform = `rotate(${player.yaw - windHeading}rad)`;
  windText.textContent = settings.windArrow ? STRINGS.wind(Math.hypot(w.x, w.z)) : '';
  info.textContent = `${STRINGS.altitude(player.pos.y)}${sessionScore ? ` · ${STRINGS.score(sessionScore)}` : ''}`;

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
