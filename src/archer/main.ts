import * as THREE from 'three';
import { ArenaAudio } from '../arena/audio';
import { lobAngle } from '../arena/monsters';
import { ProjectileState, STEP, stepProjectile } from '../arena/projectile';
import { ArenaWorld } from '../arena/world';
import { mulberry32 } from '../world/random';
import { Arrows, ArrowHit } from './arrows';
import { Enemy, EnemyKind, waveHp, waveRoster } from './enemies';
import { Fx } from './fx';
import { SKILLS, SkillId, Taken, bowStats, drawCards, rankFor } from './skills';
import { BowView } from './viewmodel';

// Archer: first-person bow against waves of chibi monsters. Move with the left thumb, drag
// to aim with the right; while the right thumb is down the bow fires on its own rhythm.
// Between waves, pick one of three skill cards; they stack into a build.

const SEED = 11;
const MOVE_SPEED = 5.5; // m/s
const EYE = 1.6;
const LOOK = 0.0048; // rad per px (touch)
const MOUSE = 0.0024;
const MAX_ALIVE = 18;
const BOMB_RADIUS = 2.8;
const BEST_KEY = 'archer.best';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 9 / 16, 0.03, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = new ArenaWorld(scene, SEED);
const fx = new Fx(scene);
const audio = new ArenaAudio();
const view = new BowView(camera);
const rand = mulberry32(SEED + 5);

let enemies: Enemy[] = [];
const arrows = new Arrows(scene, world, () => enemies, fx);
const player = { pos: new THREE.Vector3(), yaw: Math.PI, pitch: 0, hp: 100, maxHp: 100, hurtCd: 0, moving: 0 };
type State = 'menu' | 'fight' | 'cards' | 'over';
let state: State = 'menu';
let taken: Taken = {};
let stats = bowStats(taken);
let wave = 0;
let cleared = 0;
let queue: EnemyKind[] = [];
let spawnCd = 0;
let clearFor = -1;
let kills = 0;
let score = 0;
let fireTimer = 0;
let volleys = 0;
let hitStop = 0;
let shake = 0;
let bannerFor = 0;
const counted = new Set<Enemy>();

// ---------- Input ----------
const input = { x: 0, y: 0, firing: false, yaw: 0, pitch: 0 };
const keys = new Set<string>();
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
const touch = $('touch');
const stick = $('stick');
const knob = $('stick-knob');
let stickId: number | null = null;
let stickOrigin = { x: 0, y: 0 };
let aimId: number | null = null;
let aimLast = { x: 0, y: 0 };

touch.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (e.pointerType === 'mouse') {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    else if (e.button === 0) input.firing = true;
    return;
  }
  const r = touch.getBoundingClientRect();
  touch.setPointerCapture(e.pointerId);
  if (e.clientX < r.left + r.width * 0.45 && stickId === null) {
    stickId = e.pointerId;
    stickOrigin = { x: e.clientX, y: e.clientY };
    stick.style.left = `${e.clientX - r.left - 60}px`;
    stick.style.top = `${e.clientY - r.top - 60}px`;
    stick.style.bottom = 'auto';
  } else if (aimId === null) {
    aimId = e.pointerId;
    aimLast = { x: e.clientX, y: e.clientY };
    input.firing = true;
    document.body.classList.add('aimed');
  }
});
touch.addEventListener('pointermove', (e) => {
  if (e.pointerId === stickId) {
    let dx = e.clientX - stickOrigin.x;
    let dy = e.clientY - stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > 50) {
      dx = (dx / len) * 50;
      dy = (dy / len) * 50;
    }
    input.x = dx / 50;
    input.y = -dy / 50;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  } else if (e.pointerId === aimId) {
    input.yaw -= (e.clientX - aimLast.x) * LOOK * 1.2;
    input.pitch -= (e.clientY - aimLast.y) * LOOK;
    aimLast = { x: e.clientX, y: e.clientY };
  }
});
const release = (e: PointerEvent) => {
  if (e.pointerType === 'mouse') {
    input.firing = false;
    return;
  }
  if (e.pointerId === stickId) {
    stickId = null;
    input.x = input.y = 0;
    knob.style.transform = '';
    stick.style.left = stick.style.top = stick.style.bottom = '';
  } else if (e.pointerId === aimId) {
    aimId = null;
    input.firing = false;
  }
};
touch.addEventListener('pointerup', release);
touch.addEventListener('pointercancel', release);
addEventListener('mouseup', () => {
  if (!isTouch) input.firing = false;
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  input.yaw -= e.movementX * MOUSE * 1.2;
  input.pitch -= e.movementY * MOUSE;
});
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Escape') showMenu();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ---------- UI helpers ----------
const floaters: Array<{ el: HTMLElement; p: THREE.Vector3; t: number }> = [];
function floater(p: THREE.Vector3, text: string, cls = '') {
  const el = document.createElement('div');
  el.className = `dmg ${cls}`;
  el.textContent = text;
  $('floaters').append(el);
  floaters.push({ el, p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, 0)), t: 0 });
}

