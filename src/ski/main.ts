import * as THREE from 'three';
import { SkiAudio } from './audio';
import { Board, BoardEvent, wrap } from './board';
import { SkiControls } from './controls';
import { Course, FINISH_Z, START_Z } from './course';
import { Spray, Track } from './fx';
import { Rider } from './rider';
import { buildSkiScene, followSun } from './scene';

// Mountain-top snowboarding prototype: one run from the summit to the valley, first person.

const STEP = 1 / 120;
const BASE_FOV = 70;
// Chase camera behind and above the rider, so the board's direction is always visible.
const CAM_BACK = 4.2; // m
const CAM_UP = 2.2; // m above the board
const CAM_AHEAD = 7; // m ahead of the rider it looks at
const CRASH_TIME = 1.8; // s on the ground before getting back up
const BEST_KEY = 'ski.best';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const app = $('app');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV, 9 / 16, 0.05, 7000);
camera.rotation.order = 'YXZ';

const course = new Course();
const world = buildSkiScene(scene, course);
const board = new Board();
const rider = new Rider(scene);
const spray = new Spray(scene);
const track = new Track(scene, course);
const audio = new SkiAudio();
const controls = new SkiControls($('touch-area'), $('stick'), $('stick-knob'), $('btn-turn'), $('btn-jump'));
controls.onAny = () => audio.unlock();

type State = 'menu' | 'countdown' | 'run' | 'crash' | 'finish';
let state: State = 'menu';
let clock = 0; // run time
let countdown = 0;
let crashFor = 0;
let finishFor = 0;
let acc = 0;
const safe = { pos: new THREE.Vector3(), heading: 0, timer: 0 };
const cam = { yaw: 0, roll: 0, dip: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), snap: true, lookInit: true };
let trickLeft = 0;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function showTrick(text: string) {
  const el = $('trick');
  el.textContent = text;
  el.classList.add('show');
  trickLeft = 1.4;
}

function start() {
  audio.unlock();
  const x = course.centerX(START_Z);
  board.place(x, START_Z, 0, course);
  safe.pos.copy(board.pos);
  safe.heading = 0;
  cam.yaw = 0;
  cam.snap = cam.lookInit = true;
  clock = 0;
  countdown = 3;
  state = 'countdown';
  spray.clear();
  track.clear();
  controls.reset();
  document.body.classList.remove('in-menu');
  $('menu').classList.remove('show');
  $('result').classList.remove('show');
  const best = readBest();
  $('best').textContent = best ? `最佳 ${fmt(best)}` : '';
}

function showMenu() {
  state = 'menu';
  audio.silence();
  document.body.classList.add('in-menu');
  $('result').classList.remove('show');
  $('menu').classList.add('show');
}

function crash() {
  if (state !== 'run') return;
  state = 'crash';
  crashFor = 0;
  audio.thump(12);
  $('hint').textContent = '摔倒了！';
}

function respawn() {
  board.place(safe.pos.x, safe.pos.z, safe.heading, course);
  cam.yaw = safe.heading;
  cam.snap = cam.lookInit = true;
  state = 'run';
  $('hint').textContent = '';
  track.add(board.pos, board.forward(), 0, true);
}

function finish() {
  state = 'finish';
  finishFor = 0;
  const best = readBest();
  const record = !best || clock < best;
  if (record) {
    try {
      localStorage.setItem(BEST_KEY, String(clock));
    } catch {
      // storage unavailable: the record just isn't kept
    }
  }
  $('result-title').textContent = record ? '新紀錄！' : '完成！';
  $('result-time').textContent = fmt(clock);
  $('result-best').textContent = record ? (best ? `之前最佳 ${fmt(best)}` : '') : `最佳 ${fmt(best)}`;
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', start);
$('btn-back').addEventListener('click', showMenu);
$('btn-menu').addEventListener('click', showMenu);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') showMenu();
  if (e.code === 'Enter' && (state === 'menu' || state === 'finish')) start();
});

