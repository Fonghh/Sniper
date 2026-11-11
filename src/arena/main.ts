import * as THREE from 'three';
import { LOOK } from '../game/config';
import { Actions, Input } from '../input/input';
import { mulberry32 } from '../world/random';
import { ArenaAudio } from './audio';
import { BOT_LOOKS, Bot, BotContext } from './bots';
import { Monster, MonsterContext, MonsterKind, waveRoster } from './monsters';
import { ArenaPlayer, PLAYER_ARENA } from './player';
import { STEP, traceArc } from './projectile';
import { HitEvent, Projectiles } from './projectiles';
import { Hittable, TargetDummy, createRange } from './targets';
import { Viewmodel } from './viewmodel';
import { Shot, WEAPONS, WeaponId, WeaponState, launchSpeed } from './weapons';
import { ArenaWorld } from './world';

// Arena feel prototype: a practice range, a 3-minute bot deathmatch and monster waves.

const SEED = 7;
const MATCH_TIME = 180; // s
const PLAYER_RESPAWN = 3; // s
const BASE_FOV = 78;
const THROW_LIFT = 0.12; // rad: grenades leave a little above the crosshair
const WAVE_BREAK = 5; // s between waves
const MAX_MONSTERS = 14; // alive at once
const BEST_KEY = 'arena.waves.best';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const app = $('app');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(BASE_FOV, 9 / 16, 0.03, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = new ArenaWorld(scene, SEED);
const player = new ArenaPlayer(world);
const viewmodel = new Viewmodel(camera);
const audio = new ArenaAudio();
const rand = mulberry32(SEED + 31);

type Mode = 'menu' | 'range' | 'match' | 'waves' | 'summary';
type PlayMode = 'range' | 'match' | 'waves';
let mode: Mode = 'menu';
let dummies: TargetDummy[] = [];
let bots: Bot[] = [];
let monsters: Monster[] = [];
const waves = { wave: 0, queue: [] as MonsterKind[], spawnCd: 0, breakLeft: 0, score: 0 };
let timeLeft = MATCH_TIME;
let deadFor = 0;
let killerName = '';
const stats = { shots: 0, hits: 0, heads: 0, kills: 0 };
const board = new Map<Hittable, { name: string; kills: number; deaths: number }>();

const weapons: Record<WeaponId, WeaponState> = {
  rifle: new WeaponState(WEAPONS.rifle),
  bow: new WeaponState(WEAPONS.bow),
  grenade: new WeaponState(WEAPONS.grenade),
};
let current: WeaponId = 'rifle';
let ads = false;
let adsAmount = 0;
let shake = 0;
let extraYaw = 0;
let extraPitch = 0;

const fighters = (): Hittable[] => (mode === 'range' ? dummies : mode === 'waves' ? [player, ...monsters] : [player, ...bots]);
const isPlaying = () => mode === 'range' || mode === 'match' || mode === 'waves';
const projectiles = new Projectiles(scene, world, fighters);
const spawnPoint = world.at(0, -45);

// ---------- Input ----------
const actions: Actions = {
  toggleScope: () => setAds(!ads),
  toggleStance: () => {},
  toggleTracking: () => {},
  beginShot: () => trigger(true),
  releaseShot: (fire) => trigger(false, !fire),
  stepZero: (d) => cycleWeapon(d > 0 ? -1 : 1),
  cycleMagnification: () => {},
  isScoped: () => ads,
  tap: () => {},
};
const input = new Input(canvas, $('joystick-knob'), actions);

addEventListener('keydown', (e) => {
  if (!isPlaying()) return;
  if (e.code === 'Digit1') selectWeapon('rifle');
  if (e.code === 'Digit2') selectWeapon('bow');
  if (e.code === 'Digit3') selectWeapon('grenade');
  if (e.code === 'KeyQ') cycleWeapon(1);
  if (e.code === 'KeyR') reload();
  if (e.code === 'Escape') showMenu();
});

// Fire button: hold to fire/draw/aim, and drag on it to keep aiming.
const fireBtn = $('btn-fire');
let firePointer: number | null = null;
let fireLast = { x: 0, y: 0 };
fireBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  firePointer = e.pointerId;
  fireLast = { x: e.clientX, y: e.clientY };
  fireBtn.setPointerCapture(e.pointerId);
  trigger(true);
});
fireBtn.addEventListener('pointermove', (e) => {
  if (e.pointerId !== firePointer) return;
  extraYaw -= (e.clientX - fireLast.x) * LOOK.touchSensitivity * LOOK.horizontalBoost;
  extraPitch -= (e.clientY - fireLast.y) * LOOK.touchSensitivity * (input.invertY ? -1 : 1);
  fireLast = { x: e.clientX, y: e.clientY };
});
const fireUp = (e: PointerEvent) => {
  if (e.pointerId !== firePointer) return;
  firePointer = null;
  trigger(false);
};
fireBtn.addEventListener('pointerup', fireUp);
fireBtn.addEventListener('pointercancel', fireUp);
$('btn-ads').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setAds(!ads);
});
$('btn-reload').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  reload();
});
$('btn-menu').addEventListener('click', () => showMenu());
for (const b of document.querySelectorAll<HTMLElement>('.slot')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    selectWeapon(b.dataset.w as WeaponId);
  });
}
for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
  b.addEventListener('click', () => {
    audio.unlock();
    const m = b.dataset.mode;
    if (m === 'range' || m === 'match' || m === 'waves') start(m);
    else showMenu();
  });
}