const indicators: Array<{ el: HTMLElement; from: THREE.Vector3; t: number }> = [];
function hurt(amount: number, from: THREE.Vector3) {
  if (state !== 'fight' || player.hurtCd > 0) return;
  player.hp -= amount;
  player.hurtCd = 0.3;
  shake = Math.max(shake, 0.5);
  audio.play('hurt');
  $('vignette').style.opacity = '0.8';
  const el = document.createElement('div');
  el.className = 'dir';
  $('dirs').append(el);
  indicators.push({ el, from: from.clone(), t: 0 });
  if (player.hp <= 0) gameOver();
}

function banner(text: string, seconds = 1.6) {
  $('banner').textContent = text;
  bannerFor = seconds;
}

function setRank() {
  const r = rankFor(cleared);
  const el = $('rank');
  if (el.textContent !== r) {
    el.textContent = r;
    el.classList.remove('up');
    void el.offsetWidth;
    el.classList.add('up');
  }
}

function renderSkills() {
  $('skills').replaceChildren(
    ...(Object.keys(taken) as SkillId[]).map((id) => {
      const s = document.createElement('span');
      const n = taken[id] ?? 0;
      s.textContent = `${SKILLS[id].icon} ${SKILLS[id].name}${n > 1 ? ` ×${n}` : ''}`;
      s.style.borderBottom = `2px solid ${SKILLS[id].color}`;
      return s;
    }),
  );
}

// ---------- Bombs ----------
interface Bomb {
  state: ProjectileState;
  mesh: THREE.Mesh;
  ring: { done: () => void };
  damage: number;
}
let bombs: Bomb[] = [];
const bombGeo = new THREE.IcosahedronGeometry(0.22, 1);
const bombMat = new THREE.MeshLambertMaterial({ color: 0x222222, emissive: 0x551100 });
const BOMB_SPEED = 15;

function lob(from: THREE.Vector3, to: THREE.Vector3, damage: number) {
  to.y = world.height(to.x, to.z);
  const flat = to.clone().sub(from).setY(0);
  const d = flat.length();
  const angle = lobAngle(BOMB_SPEED, d * 1.05, to.y - from.y) ?? Math.PI / 4;
  flat.normalize();
  const v = flat.multiplyScalar(Math.cos(angle) * BOMB_SPEED).setY(Math.sin(angle) * BOMB_SPEED);
  const mesh = new THREE.Mesh(bombGeo, bombMat);
  mesh.position.copy(from);
  mesh.castShadow = true;
  scene.add(mesh);
  const flight = d / Math.max(1, Math.cos(angle) * BOMB_SPEED);
  bombs.push({
    state: { pos: { x: from.x, y: from.y, z: from.z }, vel: { x: v.x, y: v.y, z: v.z }, time: 0 },
    mesh,
    ring: fx.ring(to, BOMB_RADIUS, 0xff3b30, flight + 1),
    damage,
  });
  audio.play('throw', from.distanceTo(player.pos));
}

let bombAcc = 0;
function updateBombs(dt: number) {
  bombAcc = Math.min(bombAcc + dt, 0.1);
  const steps = Math.floor(bombAcc / STEP);
  bombAcc -= steps * STEP;
  for (const b of bombs) {
    for (let i = 0; i < steps; i++) b.state = stepProjectile(b.state, { drag: 0.002, gravity: 9.81 });
    const p = b.state.pos;
    b.mesh.position.set(p.x, p.y, p.z);
    b.mesh.rotation.x += dt * 8;
    if (p.y <= world.height(p.x, p.z) || b.state.time > 6) {
      const at = new THREE.Vector3(p.x, world.height(p.x, p.z) + 0.3, p.z);
      fx.explosion(at, BOMB_RADIUS);
      audio.play('blast', at.distanceTo(player.pos));
      b.ring.done();
      scene.remove(b.mesh);
      b.state.time = -1;
      const d = at.distanceTo(player.pos.clone().setY(player.pos.y + 0.8));
      if (d < BOMB_RADIUS) hurt(Math.round(b.damage * (1 - (d / BOMB_RADIUS) * 0.5)), at);
      shake = Math.max(shake, Math.max(0, 0.6 - d / 20));
    }
  }
  bombs = bombs.filter((b) => b.state.time >= 0);
}

