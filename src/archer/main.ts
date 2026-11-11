import * as THREE from 'three';
import { ArenaAudio } from '../arena/audio';
import { lobAngle } from '../arena/monsters';
import { ProjectileState, STEP, stepProjectile } from '../arena/projectile';
import { Trail } from '../arena/trails';
import { mulberry32 } from '../world/random';
import { Arrows, ArrowHit } from './arrows';
import { Enemy, EnemyKind, waveHp, waveRoster } from './enemies';
import { Fx } from './fx';
import { Level, Zone } from './level';
import { SKILLS, SkillId, Taken, bowStats, drawCards, rankFor } from './skills';
import { BowView } from './viewmodel';

// Archer: first-person bow against waves of chibi monsters. Move with the left thumb, drag
// to aim with the right; while the right thumb is down the bow fires on its own rhythm.
// The level runs forward: each clearing is a wave that comes at you from ahead (archers and
// bombers up on platforms), then a skill card, then the gate opens and you push on.
// The dodge button dashes the way the stick points, invulnerable while dashing.

const SEED = 11;
const MOVE_SPEED = 5.5; // m/s (default; adjustable in the pause menu)
const EYE = 1.6;
const LOOK = 0.0048; // rad per px (touch)
const MOUSE = 0.0024;
const MAX_ALIVE = 18;
const BOMB_RADIUS = 2.8;
const BEST_KEY = 'archer.best';
const DASH_SPEED = 15; // m/s
const DASH_TIME = 0.22; // s
const DASH_GRACE = 0.12; // s of invulnerability after the dash
const DASH_COOLDOWN = 0.9;
const ENEMY_ARROW_SPEED = 30;

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
const world = new Level(scene, SEED);
world.ensure(2);
const fx = new Fx(scene);
const audio = new ArenaAudio();
const view = new BowView(camera);
const rand = mulberry32(SEED + 5);

let enemies: Enemy[] = [];
const arrows = new Arrows(scene, world, () => enemies, fx);
const player = {
  pos: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: 0,
  hp: 100,
  maxHp: 100,
  hurtCd: 0,
  moving: 0,
  dash: 0, // s of dash left
  dashCd: 0,
  invuln: 0,
  dashDir: new THREE.Vector3(),
};
let zone: Zone | null = null; // the clearing being fought (or just cleared)
let advancing = false; // gate open, walking to the next clearing
type State = 'menu' | 'fight' | 'cards' | 'paused' | 'over';
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
const settings = { move: MOVE_SPEED, aim: 1 }; // loaded from storage with the pause menu below
let dodgeRequested = false;
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
  // Capture can throw if the browser has already dropped the pointer (a very quick tap):
  // never let that stop the touch from being assigned below.
  try {
    touch.setPointerCapture(e.pointerId);
  } catch {
    // keep going without capture
  }
  // The side of the screen decides the role. A new touch always takes the role over, so a
  // finger whose release was never delivered (an overlay popped up under it) can't leave
  // the stick stuck or turn a left-hand touch into aiming.
  if (e.clientX < r.left + r.width * 0.45) {
    stickId = e.pointerId;
    input.x = input.y = 0;
    knob.style.transform = '';
    stickOrigin = { x: e.clientX, y: e.clientY };
    stick.style.left = `${e.clientX - r.left - 60}px`;
    stick.style.top = `${e.clientY - r.top - 60}px`;
    stick.style.bottom = 'auto';
  } else {
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
    input.yaw -= (e.clientX - aimLast.x) * LOOK * settings.aim * 1.2;
    input.pitch -= (e.clientY - aimLast.y) * LOOK * settings.aim;
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
touch.addEventListener('lostpointercapture', release);

/** Forgets every finger (called whenever an overlay takes over the screen). */
function resetTouches() {
  stickId = aimId = null;
  input.x = input.y = 0;
  input.firing = false;
  knob.style.transform = '';
  stick.style.left = stick.style.top = stick.style.bottom = '';
  keys.clear();
}
addEventListener('mouseup', () => {
  if (!isTouch) input.firing = false;
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  input.yaw -= e.movementX * MOUSE * settings.aim * 1.2;
  input.pitch -= e.movementY * MOUSE * settings.aim;
});
$('btn-dodge').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dodgeRequested = true;
});
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'ShiftLeft') dodgeRequested = true;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
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
  if (state !== 'fight' || player.hurtCd > 0 || player.invuln > 0) return;
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

