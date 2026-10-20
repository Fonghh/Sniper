import * as THREE from 'three';
import { LOOK, PLAYER } from './game/config';
import { STRINGS } from './i18n';
import { Input } from './input/input';
import { HALF_MAP, Terrain } from './world/terrain';
import { createTerrainObject } from './world/terrainMesh';
import { createVegetation, windUniforms } from './world/vegetation';
import { Wind } from './world/wind';

// P2: procedural valley terrain, vegetation and wind. Player systems (P3) come next.

const SEED = 1234;
const MOVE_LIMIT = HALF_MAP - 70;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const info = document.getElementById('info')!;
const hint = document.getElementById('hint')!;
const windArrow = document.getElementById('wind-arrow')!;
const windText = document.getElementById('wind-text')!;
const input = new Input(canvas, document.getElementById('joystick-knob')!);
hint.textContent = input.isTouch ? STRINGS.hintTouch : STRINGS.hintDesktop;

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
scene.add(createVegetation(terrain));

const spawn = terrain.spawnPoint();
const pos = new THREE.Vector3(spawn.x, 0, spawn.z);
let yaw = spawn.yaw;
let pitch = spawn.pitch; // looking down at the opening herd's meadow

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let elapsed = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;
  const f = input.sample();

  yaw += f.lookYaw;
  pitch = THREE.MathUtils.clamp(pitch + f.lookPitch, -LOOK.maxPitch, LOOK.maxPitch);
  camera.rotation.set(pitch, yaw, 0);

  const speed = f.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = fwd.multiplyScalar(f.moveY).add(right.multiplyScalar(f.moveX));
  pos.addScaledVector(move, speed * dt);
  pos.x = THREE.MathUtils.clamp(pos.x, -MOVE_LIMIT, MOVE_LIMIT);
  pos.z = THREE.MathUtils.clamp(pos.z, -MOVE_LIMIT, MOVE_LIMIT);
  const ground = terrain.height(pos.x, pos.z);
  camera.position.set(pos.x, ground + PLAYER.eyeHeightStand, pos.z);

  // Wind: drives vegetation sway and the HUD arrow (shown relative to the view direction).
  const valleyFloor = terrain.height(terrain.riverX(pos.z), pos.z);
  const w = wind.at(elapsed, ground - valleyFloor);
  windUniforms.uTime.value = elapsed;
  windUniforms.uWind.value.set(w.x, w.z);
  const windHeading = Math.atan2(-w.x, -w.z); // Three.js yaw the wind blows toward
  windArrow.style.transform = `rotate(${yaw - windHeading}rad)`;
  windText.textContent = STRINGS.wind(Math.hypot(w.x, w.z));
  info.textContent = `${STRINGS.altitude(ground)} · ${STRINGS.speed(move.length() * speed)}`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