// ---------- Arrows hitting things ----------
arrows.onHit = (h: ArrowHit) => {
  if (h.part === 'shield') {
    floater(h.point, '擋', 'block');
    audio.play('impact');
    return;
  }
  floater(h.point, h.crit ? `暴擊 ${h.damage}` : `${h.damage}`, h.crit ? 'crit' : h.part === 'head' ? 'head' : '');
  audio.play(h.killed ? 'kill' : h.part === 'head' || h.crit ? 'head' : 'hit');
  if (h.crit || h.killed) hitStop = Math.max(hitStop, h.enemy.kind === 'boss' && h.killed ? 0.35 : 0.05);
};
arrows.onBlast = (p) => {
  audio.play('blast', p.distanceTo(player.pos));
  shake = Math.max(shake, 0.25);
};

// ---------- Firing ----------
function volley() {
  camera.updateMatrixWorld();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0);
  const origin = camera.position.clone().addScaledVector(fwd, 0.5).add(new THREE.Vector3(0, -0.06, 0));
  volleys += 1;
  const giant = stats.giantEvery > 0 && volleys % stats.giantEvery === 0;
  const n = stats.arrows;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 0.05;
    arrows.fire(origin, fwd.clone().applyAxisAngle(up, off), stats, giant && i === Math.floor((n - 1) / 2));
  }
  for (let k = 1; k <= stats.diagonal; k++) {
    for (const s of [-1, 1]) arrows.fire(origin, fwd.clone().applyAxisAngle(up, s * (0.35 + 0.2 * k)), stats, false);
  }
  view.shot();
  audio.play('bow');
}

// ---------- Waves ----------
function spawnSpot(): THREE.Vector3 {
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  let best = world.randomOpenSpot(rand, 1.5, 52);
  for (let i = 0; i < 30; i++) {
    const p = world.randomOpenSpot(rand, 1.5, 52);
    const to = p.clone().sub(player.pos).setY(0);
    const d = to.length();
    // Prefer coming from in front, far enough to see them run in.
    if (d > 15 && d < 30 && to.normalize().dot(fwd) > 0.4) return p;
    if (d > 15) best = p;
  }
  return best;
}

function startWave() {
  wave += 1;
  queue = waveRoster(wave);
  spawnCd = 0.8;
  clearFor = -1;
  state = 'fight';
  banner(wave % 5 === 0 ? `第 ${wave} 波　BOSS！` : `第 ${wave} 波`);
}

function spawnTick(dt: number) {
  spawnCd -= dt;
  const alive = enemies.filter((e) => e.alive).length;
  if (queue.length && spawnCd <= 0 && alive < MAX_ALIVE) {
    const kind = queue.shift()!;
    const e = new Enemy(kind, spawnSpot(), waveHp(wave));
    enemies.push(e);
    scene.add(e.model.root);
    fx.puff(e.position.clone().setY(e.position.y + 0.5), 0xffffff, 8, 1);
    spawnCd = Math.max(0.25, 0.9 - wave * 0.05);
  }
  if (!queue.length && alive === 0 && clearFor < 0) clearFor = 0;
  if (clearFor >= 0) {
    clearFor += dt;
    if (clearFor > 1.2) showCards();
  }
}

function showCards() {
  cleared = wave;
  setRank();
  state = 'cards';
  input.firing = false;
  const row = $('card-row');
  row.replaceChildren(
    ...drawCards(taken, rand).map((id) => {
      const s = SKILLS[id];
      const b = document.createElement('button');
      b.className = 'card';
      b.style.background = `linear-gradient(${s.color}, rgba(20,20,40,0.9))`;
      const lvl = taken[id] ?? 0;
      b.innerHTML = `<div class="icon"></div><div class="name"></div><div class="text"></div><div class="lvl"></div>`;
      (b.querySelector('.icon') as HTMLElement).textContent = s.icon;
      (b.querySelector('.name') as HTMLElement).textContent = s.name;
      (b.querySelector('.text') as HTMLElement).textContent = s.text;
      (b.querySelector('.lvl') as HTMLElement).textContent = id === 'heal' ? '' : `等級 ${lvl} → ${lvl + 1}`;
      b.addEventListener('click', () => pick(id));
      return b;
    }),
  );
  $('cards').classList.add('show');
}