function handle(e: BoardEvent) {
  if (e.type === 'takeoff') track.add(board.pos, board.forward(), 0, true);
  else if (e.type === 'crash') crash();
  else if (e.type === 'land') {
    track.add(board.pos, board.forward(), 0, true);
    audio.thump(e.impact);
    cam.dip = Math.min(0.5, e.impact * 0.05);
    const turns = Math.round(Math.abs(e.spin) / Math.PI);
    if (turns >= 1) showTrick(`${turns * 180}!`);
    else if (e.air > 1.2) showTrick(`滯空 ${e.air.toFixed(1)} 秒`);
  }
}

/** Trees and rocks: a fall at speed, otherwise you just bump off. */
function checkObstacles() {
  for (const o of course.near(board.pos.x, board.pos.z)) {
    const dx = board.pos.x - o.x;
    const dz = board.pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const reach = o.r + 0.35;
    if (d >= reach || board.pos.y > course.height(o.x, o.z) + o.top) continue;
    if (board.speed > 6) {
      crash();
      return;
    }
    board.pos.x = o.x + (dx / d) * reach;
    board.pos.z = o.z + (dz / d) * reach;
    board.vel.multiplyScalar(0.3);
  }
}

function physics(dt: number) {
  acc = Math.min(acc + dt, 0.1);
  while (acc >= STEP) {
    acc -= STEP;
    if (state === 'run') {
      for (const e of board.step(STEP, controls.input, course)) handle(e);
      checkObstacles();
    } else if (state === 'crash') {
      // Tumble to a stop.
      board.vel.multiplyScalar(Math.exp(-3 * STEP));
      board.vel.y -= 9.81 * STEP;
      board.pos.addScaledVector(board.vel, STEP);
      const h = course.height(board.pos.x, board.pos.z);
      if (board.pos.y < h) {
        board.pos.y = h;
        board.vel.y = Math.max(0, board.vel.y);
      }
    }
  }
}

const travel = new THREE.Vector3();
function updateCamera(dt: number) {
  const v = board.vel;
  const flat = Math.hypot(v.x, v.z);
  // Look where you are going (down the board when nearly stopped).
  let want = cam.yaw;
  if (flat > 2) want = Math.atan2(v.x, v.z);
  else if (!controls.input.turn) {
    // Nearly stopped: look along whichever end of the board is closer to the current view.
    want = Math.abs(wrap(board.heading - cam.yaw)) < Math.PI / 2 ? board.heading : wrap(board.heading + Math.PI);
  }
  cam.yaw = wrap(cam.yaw + wrap(want - cam.yaw) * Math.min(1, dt * (flat > 2 ? 3 : 1.5)));
  travel.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
  const n = board.normal;
  cam.roll += (board.edge * 0.06 - cam.roll) * Math.min(1, dt * 5);
  cam.dip *= Math.exp(-dt * 6);

  // Chase position behind and above, eased so turns swing the rider across the view.
  const wantPos = board.pos.clone().addScaledVector(travel, -CAM_BACK);
  wantPos.y += CAM_UP - cam.dip;
  if (cam.snap) {
    cam.pos.copy(wantPos);
    cam.snap = false;
  } else cam.pos.lerp(wantPos, Math.min(1, dt * 8));
  camera.position.copy(cam.pos);
  // Never let the camera dip into the slope behind the rider.
  camera.position.y = Math.max(camera.position.y, course.height(camera.position.x, camera.position.z) + 0.8);
  // Look at the snow a little ahead, so steep pitches tip the view down the slope.
  const ahead = board.pos.clone().addScaledVector(travel, CAM_AHEAD);
  const snow = course.height(ahead.x, ahead.z) + 0.8;
  ahead.y = board.grounded ? Math.min(board.pos.y + 0.8, snow) : Math.min(board.pos.y + 0.5, Math.max(snow, board.pos.y - 6));
  cam.look.lerp(ahead, cam.lookInit ? 1 : Math.min(1, dt * 6));
  cam.lookInit = false;
  camera.lookAt(cam.look);
  camera.rotateZ(cam.roll);
  const shake = board.grounded ? Math.min(1, board.speed / 30) ** 2 * 0.004 : 0;
  camera.rotateX((Math.random() - 0.5) * shake);
  camera.fov = BASE_FOV + Math.min(12, board.speed * 0.35);
  camera.updateProjectionMatrix();

  const crouch = controls.input.jump ? board.charge / 0.45 : Math.max(0, controls.input.press) * 0.35;
  rider.root.visible = true;
  rider.pose(board.pos, board.heading, n, board.edge, crouch, controls.input.lean, controls.input.press);
  if (state === 'crash') {
    // Tumble over onto the snow.
    rider.root.rotateZ(Math.min(1, crashFor / 0.5) * 1.35);
    rider.root.rotateY(crashFor * 2 * Math.exp(-crashFor * 2));
  }
}