function setAds(on: boolean) {
  if (current === 'grenade') on = false;
  ads = on;
  $('btn-ads').classList.toggle('on', ads);
}

function selectWeapon(id: WeaponId) {
  if (id === current) return;
  weapons[current].triggerUp(true);
  current = id;
  viewmodel.setWeapon(id);
  setAds(ads && id !== 'grenade');
  audio.play('reload');
}

function cycleWeapon(d: number) {
  const ids: WeaponId[] = ['rifle', 'bow', 'grenade'];
  selectWeapon(ids[(ids.indexOf(current) + d + ids.length) % ids.length]);
}

function reload() {
  const w = weapons[current];
  if (w.def.id === 'grenade' || w.reloading || w.ammo === w.def.magazine) return;
  w.startReload();
}

function trigger(down: boolean, cancel = false) {
  audio.unlock();
  if (!isPlaying() || !player.alive) return;
  const w = weapons[current];
  if (down && w.ammo === 0 && !w.reloading && current !== 'grenade') audio.play('empty');
  const shot = down ? w.triggerDown() : w.triggerUp(cancel);
  if (shot) launch(shot);
}

// ---------- Shooting ----------
const tmp = new THREE.Vector3();
function aimRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
  camera.updateMatrixWorld();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const origin = camera.position.clone().addScaledVector(dir, 0.3);
  return { origin, dir };
}

function spreadFor(shot: Shot): number {
  const w = shot.weapon;
  let s = w.spreadHip + (w.spreadAds - w.spreadHip) * adsAmount;
  if (w.id === 'bow') s *= 1.6 - shot.power * 0.6;
  return s * (1 + Math.min(1, player.speed / PLAYER_ARENA.run) * (1 - adsAmount * 0.7));
}

function launch(shot: Shot) {
  const { origin, dir } = aimRay();
  if (shot.weapon.id === 'grenade') {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    dir.applyAxisAngle(right, THROW_LIFT);
  }
  const s = spreadFor(shot);
  if (s > 0) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * s;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  projectiles.fire(shot, origin, dir, player, true);
  stats.shots += shot.weapon.id === 'grenade' ? 0 : 1;
  viewmodel.kick(shot.weapon.id === 'rifle' ? 0.5 : 1);
  const kick = shot.weapon.recoil * (1 - adsAmount * 0.4);
  player.pitch += kick;
  player.yaw += (Math.random() - 0.5) * kick * 0.6;
  audio.play(shot.weapon.id === 'rifle' ? 'rifle' : shot.weapon.id === 'bow' ? 'bow' : 'throw');
}