function pick(id: SkillId) {
  taken = { ...taken, [id]: (taken[id] ?? 0) + 1 };
  if (id === 'heal') {
    player.maxHp += 20;
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.4);
  }
  stats = bowStats(taken);
  view.crossbowMode = stats.crossbow;
  renderSkills();
  $('cards').classList.remove('show');
  audio.play('reload');
  startWave();
}

// ---------- Game flow ----------
function clearAll() {
  for (const e of enemies) scene.remove(e.model.root);
  for (const b of bombs) {
    scene.remove(b.mesh);
    b.ring.done();
  }
  enemies = [];
  bombs = [];
  counted.clear();
  arrows.clear();
  $('floaters').replaceChildren();
  floaters.length = 0;
  for (const i of indicators) i.el.remove();
  indicators.length = 0;
}

function start() {
  audio.unlock();
  clearAll();
  taken = {};
  stats = bowStats(taken);
  view.crossbowMode = false;
  Object.assign(player, { hp: 100, maxHp: 100, hurtCd: 0, yaw: Math.PI, pitch: 0 });
  player.pos.copy(world.at(0, -30));
  wave = cleared = kills = score = volleys = 0;
  renderSkills();
  $('rank').textContent = '';
  setRank();
  document.body.classList.remove('in-menu');
  for (const id of ['menu', 'over', 'cards']) $(id).classList.remove('show');
  startWave();
}

function showMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  clearAll();
  state = 'menu';
  document.body.classList.add('in-menu');
  for (const id of ['over', 'cards']) $(id).classList.remove('show');
  $('menu').classList.add('show');
}

function gameOver() {
  state = 'over';
  if (document.pointerLockElement) document.exitPointerLock();
  input.firing = false;
  let best = 0;
  try {
    best = Math.max(Number(localStorage.getItem(BEST_KEY)) || 0, score);
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    best = score;
  }
  $('over-rank').textContent = rankFor(cleared);
  $('over-stats').innerHTML = '';
  for (const line of [`撐到第 ${wave} 波`, `擊倒 ${kills}`, `分數 ${score}`, `最高分 ${best}`]) {
    const d = document.createElement('div');
    d.textContent = line;
    $('over-stats').append(d);
  }
  document.body.classList.add('in-menu');
  $('over').classList.add('show');
}

$('btn-start').addEventListener('click', start);
$('btn-again').addEventListener('click', start);
$('btn-back').addEventListener('click', showMenu);
$('btn-menu').addEventListener('click', showMenu);