function updateFx(dt: number) {
  const v = board.vel;
  if (board.grounded && state === 'run' && board.speed > 2) {
    const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
    track.add(board.pos, dir, 0.27 + board.skid * 1.1);
    const rate = board.skid * 160 + Math.abs(board.edge) * board.speed * 2.5;
    if (rate > 5) spray.emit(dt, rate, board.pos, dir, v);
  }
  spray.update(dt);
  audio.update(state === 'run' ? board.speed : 0, board.grounded, board.skid, board.edge);
}

function updateHud(dt: number) {
  $('time').textContent = fmt(clock);
  ($('speed').firstElementChild as HTMLElement).textContent = `${Math.round(board.speed * 3.6)}`;
  $('progress-fill').style.width = `${Math.max(0, Math.min(100, ((board.pos.z - START_Z) / (FINISH_Z - START_Z)) * 100))}%`;
  trickLeft -= dt;
  if (trickLeft <= 0) $('trick').classList.remove('show');
  if (state === 'countdown') $('hint').textContent = countdown > 0.4 ? `${Math.ceil(countdown - 0.4)}` : '出發！';
  else if (state === 'run' && clock < 6 && board.speed < 3) $('hint').textContent = '搖桿往前推，滑出去';
  else if (state === 'run' && $('hint').textContent && clock < 8) $('hint').textContent = '';
}

function resize() {
  renderer.setSize(app.clientWidth, app.clientHeight, false);
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controls.update();
  tick(dt, now);
  renderer.render(scene, camera);
}

function tick(dt: number, now: number) {
  if (state === 'menu') {
    // Slow fly-over of the run.
    const z = (now / 1000) * 25 % FINISH_Z;
    const x = course.centerX(z);
    camera.position.set(x + 30, course.height(x, z) + 40, z - 40);
    camera.lookAt(course.centerX(z + 120), course.height(course.centerX(z + 120), z + 120), z + 120);
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
    followSun(world, camera.position);
    rider.root.visible = false;
    return;
  }

  if (state === 'countdown') {
    countdown -= dt;
    if (countdown <= 0) state = 'run';
  } else if (state === 'run') {
    clock += dt;
    safe.timer += dt;
    if (safe.timer > 1.5 && board.grounded && board.skid < 0.4 && board.speed > 3) {
      safe.timer = 0;
      safe.pos.copy(board.pos);
      safe.heading = Math.atan2(board.vel.x, board.vel.z);
    }
    if (board.pos.z > FINISH_Z) finish();
  } else if (state === 'crash') {
    crashFor += dt;
    if (crashFor > CRASH_TIME) respawn();
  } else if (state === 'finish') {
    finishFor += dt;
    // Glide out with the board across, then show the result.
    controls.input.turn = true;
    controls.input.press = -1;
    for (const e of board.step(dt, controls.input, course)) void e;
    if (finishFor > 2.2 && !$('result').classList.contains('show')) {
      $('result').classList.add('show');
      document.body.classList.add('in-menu');
      audio.silence();
    }
  }
  physics(dt);
  updateCamera(dt);
  updateFx(dt);
  updateHud(dt);
  followSun(world, board.pos);
}

// Test hook for automated runs.
(window as unknown as { ski: unknown }).ski = {
  start,
  board,
  controls,
  course,
  get state() {
    return state;
  },
  /** Runs the game for `seconds` without rendering, holding the given input. */
  advance(seconds: number, input: Partial<typeof controls.input> = {}) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      Object.assign(controls.input, input);
      tick(1 / 60, performance.now());
    }
  },
};

requestAnimationFrame(frame);