const botCtx: BotContext = {
  world,
  rand,
  get fighters() {
    return fighters();
  },
  fire: (shot, origin, dir, owner) => {
    projectiles.fire(shot, origin, dir, owner, false);
    audio.play('rifle', owner.position.distanceTo(player.pos));
  },
  spawnSpot: () => world.randomOpenSpot(rand, 1.5, 40),
};

// ---------- Hits ----------
const hitmarker = $('hitmarker');
let hitmarkerLeft = 0;
const floaters: Array<{ el: HTMLElement; p: THREE.Vector3; t: number }> = [];

function nameOf(h: Hittable | null): string {
  if (h === player) return '你';
  return board.get(h as Hittable)?.name ?? '?';
}

function feed(text: string, mine: boolean) {
  const el = document.createElement('div');
  el.textContent = text;
  if (mine) el.className = 'me';
  const box = $('feed');
  box.prepend(el);
  while (box.children.length > 4) box.lastElementChild!.remove();
  setTimeout(() => el.remove(), 4500);
}

function floater(p: THREE.Vector3, text: string, cls: string) {
  const el = document.createElement('div');
  el.className = `dmg ${cls}`;
  el.textContent = text;
  $('floaters').append(el);
  floaters.push({ el, p: p.clone(), t: 0 });
}

projectiles.onHit = (e: HitEvent) => {
  if (e.target instanceof Bot && e.owner) e.target.alert(e.owner.position);
  projectiles.puff(e.point, e.target instanceof Monster ? 0x7bd23a : e.target instanceof TargetDummy ? 0xd9c8a0 : 0xd8342c, 5, 2);
  if (e.byPlayer && e.target !== player) {
    if (e.weapon !== 'grenade') stats.hits += 1;
    if (e.zone === 'head') stats.heads += 1;
    hitmarker.className = e.killed ? 'kill' : e.zone === 'head' ? 'head' : '';
    hitmarkerLeft = 0.25;
    floater(e.point, `${e.damage}`, e.killed ? 'kill' : e.zone === 'head' ? 'head' : '');
    audio.play(e.killed ? 'kill' : e.zone === 'head' ? 'head' : 'hit');
  }
  if (e.target === player) playerHurt(e.owner && e.owner !== player ? e.owner.position : e.point);
  if (!e.killed) return;
  if (mode === 'range') {
    stats.kills += 1;
    return;
  }
  if (mode === 'waves') {
    if (e.target === player) playerDown();
    else if (e.target instanceof Monster && e.byPlayer) {
      const points = Math.round(e.target.def.score * (e.zone === 'head' ? 1.5 : 1));
      waves.score += points;
      stats.kills += 1;
      floater(e.point.clone().setY(e.point.y + 0.5), `+${points}`, 'score');
    }
    return;
  }
  const killer = e.owner;
  const victim = board.get(e.target);
  if (victim) victim.deaths += 1;
  if (killer && killer !== e.target) {
    const k = board.get(killer);
    if (k) k.kills += 1;
  }
  const how = e.weapon === 'grenade' ? '💥' : e.weapon === 'bow' ? '🏹' : e.zone === 'head' ? '🎯' : '🔫';
  feed(`${nameOf(killer)} ${how} ${nameOf(e.target)}`, killer === player || e.target === player);
  if (e.target === player) {
    killerName = killer === player ? '自己的手雷' : nameOf(killer);
    playerDown();
  }
};

function playerDown() {
  deadFor = 0;
  weapons[current].triggerUp(true);
  setAds(false);
}

// Red arcs around the crosshair point toward whoever hit the player.
const indicators: Array<{ el: HTMLElement; from: THREE.Vector3; t: number }> = [];
function playerHurt(from: THREE.Vector3) {
  $('vignette').style.opacity = '0.75';
  audio.play('hurt');
  const el = document.createElement('div');
  el.className = 'dir';
  $('dirs').append(el);
  indicators.push({ el, from: from.clone(), t: 0 });
}

