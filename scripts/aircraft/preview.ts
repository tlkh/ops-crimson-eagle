import * as THREE from 'three';
import { campaigns } from '../../src/content';
import { createAircraft } from '../../src/render/aircraft';
import { updateAircraftLightEmission } from '../../src/render/aircraftLighting';

// An isolated, deterministic inspection fixture; never imported by the game.
if (!import.meta.env.DEV) throw new Error('Aircraft inspection is development-only');

const params = new URLSearchParams(location.search);
const host = document.querySelector<HTMLElement>('#scene')!;
const metrics = document.querySelector<HTMLOutputElement>('#metrics')!;
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const campaignSelect = select('campaign'), viewSelect = select('view');
const lightSelect = select('light'), rotorSelect = select('rotors');
for (const element of [campaignSelect, viewSelect, lightSelect, rotorSelect]) {
  if (params.has(element.id)) element.value = params.get(element.id)!;
}
const scene = new THREE.Scene();
const ambient = new THREE.HemisphereLight('#eaf2ed', '#394840', 2.4);
const sun = new THREE.DirectionalLight('#fff3e3', 3);
sun.position.set(-12, 15, -8);
scene.add(ambient, sun);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;
host.prepend(renderer.domElement);
let model: ReturnType<typeof createAircraft>;
let paused = true, simulationTime = .3, prior = performance.now(), frameId = 0;

function disposeModel() {
  if (!model) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  model.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  model.root.removeFromParent();
  geometries.forEach(item => item.dispose());
  materials.forEach(item => item.dispose());
  textures.forEach(item => { if (!item.userData.sharedAsset) item.dispose(); });
}
function rebuild() {
  disposeModel();
  model = createAircraft(campaigns[campaignSelect.value === 'jp' ? 1 : 0]);
  scene.add(model.root);
}
type View = { position: [number, number, number]; height: number; target?: [number, number, number] };
const views: Record<string, View> = {
  port: { position: [-30, .6, 0], height: 9 },
  starboard: { position: [30, .6, 0], height: 9 },
  front: { position: [0, .7, -30], height: 8 },
  rear: { position: [0, .7, 30], height: 8 },
  top: { position: [0, 35, .01], height: 34 },
  'front-quarter': { position: [14, 5, -22], height: 12 },
  'rear-quarter': { position: [14, 8, 25], height: 14 },
  // Approximate the supplied low rear-quarter photo; orthographic for a
  // repeatable proportion check, not a recovered photographic camera.
  'rear-photo': { position: [-12, 2.7, 30], height: 8, target: [0, .65, 1.5] },
  'rear-detail': { position: [0, 1.6, 22], height: 4.8, target: [0, .1, 7] },
  underside: { position: [10, -16, 20], height: 12 },
  gear: { position: [8, -3.7, 18], height: 5.8, target: [0, -1.2, 4.9] },
};
const sheet = ['port', 'front', 'starboard', 'rear', 'top', 'rear-quarter'];
function draw() {
  const width = host.clientWidth, height = host.clientHeight;
  if (renderer.domElement.width !== width || renderer.domElement.height !== height) renderer.setSize(width, height, false);
  const night = lightSelect.value === 'night' ? 1 : lightSelect.value === 'dusk' ? .55 : 0;
  scene.background = new THREE.Color().lerpColors(new THREE.Color('#a5afb0'), new THREE.Color('#111b26'), night);
  ambient.intensity = 2.4 * (1 - night) + .15;
  sun.intensity = 3 * (1 - night);
  updateAircraftLightEmission(model.lightMounts, night, simulationTime);
  model.rotors.forEach((rotor, i) => {
    const rotating = rotorSelect.value !== 'stopped';
    rotor.rotation.y = (i ? Math.PI / 3 : 0) + simulationTime * (rotorSelect.value === 'flight' ? 52 : rotating ? 4 : 0) * Number(rotor.userData.spin);
    const disc = rotor.userData.disc as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    disc.visible = rotating;
    disc.material.opacity = rotorSelect.value === 'flight' ? .64 : .25;
  });
  host.querySelectorAll('.view-label').forEach(label => label.remove());
  const names = viewSelect.value === 'sheet' ? sheet : [viewSelect.value];
  const cols = names.length > 1 ? 2 : 1, rows = names.length > 1 ? 3 : 1;
  renderer.info.reset();
  renderer.setScissorTest(true);
  for (const [i, name] of names.entries()) {
    const view = views[name] ?? views['rear-quarter'];
    const w = Math.floor(width / cols), h = Math.floor(height / rows);
    const x = (i % cols) * w, y = height - (Math.floor(i / cols) + 1) * h;
    const viewHeight = Math.max(view.height, name === 'port' || name === 'starboard' ? 21 * h / w : 0);
    const camera = new THREE.OrthographicCamera(-viewHeight * w / h / 2, viewHeight * w / h / 2, viewHeight / 2, -viewHeight / 2, .1, 100);
    camera.position.set(...view.position);
    camera.lookAt(...(view.target ?? [0, .5, 0]));
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    renderer.render(scene, camera);
    const label = document.createElement('span'); label.className = 'view-label';
    label.textContent = name.toUpperCase(); label.style.left = `${x}px`; label.style.top = `${height - y - h}px`;
    host.append(label);
  }
  metrics.value = `${campaignSelect.selectedOptions[0].textContent} · ${lightSelect.value} · ${paused ? 'paused' : 'running'} ${simulationTime.toFixed(2)} s\n${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles across ${names.length} view(s)\n${renderer.info.memory.geometries} geometries · ${renderer.info.memory.textures} textures`;
}
campaignSelect.addEventListener('change', () => { rebuild(); draw(); });
for (const input of [viewSelect, lightSelect, rotorSelect]) input.addEventListener('change', draw);
document.querySelector('#pause')!.addEventListener('click', event => {
  paused = !paused; (event.target as HTMLButtonElement).textContent = paused ? 'Resume' : 'Pause'; draw();
});
const resizeObserver = new ResizeObserver(draw); resizeObserver.observe(host);
rebuild(); draw();
function frame(now: number) {
  const delta = Math.min(.1, Math.max(0, (now - prior) / 1000)); prior = now;
  if (!paused) { simulationTime += delta; draw(); }
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frameId); resizeObserver.disconnect(); disposeModel(); renderer.dispose(); renderer.forceContextLoss();
});