// ---------- Enemy arrows ----------
interface EnemyArrow {
  state: ProjectileState;
  mesh: THREE.Mesh;
  trail: Trail;
  damage: number;
  from: THREE.Vector3;
}
let enemyArrows: EnemyArrow[] = [];
const enemyArrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.8).translate(0, 0, -0.4);
const enemyArrowMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
const playerVel = new THREE.Vector3();
const lastPos = new THREE.Vector3();
let eyeY = EYE;

// A bobbing arrow over the open gate pointing the way on.
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd23c }));
marker.visible = false;
scene.add(marker);

/** An archer looses at the player, leading them a little and allowing for drop, not perfectly. */
function shoot(from: THREE.Vector3, damage: number) {
  const chest = player.pos.clone().setY(player.pos.y + 1.1);
  const d = chest.distanceTo(from);
  const tof = d / ENEMY_ARROW_SPEED;
  const aim = chest.addScaledVector(playerVel, tof * 0.7);
  aim.y += 0.5 * 9.81 * tof * tof;
  aim.add(new THREE.Vector3((rand() - 0.5) * 1.2, (rand() - 0.5) * 0.6, (rand() - 0.5) * 1.2));
  const v = aim.sub(from).normalize().multiplyScalar(ENEMY_ARROW_SPEED);
  const mesh = new THREE.Mesh(enemyArrowGeo, enemyArrowMat);
  mesh.position.copy(from);
  scene.add(mesh);
  const trail = new Trail(0xff5a4a, 0.5, 0.12, 0.003, 6);
  scene.add(trail.mesh);
  enemyArrows.push({ state: { pos: { x: from.x, y: from.y, z: from.z }, vel: { x: v.x, y: v.y, z: v.z }, time: 0 }, mesh, trail, damage, from: from.clone() });
  audio.play('bow', from.distanceTo(player.pos));
}

