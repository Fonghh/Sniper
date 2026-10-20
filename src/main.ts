import * as THREE from 'three';
import { LOOK, PLAYER } from './game/config';
import { STRINGS } from './i18n';
import { Input } from './input/input';

// P0 skeleton: flat placeholder world, first-person camera and unified input.
// Terrain (P2), player systems (P3) and animals (P4+) replace the placeholders.

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const input = new Input(canvas, document.getElementById('joystick-knob')!);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3d8);
scene.fog = new THREE.Fog(0x9fc3d8, 200, 900);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
camera.rotation.order = 'YXZ';
camera.position.set(0, PLAYER.eyeHeightStand, 0);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a2a, 1.2));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.position.set(200, 300, 100);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x6f8f3e }),
);
scene.add(ground);

// Distance posts every 100 m downrange (-z is "forward" for the camera) for a sense of scale.
const postMat = new THREE.MeshLambertMaterial({ color: 0xd9a441 });
for (let d = 100; d <= 400; d += 100) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2, 0.6), postMat);
  post.position.set(0, 1, -d);
  scene.add(post);
}
const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8a80, flatShading: true });
for (let i = 0; i < 60; i++) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random() * 2), rockMat);
  rock.position.set((Math.random() - 0.5) * 600, 0.3, (Math.random() - 0.5) * 600);
  scene.add(rock);
}

let yaw = 0;
let pitch = 0;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const f = input.sample();

  yaw += f.lookYaw;
  pitch = THREE.MathUtils.clamp(pitch + f.lookPitch, -LOOK.maxPitch, LOOK.maxPitch);
  camera.rotation.set(pitch, yaw, 0);

  const speed = f.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const move = fwd.multiplyScalar(f.moveY).add(right.multiplyScalar(f.moveX));
  const actual = move.length() * speed;
  camera.position.addScaledVector(move, speed * dt);

  hud.textContent = `${input.isTouch ? STRINGS.hintTouch : STRINGS.hintDesktop} · ${STRINGS.speed(actual)}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