function updateIndicators(dt: number) {
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  for (const ind of indicators) {
    ind.t += dt;
    const dx = ind.from.x - player.pos.x;
    const dz = ind.from.z - player.pos.z;
    const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    ind.el.style.transform = `rotate(${angle}rad)`;
    ind.el.style.opacity = `${Math.max(0, 1 - ind.t / 1.4)}`;
    if (ind.t > 1.4) ind.el.remove();
  }
  for (let i = indicators.length - 1; i >= 0; i--) if (indicators[i].t > 1.4) indicators.splice(i, 1);
}

// ---------- Monster waves ----------
const monsterCtx: MonsterContext = {
  world,
  player,
  rand,
  get monsters() {
    return monsters;
  },
  hurt: (amount, from) => {
    if (!player.alive) return;
    const killed = player.damage(amount);
    if (player.shield > 0) return;
    playerHurt(from);
    shake = Math.max(shake, 0.4);
    if (killed) playerDown();
  },
  spit: (shot, origin, dir, owner) => {
    projectiles.fire(shot, origin, dir, owner, false);
    audio.play('throw', owner.position.distanceTo(player.pos));
  },
};

function spawnMonster(kind: MonsterKind) {
  // Close enough to arrive soon, far enough to see them climb out of the ground.
  const ok = (p: THREE.Vector3) => {
    const d = p.distanceTo(player.pos);
    return d > 16 && d < 34;
  };
  let at = world.randomOpenSpot(rand, 1.5, 38);
  for (let i = 0; i < 25 && !ok(at); i++) at = world.randomOpenSpot(rand, 1.5, 38);
  const m = new Monster(kind, at);
  monsters.push(m);
  scene.add(m.model.root);
}

function updateWaves(dt: number) {
  for (const m of monsters) m.update(dt, monsterCtx);
  monsters = monsters.filter((m) => {
    if (m.removed) scene.remove(m.model.root);
    return !m.removed;
  });
  if (!player.alive) {
    deadFor += dt;
    $('banner').textContent = '你倒下了';
    if (deadFor > 2) endWaves();
    return;
  }
  if (waves.breakLeft > 0) {
    waves.breakLeft -= dt;
    const cleared = waves.wave > 0 && waves.breakLeft > WAVE_BREAK - 2;
    $('banner').textContent = cleared ? `第 ${waves.wave} 波完成！` : `第 ${waves.wave + 1} 波　${Math.ceil(waves.breakLeft)}`;
    if (waves.breakLeft <= 0) {
      waves.wave += 1;
      waves.queue = waveRoster(waves.wave);
      $('banner').textContent = '';
    }
    return;
  }
  waves.spawnCd -= dt;
  const alive = monsters.filter((m) => m.alive).length;
  if (waves.queue.length && waves.spawnCd <= 0 && alive < MAX_MONSTERS) {
    spawnMonster(waves.queue.shift()!);
    waves.spawnCd = Math.max(0.4, 1.3 - waves.wave * 0.1);
  }
  if (!waves.queue.length && alive === 0) waves.breakLeft = WAVE_BREAK;
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function endWaves() {
  const best = Math.max(readBest(), waves.score);
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // storage unavailable: the best score just isn't kept
  }
  showSummary('你倒下了', [
    ['撐到', `第 ${waves.wave} 波`],
    ['擊倒', `${stats.kills}`],
    ['分數', `${waves.score}`],
    ['最高分', `${best}`],
  ]);
}
projectiles.onImpact = (p) => audio.play('impact', p.distanceTo(player.pos));
projectiles.onBlast = (p) => {
  const d = p.distanceTo(player.pos);
  audio.play('blast', d);
  shake = Math.max(shake, Math.max(0, 1 - d / 25));
};