let enemyArrowAcc = 0;
function updateEnemyArrows(dt: number) {
  enemyArrowAcc = Math.min(enemyArrowAcc + dt, 0.1);
  const steps = Math.floor(enemyArrowAcc / STEP);
  enemyArrowAcc -= steps * STEP;
  const chest = player.pos.clone().setY(player.pos.y + 1.0);
  const seg = new THREE.Line3();
  const closest = new THREE.Vector3();
  for (const a of enemyArrows) {
    for (let i = 0; i < steps && a.state.time >= 0; i++) {
      const p0 = a.state.pos;
      const next = stepProjectile(a.state, { drag: 0.0015, gravity: 9.81 });
      seg.set(new THREE.Vector3(p0.x, p0.y, p0.z), new THREE.Vector3(next.pos.x, next.pos.y, next.pos.z));
      seg.closestPointToPoint(chest, true, closest);
      if (closest.distanceTo(chest) < 0.55) {
        if (player.invuln > 0) floater(closest, '閃過', 'block');
        else hurt(a.damage, a.from);
        a.state.time = -1;
        break;
      }
      const wall = world.collide(p0, next.pos);
      if (wall || next.time > 4) {
        a.state.time = -1;
        break;
      }
      a.state = next;
      if (i % 3 === 0) a.trail.add(next.pos);
    }
    const p = a.state.pos;
    a.mesh.position.set(p.x, p.y, p.z);
    a.mesh.lookAt(p.x + a.state.vel.x, p.y + a.state.vel.y, p.z + a.state.vel.z);
    if (a.state.time < 0) {
      scene.remove(a.mesh);
      a.trail.finish();
    }
    if (!a.trail.update(dt, camera.position)) a.state.time = -2;
  }
  enemyArrows = enemyArrows.filter((a) => {
    if (a.state.time === -2) {
      scene.remove(a.mesh, a.trail.mesh);
      a.trail.dispose();
      return false;
    }
    return true;
  });
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
/** A ground spot at the far end of the clearing, so they come at you from ahead. */
function groundSpot(z: Zone): THREE.Vector3 {
  const p = new THREE.Vector3();
  for (let i = 0; i < 20; i++) {
    p.set((rand() - 0.5) * (z.half * 2 - 4), 0, z.z1 - 3 - rand() * 10);
    const q = p.clone();
    world.resolve(q, 0.6);
    if (q.distanceTo(p) < 0.01) return p;
  }
  return p.set(0, 0, z.z1 - 4);
}

/** Free standing spots on the clearing's platforms (two per platform). */
function perches(z: Zone): Array<{ at: THREE.Vector3; y: number }> {
  const out: Array<{ at: THREE.Vector3; y: number }> = [];
  for (const p of z.platforms) {
    const cx = (p.min.x + p.max.x) / 2;
    const cz = (p.min.z + p.max.z) / 2;
    for (const dx of [-0.9, 0.9]) out.push({ at: new THREE.Vector3(cx + dx, p.max.y + 0.25, cz), y: p.max.y + 0.25 });
  }
  return out;
}

let freePerches: Array<{ at: THREE.Vector3; y: number }> = [];

function startWave() {
  wave += 1;
  world.ensure(wave + 2);
  zone = world.zones[wave - 1];
  advancing = false;
  freePerches = perches(zone);
  queue = waveRoster(wave);
  // Shooters that will stand on platforms come first, the rest run in.
  queue.sort((a, b) => Number(b === 'archer' || b === 'bomber') - Number(a === 'archer' || a === 'bomber'));
  spawnCd = 0.8;
  clearFor = -1;
  state = 'fight';
  banner(wave % 5 === 0 ? `第 ${wave} 波　BOSS！` : `第 ${wave} 波`);
}

function spawnTick(dt: number) {
  if (advancing || !zone) {
    // Walk on: the next fight starts once you step into the next clearing.
    const next = world.zones[wave];
    if (advancing && next && player.pos.z > next.z0 + 3) startWave();
    return;
  }
  spawnCd -= dt;
  const alive = enemies.filter((e) => e.alive).length;
  if (queue.length && spawnCd <= 0 && alive < MAX_ALIVE) {
    const kind = queue.shift()!;
    const perch = (kind === 'archer' || kind === 'bomber') && freePerches.length ? freePerches.shift()! : null;
    const e = new Enemy(kind, perch ? perch.at : groundSpot(zone), waveHp(wave), perch ? perch.y : null);
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
  resetTouches();
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
  resetTouches();
  $('cards').classList.remove('show');
  audio.play('reload');
  // Open the way forward.
  state = 'fight';
  if (zone) world.openGate(zone);
  advancing = true;
  clearFor = -1;
  banner('前進！', 2);
}

// ---------- Game flow ----------
function clearAll() {
  for (const e of enemies) scene.remove(e.model.root);
  for (const b of bombs) {
    scene.remove(b.mesh);
    b.ring.done();
  }
  for (const a of enemyArrows) {
    scene.remove(a.mesh, a.trail.mesh);
    a.trail.dispose();
  }
  enemies = [];
  bombs = [];
  enemyArrows = [];
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
  Object.assign(player, { hp: 100, maxHp: 100, hurtCd: 0, yaw: Math.PI, pitch: 0, dash: 0, dashCd: 0, invuln: 0 });
  player.pos.set(0, 0, 4);
  lastPos.copy(player.pos);
  world.reset();
  zone = null;
  advancing = false;
  wave = cleared = kills = score = volleys = 0;
  renderSkills();
  $('rank').textContent = '';
  setRank();
  document.body.classList.remove('in-menu');
  for (const id of ['menu', 'over', 'cards', 'pause']) $(id).classList.remove('show');
  resetTouches();
  startWave();
}

function showMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  clearAll();
  state = 'menu';
  document.body.classList.add('in-menu');
  for (const id of ['over', 'cards', 'pause']) $(id).classList.remove('show');
  resetTouches();
  $('menu').classList.add('show');
}

function gameOver() {
  state = 'over';
  if (document.pointerLockElement) document.exitPointerLock();
  resetTouches();
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
$('btn-menu').addEventListener('click', () => togglePause());
$('btn-resume').addEventListener('click', () => togglePause());
$('btn-quit').addEventListener('click', showMenu);

// ---------- Pause and settings ----------
const SETTINGS_KEY = 'archer.settings';
function loadSettings(): { move: number; aim: number } {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { move: Number(s.move) || MOVE_SPEED, aim: Number(s.aim) || 1 };
  } catch {
    return { move: MOVE_SPEED, aim: 1 };
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings last for this visit only
  }
}
const formats = { move: (v: number) => `${v.toFixed(1)} m/s`, aim: (v: number) => `${v.toFixed(2)}×` };
function showSetting(key: 'move' | 'aim') {
  $<HTMLInputElement>(`set-${key}`).value = String(settings[key]);
  $(`set-${key}-val`).textContent = formats[key](settings[key]);
}
Object.assign(settings, loadSettings());
for (const key of ['move', 'aim'] as const) {
  showSetting(key);
  $<HTMLInputElement>(`set-${key}`).addEventListener('input', (e) => {
    settings[key] = Number((e.target as HTMLInputElement).value);
    showSetting(key);
    saveSettings();
  });
}
$('btn-reset-settings').addEventListener('click', () => {
  settings.move = MOVE_SPEED;
  settings.aim = 1;
  saveSettings();
  showSetting('move');
  showSetting('aim');
});

function togglePause() {
  if (state === 'fight') {
    state = 'paused';
    resetTouches();
    if (document.pointerLockElement) document.exitPointerLock();
    $('pause').classList.add('show');
  } else if (state === 'paused') {
    state = 'fight';
    resetTouches();
    $('pause').classList.remove('show');
  }
}

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
  shoot,
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
  const wx = my * fx_ - mx * fz;
  const wz = my * fz + mx * fx_;
  // Dodge: a short burst the way the stick points (backwards if it is centred).
  if (dodgeRequested && player.dashCd <= 0) {
    if (len > 0.2) player.dashDir.set(wx, 0, wz).normalize();
    else player.dashDir.set(-fx_, 0, -fz);
    player.dash = DASH_TIME;
    player.dashCd = DASH_COOLDOWN;
    player.invuln = DASH_TIME + DASH_GRACE;
    audio.play('throw');
    fx.puff(player.pos.clone().setY(0.3), 0xe8d2b0, 6, 1);
  }
  dodgeRequested = false;
  if (player.dash > 0) {
    player.dash -= dt;
    player.pos.addScaledVector(player.dashDir, DASH_SPEED * dt);
  } else {
    player.pos.x += wx * settings.move * dt;
    player.pos.z += wz * settings.move * dt;
  }
  world.resolve(player.pos, 0.35);
  playerVel.copy(player.pos).sub(lastPos).divideScalar(Math.max(dt, 1e-4));
  lastPos.copy(player.pos);
  player.moving = player.dash > 0 ? 1.5 : Math.min(1, len);
  player.hurtCd = Math.max(0, player.hurtCd - dt);
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.invuln = Math.max(0, player.invuln - dt);
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
  updateEnemyArrows(dt);
  world.update(dt, player.pos);
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
    fx.update(state === 'fight' ? dt : 0); // effects freeze while paused or picking a card
    // Ease the view up and down when climbing over low cover.
    eyeY += (player.pos.y + EYE - eyeY) * Math.min(1, real * 12);
    camera.position.copy(player.pos).setY(eyeY);
    // A quick widening of the view while dashing.
    camera.fov += ((player.dash > 0 ? 82 : 70) - camera.fov) * Math.min(1, real * 12);
    camera.updateProjectionMatrix();
    marker.visible = advancing && !!zone;
    if (zone && marker.visible) marker.position.set(0, 2.2 + Math.sin(now / 200) * 0.3, (zone.gate.min.z + zone.gate.max.z) / 2 + 2);
    const cd = $('btn-dodge');
    cd.classList.toggle('cooling', player.dashCd > 0);
    cd.style.setProperty('--cd', `${(player.dashCd / DASH_COOLDOWN) * 100}%`);
    shake *= Math.exp(-real * 6);
    camera.rotation.set(player.pitch + (Math.random() - 0.5) * shake * 0.06, player.yaw + (Math.random() - 0.5) * shake * 0.06, 0);
    const draw = Math.min(1, fireTimer / stats.interval);
    view.update(dt, input.firing ? draw : Math.min(draw, 0.6), player.moving);
    updateHud(real);
  } else {
    // Menu backdrop: drift along the first clearings.
    const z = 10 + ((now / 1000) * 4) % 80;
    camera.position.set(Math.sin(now / 4000) * 4, 6, z);
    camera.lookAt(0, 1, z + 25);
    world.update(0, camera.position);
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
