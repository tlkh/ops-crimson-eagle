import { createScene } from '../../src/render';
import { campaigns } from '../../src/content';
import { createSim } from '../../src/sim';
import type { ExtendedSimState } from '../../src/sim/types';
import type { GraphicsMode } from '../../src/render/quality';

// Development-only fixed visual fixtures, never imported by the shipping game.
if (!import.meta.env.DEV) throw new Error('Graphics verification is development-only');
const params = new URLSearchParams(location.search);
const campaignSelect = document.querySelector<HTMLSelectElement>('#campaign')!;
const viewSelect = document.querySelector<HTMLSelectElement>('#view')!;
const qualitySelect = document.querySelector<HTMLSelectElement>('#quality')!;
const missionLabel = document.createElement('label');
missionLabel.textContent = 'Mission ';
const missionSelect = document.createElement('select');
missionSelect.id = 'mission';
for (let i = 0; i < 6; i++) missionSelect.add(new Option(String(i + 1), String(i)));
missionLabel.append(missionSelect);
const stageLabel = document.createElement('label');
stageLabel.textContent = 'Fire state ';
const stageSelect = document.createElement('select');
stageSelect.id = 'stage';
for (const value of ['burning', 'surface_suppressed', 'secured']) stageSelect.add(new Option(value, value));
stageLabel.append(stageSelect);
document.querySelector('header')!.append(missionLabel, stageLabel);
viewSelect.add(new Option('burn-trail', 'burn-trail'));
campaignSelect.value = params.get('campaign') === 'jp' ? 'jp' : 'sg';
viewSelect.value = params.get('view') ?? 'deck';
qualitySelect.value = params.get('quality') ?? 'high';
missionSelect.value = params.get('mission') ?? (viewSelect.value === 'night' ? '5' : '0');
stageSelect.value = params.get('stage') ?? 'burning';
let scene: ReturnType<typeof createScene>;
let campaign = campaigns[0], mission = campaign.missions[0];
let state: ExtendedSimState;
let paused = false;
let frameCount = 0;
let lastMetrics = 0;
const host = document.querySelector<HTMLElement>('#scene')!;
const output = document.querySelector<HTMLOutputElement>('#metrics')!;

function rebuild() {
  scene?.dispose();
  campaign = campaigns[campaignSelect.value === 'jp' ? 1 : 0];
  mission = campaign.missions[Number(missionSelect.value) || 0];
  state = createSim(campaign, mission) as ExtendedSimState;
  state.timeSec = viewSelect.value === 'night' ? 35 : Number(params.get('time') ?? 180);
  state.heading = Math.PI;
  applyFireState();
  if (viewSelect.value !== 'deck' && viewSelect.value !== 'night') {
    const nearFire = viewSelect.value === 'fire' || viewSelect.value === 'burn-trail';
    const point = nearFire ? mission.fire : mission.lake;
    state.phase = 'work'; state.bucketAttached = true;
    state.position = { x: point.x, y: viewSelect.value === 'forest' ? 160 : 44, z: point.z - 45 };
    state.waterLitres = nearFire ? 4000 : 0;
    if (viewSelect.value === 'forest') state.position.x += 500;
    if (viewSelect.value === 'burn-trail') {
      const windLength = Math.hypot(mission.wind.x, mission.wind.z) || 1;
      const wx = mission.wind.x / windLength, wz = mission.wind.z / windLength;
      state.position = { x: mission.fire.x - wx * mission.fire.radius * 2.4, y: 110, z: mission.fire.z - wz * mission.fire.radius * 2.4 };
      state.heading = Math.atan2(-wx, -wz);
    }
    state.bucket = { x: state.position.x, y: state.position.y - 24, z: state.position.z - 1 };
  }
  scene = createScene(host, { externalClock: true, quality: qualitySelect.value as GraphicsMode });
  scene.update(state, campaign, mission);
  frameCount = 0;
}
function applyFireState() {
  state.fireState = stageSelect.value as ExtendedSimState['fireState'];
  state.fireHeat = state.fireState === 'burning' ? 100 : state.fireState === 'secured' ? 2 : 12;
  state.peatHeat = state.fireState === 'burning' ? (mission.peat ? 100 : 0) : state.fireState === 'secured' ? 0 : (mission.peat ? 24 : 0);
  state.crewProgress = state.fireState === 'secured' ? 16 : 0;
  state.objectiveSaved = state.fireState === 'secured';
}
document.querySelector('#switch')!.addEventListener('click', rebuild);
for (const select of [campaignSelect, viewSelect, missionSelect]) select.addEventListener('change', rebuild);
stageSelect.addEventListener('change', applyFireState);
qualitySelect.addEventListener('change', () => scene.setQuality(qualitySelect.value as GraphicsMode));
document.querySelector('#pause')!.addEventListener('click', event => {
  paused = !paused; (event.target as HTMLButtonElement).textContent = paused ? 'Resume' : 'Pause';
});
document.querySelector('#capture')!.addEventListener('click', () => {
  // Capture in the same task as drawing; no persistent WebGL drawing buffer.
  scene.renderFrame(0);
  const canvas = host.querySelector('canvas')!;
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crimson-eagle-${mission.id}-${viewSelect.value}-${stageSelect.value}.jpg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/jpeg', .94);
});
rebuild();
let prior = performance.now();
function frame(now: number) {
  const delta = Math.max(0, Math.min(.1, (now - prior) / 1000)); prior = now;
  if (!paused) { state.timeSec += delta; state.tick++; }
  scene.update(state, campaign, mission);
  if (scene.renderScheduledFrame(now, paused)) frameCount++;
  if (now - lastMetrics > 1000) {
    const d = scene.diagnostics();
    output.value = `${mission.id} · ${viewSelect.value} · ${qualitySelect.value} · ${state.fireState}\n${d.width} × ${d.height} · target ${d.targetFps} FPS · level ${d.qualityLevel}\nCPU ${d.cpuSubmissionMs.toFixed(1)} ms · GPU ${d.gpuMs?.toFixed(1) ?? 'unavailable'} ms\nFrame interval p50/p95 ${d.frameIntervalP50Ms.toFixed(1)} / ${d.frameIntervalP95Ms.toFixed(1)} ms\n${d.calls} draws · ${d.triangles.toLocaleString()} triangles\n${d.textures} textures · ${d.geometries} geometries · scene ${(d.estimatedSceneBytes/1048576).toFixed(1)} MiB + post ${(d.renderTargetBytes/1048576).toFixed(1)} MiB\nDamaged trees ${d.burnedTrees} · bare ${d.charredTrees} · branch tris ${d.damageTriangles}\nRendered ${frameCount} · simulation ${state.timeSec.toFixed(1)} s`;
    lastMetrics = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => scene.dispose());