// ---------- Grenade arc preview ----------
const arcLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.3, gapSize: 0.2 }));
arcLine.frustumCulled = false;
const ring = new THREE.Mesh(
  new THREE.RingGeometry(WEAPONS.grenade.blastRadius * 0.92, WEAPONS.grenade.blastRadius, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.6, depthWrite: false }),
);
scene.add(arcLine, ring);

function updateArc() {
  const show = current === 'grenade' && weapons.grenade.aiming && weapons.grenade.ammo > 0 && player.alive;
  arcLine.visible = ring.visible = show;
  if (!show) return;
  const { origin, dir } = aimRay();
  dir.applyAxisAngle(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), THROW_LIFT);
  const v = dir.multiplyScalar(launchSpeed({ weapon: WEAPONS.grenade, power: 1 }));
  const pts = traceArc(
    { pos: { x: origin.x, y: origin.y, z: origin.z }, vel: { x: v.x, y: v.y, z: v.z }, time: 0 },
    WEAPONS.grenade.projectile,
    (a, b) => world.collide(a, b) !== null,
    3,
    4,
  ).map((p) => new THREE.Vector3(p.x, p.y, p.z));
  arcLine.geometry.dispose();
  arcLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.slice(1));
  arcLine.computeLineDistances();
  const end = pts[pts.length - 1];
  ring.position.set(end.x, world.height(end.x, end.z) + 0.05, end.z);
}

// ---------- Modes ----------
function clearMatch() {
  projectiles.clear();
  for (const d of dummies) scene.remove(d.model.root);
  for (const b of bots) scene.remove(b.model.root);
  for (const m of monsters) scene.remove(m.model.root);
  dummies = [];
  bots = [];
  monsters = [];
  for (const ind of indicators) ind.el.remove();
  indicators.length = 0;
  board.clear();
  $('feed').replaceChildren();
  $('floaters').replaceChildren();
  floaters.length = 0;
}

function resetWeapons() {
  for (const id of Object.keys(weapons) as WeaponId[]) weapons[id] = new WeaponState(WEAPONS[id]);
  current = 'rifle';
  viewmodel.setWeapon('rifle');
  setAds(false);
}

function start(m: PlayMode) {
  lastMode = m;
  clearMatch();
  resetWeapons();
  mode = m;
  Object.assign(stats, { shots: 0, hits: 0, heads: 0, kills: 0 });
  world.layout(m === 'range');
  document.body.classList.remove('in-menu');
  document.body.classList.toggle('range', m === 'range');
  deadFor = 0;
  $('menu').classList.remove('show');
  $('summary').classList.remove('show');
  $('banner').textContent = '';
  if (m === 'range') {
    player.spawn(spawnPoint, Math.PI);
    dummies = createRange(world, spawnPoint);
    for (const d of dummies) scene.add(d.model.root);
  } else if (m === 'waves') {
    Object.assign(waves, { wave: 0, queue: [], spawnCd: 0, breakLeft: 3, score: 0 });
    player.spawn(world.randomOpenSpot(rand, 2, 6), Math.PI);
  } else {
    timeLeft = MATCH_TIME;
    player.spawn(farthestSpot(), Math.PI);
    board.set(player, { name: '你', kills: 0, deaths: 0 });
    bots = BOT_LOOKS.map((l) => new Bot(l.name, l));
    for (const b of bots) {
      b.spawn(world.randomOpenSpot(rand, 1.5, 40));
      scene.add(b.model.root);
      board.set(b, { name: b.name, kills: 0, deaths: 0 });
    }
    // Spawn facing the middle of the arena.
    const c = world.at(0, 0);
    player.yaw = Math.atan2(-(c.x - player.pos.x), -(c.z - player.pos.z));
  }
}