// ---------- Loop ----------
function resize() {
  renderer.setSize(app.clientWidth, app.clientHeight, false);
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const enemyCtx = {
  world,
  player: player.pos,
  get enemies() {
    return enemies;
  },
  rand,
  hurt,
  lob,
};

function updatePlayer(dt: number) {
  player.yaw += input.yaw;
  player.pitch = THREE.MathUtils.clamp(player.pitch + input.pitch, -1.2, 1.2);
  input.yaw = input.pitch = 0;
  let mx = input.x;
  let my = input.y;
  if (keys.has('KeyW')) my += 1;
  if (keys.has('KeyS')) my -= 1;
  if (keys.has('KeyD')) mx += 1;
  if (keys.has('KeyA')) mx -= 1;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const fx_ = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  player.pos.x += (my * fx_ - mx * fz) * MOVE_SPEED * dt;
  player.pos.z += (my * fz + mx * fx_) * MOVE_SPEED * dt;
  world.resolve(player.pos, 0.35);
  player.moving = Math.min(1, len);
  player.hurtCd = Math.max(0, player.hurtCd - dt);
}

function tick(dt: number) {
  updatePlayer(dt);
  // Fire on a rhythm while aiming.
  fireTimer += dt;
  if (input.firing && fireTimer >= stats.interval) {
    fireTimer = 0;
    volley();
  }
  if (!input.firing) fireTimer = Math.min(fireTimer, stats.interval);
  spawnTick(dt);
  for (const e of enemies) {
    e.update(dt, enemyCtx);
    if (!e.alive && !counted.has(e)) {
      counted.add(e);
      kills += 1;
      score += Math.round(e.def.score * (1 + wave * 0.1));
      fx.burst(e.centre(), 0xffe04a, e.kind === 'boss' ? 60 : 18, e.kind === 'boss' ? 12 : 7);
      if (e.kind === 'boss') {
        fx.explosion(e.centre(), 5);
        shake = 1;
      }
    }
    if (e.alive && Math.random() < dt * 14) {
      if (e.burn > 0) fx.status(e.centre(), 0xff7a2a, true);
      if (e.poisonLeft > 0) fx.status(e.centre(), 0x8be04a, true);
      if (e.frozenLeft > 0) fx.status(e.centre(), 0xbfe8ff, false);
    }
  }
  enemies = enemies.filter((e) => {
    if (e.removed) {
      scene.remove(e.model.root);
      fx.puff(e.centre(), 0xffffff, 10, 1.2 * e.def.scale);
    }
    return !e.removed;
  });
  updateBombs(dt);
  arrows.update(dt, camera.position);
}

function updateHud(dt: number) {
  $('wave').textContent = `第 ${wave} 波`;
  $('score').textContent = `擊倒 ${kills}　分數 ${score}`;
  const hp = Math.max(0, player.hp);
  $('hp-fill').style.width = `${(hp / player.maxHp) * 100}%`;
  $('hp-text').textContent = `${Math.ceil(hp)} / ${player.maxHp}`;
  const v = $('vignette');
  v.style.opacity = `${Math.max(Math.max(0, 0.4 - hp / player.maxHp), Number(v.style.opacity || 0) - dt * 2)}`;
  bannerFor -= dt;
  if (bannerFor <= 0) $('banner').textContent = '';
  for (const f of floaters) {
    f.t += dt;
    const p = f.p.clone().setY(f.p.y + f.t * 1.2).project(camera);
    f.el.style.left = `${((p.x + 1) / 2) * app.clientWidth}px`;
    f.el.style.top = `${((1 - p.y) / 2) * app.clientHeight}px`;
    f.el.style.opacity = `${p.z < 1 ? Math.max(0, 1 - f.t / 0.8) : 0}`;
    if (f.t > 0.8) f.el.remove();
  }
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t > 0.8) floaters.splice(i, 1);
  const fx_ = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  for (const ind of indicators) {
    ind.t += dt;
    const dx = ind.from.x - player.pos.x;
    const dz = ind.from.z - player.pos.z;
    ind.el.style.transform = `rotate(${Math.atan2(dx * -fz + dz * fx_, dx * fx_ + dz * fz)}rad)`;
    ind.el.style.opacity = `${Math.max(0, 1 - ind.t / 1.4)}`;
    if (ind.t > 1.4) ind.el.remove();
  }
  for (let i = indicators.length - 1; i >= 0; i--) if (indicators[i].t > 1.4) indicators.splice(i, 1);
}

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Hit stop: a few frames of near-freeze on crits and kills.
  hitStop = Math.max(0, hitStop - real);
  const dt = hitStop > 0 ? real * 0.06 : real;
  if (state === 'fight') tick(dt);
  if (state !== 'menu') {
    fx.update(dt);
    camera.position.copy(player.pos).setY(player.pos.y + EYE);
    shake *= Math.exp(-real * 6);
    camera.rotation.set(player.pitch + (Math.random() - 0.5) * shake * 0.06, player.yaw + (Math.random() - 0.5) * shake * 0.06, 0);
    const draw = Math.min(1, fireTimer / stats.interval);
    view.update(dt, input.firing ? draw : Math.min(draw, 0.6), player.moving);
    updateHud(real);
  } else {
    const a = now / 9000;
    const c = world.at(0, 0);
    camera.position.set(c.x + Math.sin(a) * 40, c.y + 14, c.z + Math.cos(a) * 40);
    camera.lookAt(c.x, c.y, c.z);
  }
  view.group.visible = state !== 'menu';
  renderer.render(scene, camera);
}

// Test hook for automated runs.
(window as unknown as { archer: unknown }).archer = {
  start,
  player,
  input,
  pick,
  get state() {
    return state;
  },
  get enemies() {
    return enemies;
  },
  /** Runs the game for `seconds` without rendering. */
  advance(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) if (state === 'fight') tick(1 / 60);
  },
};

requestAnimationFrame(frame);