function farthestSpot(): THREE.Vector3 {
  let best = world.randomOpenSpot(rand, 1.5, 45);
  let bestD = -1;
  for (let i = 0; i < 10; i++) {
    const p = world.randomOpenSpot(rand, 1.5, 45);
    const d = Math.min(...bots.filter((b) => b.alive).map((b) => b.position.distanceTo(p)), 999);
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function showMenu() {
  if (document.pointerLockElement) document.exitPointerLock();
  weapons[current].triggerUp(true);
  clearMatch();
  mode = 'menu';
  document.body.classList.add('in-menu');
  $('summary').classList.remove('show');
  $('menu').classList.add('show');
}

let lastMode: PlayMode = 'match';

function endMatch() {
  const rows = [...board.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);
  showSummary(
    '時間到',
    rows.map(([, r], i) => [`${i + 1}`, r.name, `擊倒 ${r.kills}`, `倒下 ${r.deaths}`]),
    rows.findIndex(([h]) => h === player),
  );
}

function showSummary(title: string, rows: string[][], highlight = -1) {
  mode = 'summary';
  if (document.pointerLockElement) document.exitPointerLock();
  weapons[current].triggerUp(true);
  document.body.classList.add('in-menu');
  $('summary-title').textContent = title;
  const table = $('ranking');
  table.replaceChildren(
    ...rows.map((cells, i) => {
      const tr = document.createElement('tr');
      if (i === highlight) tr.className = 'me';
      for (const c of cells) tr.insertCell().textContent = c;
      return tr;
    }),
  );
  $('btn-again').dataset.mode = lastMode;
  $('summary').classList.add('show');
}

// ---------- HUD ----------
const slotEls = [...document.querySelectorAll<HTMLElement>('.slot')];
function updateHud(dt: number) {
  const w = weapons[current];
  for (const el of slotEls) {
    const id = el.dataset.w as WeaponId;
    el.classList.toggle('on', id === current);
    el.querySelector('span')!.textContent = `${weapons[id].ammo}`;
  }
  const status = w.reloading ? '<small>換彈中…</small>' : current === 'bow' && w.aiming ? `<small>拉弓 ${Math.round(w.draw * 100)}%</small>` : '';
  $('ammo').innerHTML = `${w.ammo}<span style="opacity:.6;font-size:14px"> / ${w.def.magazine}</span>${status}`;
  $('hp-fill').style.width = `${Math.max(0, player.hp)}%`;
  $('hp-fill').style.background = player.hp > 50 ? '#6be06b' : player.hp > 25 ? '#f0c03a' : '#ee4b3b';
  $('hp-text').textContent = `${Math.max(0, Math.ceil(player.hp))}`;
  if (mode === 'match') {
    const me = board.get(player)!;
    $('score').textContent = `擊倒 ${me.kills}　倒下 ${me.deaths}`;
    const t = Math.max(0, Math.ceil(timeLeft));
    $('timer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  } else if (mode === 'waves') {
    $('score').textContent = `分數 ${waves.score}　擊倒 ${stats.kills}`;
    $('timer').textContent = waves.wave ? `第 ${waves.wave} 波` : '';
  } else if (mode === 'range') {
    const acc = stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0;
    $('score').textContent = `命中 ${stats.hits}/${stats.shots}（${acc}%）　爆頭 ${stats.heads}　擊倒 ${stats.kills}`;
  }
  // Crosshair gap follows the current spread; the rifle's red dot replaces it when aiming.
  const spread = spreadFor({ weapon: w.def, power: current === 'bow' ? Math.max(w.draw, 0.2) : 1 });
  const gap = 4 + (Math.tan(spread) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (app.clientHeight / 2);
  const ch = $('crosshair');
  ch.style.display = (current === 'rifle' && adsAmount > 0.6) || (current === 'grenade' && w.aiming) || !player.alive ? 'none' : '';
  const set = (cls: string, x: number, y: number) => ((ch.querySelector(`.${cls}`) as HTMLElement).style.transform = `translate(${x}px, ${y}px)`);
  set('t', 0, -gap - 9);
  set('b', 0, gap);
  set('l', -gap - 9, 0);
  set('r', gap, 0);
  hitmarkerLeft -= dt;
  hitmarker.style.opacity = hitmarkerLeft > 0 ? '1' : '0';
  const v = $('vignette');
  const low = player.alive ? Math.max(0, 0.45 - player.hp / 100) : 0.8;
  v.style.opacity = `${Math.max(low, Number(v.style.opacity || 0) - dt * 2)}`;
  for (const f of floaters) {
    f.t += dt;
    const p = tmp.copy(f.p).setY(f.p.y + f.t * 0.8).project(camera);
    f.el.style.left = `${((p.x + 1) / 2) * app.clientWidth}px`;
    f.el.style.top = `${((1 - p.y) / 2) * app.clientHeight}px`;
    f.el.style.opacity = `${p.z < 1 ? Math.max(0, 1 - f.t / 0.9) : 0}`;
    if (f.t > 0.9) f.el.remove();
  }
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t > 0.9) floaters.splice(i, 1);
}

// ---------- Loop ----------
function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let wasReloading = false;
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const playing = isPlaying();
  const f = input.sample();
  f.lookYaw += extraYaw;
  f.lookPitch += extraPitch;
  extraYaw = extraPitch = 0;

  if (playing) {
    const w = weapons[current];
    adsAmount += ((ads ? 1 : 0) - adsAmount) * Math.min(1, dt * 14);
    const zoom = 1 + (w.def.adsZoom - 1) * adsAmount;
    player.update(dt, f, ads, 1 / zoom ** LOOK.scopedLookExponent);
    for (const id of Object.keys(weapons) as WeaponId[]) {
      const shots = weapons[id].update(dt);
      if (id === current && player.alive) for (const s of shots) launch(s);
    }
    if (w.reloading && !wasReloading) audio.play('reload');
    wasReloading = w.reloading;
    for (const d of dummies) d.update(dt);
    for (const b of bots) b.update(dt, botCtx);
    if (mode === 'waves') updateWaves(dt);
    player.eye(camera.position);
    projectiles.update(dt, camera.position);

    if (mode === 'match') {
      timeLeft -= dt;
      if (!player.alive) {
        deadFor += dt;
        const left = Math.ceil(PLAYER_RESPAWN - deadFor);
        $('banner').textContent = `被 ${killerName} 擊倒　${left > 0 ? left : ''}`;
        if (deadFor > PLAYER_RESPAWN) {
          player.spawn(farthestSpot(), player.yaw);
          $('banner').textContent = '';
        }
      }
      if (timeLeft <= 0) endMatch();
    }

    camera.fov = BASE_FOV / zoom;
    camera.updateProjectionMatrix();
    player.eye(camera.position);
    if (!player.alive) camera.position.y -= Math.min(1, deadFor * 2) * 1.1;
    shake *= Math.exp(-dt * 6);
    camera.rotation.set(player.pitch + (Math.random() - 0.5) * shake * 0.05, player.yaw + (Math.random() - 0.5) * shake * 0.05, 0);
    viewmodel.group.visible = player.alive;
    viewmodel.update(dt, { ads: ads && player.alive, draw: w.draw, aiming: w.aiming, speed: player.speed, loaded: w.ammo > 0, reloading: w.reloading });
    document.body.classList.toggle('ads-red', current === 'rifle' && adsAmount > 0.6);
    updateArc();
    updateHud(dt);
    updateIndicators(dt);
  } else {
    // Menu backdrop: slow orbit over the arena.
    const a = now / 9000;
    const c = world.at(0, 0);
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
    camera.position.set(c.x + Math.sin(a) * 45, c.y + 18, c.z + Math.cos(a) * 45);
    camera.lookAt(c.x, c.y, c.z);
    viewmodel.group.visible = false;
    arcLine.visible = ring.visible = false;
  }
  renderer.render(scene, camera);
}

// Test hook for automated runs.
(window as unknown as { arena: unknown }).arena = {
  start,
  player,
  weapons,
  trigger,
  selectWeapon,
  setAds,
  bots: () => bots,
  dummies: () => dummies,
  monsters: () => monsters,
  waves,
  stats,
  STEP,
};

showMenu();
requestAnimationFrame(frame);
