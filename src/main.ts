import { campaigns, getCampaign, getMission, validateContent } from './content';
import { checkpointIntersectsWorld, createSim, distance2D, estimateLandingFuel, getObjectiveAction, stepSim } from './sim';
import { createScene } from './render';
import { createUI } from './ui';
import { clearCheckpoint, loadCheckpoint, saveCheckpoint, writeProgress } from './persistence';
import { GameAudio } from './audio';
import { MissionRadioDirector } from './missionRadio';
import type { MusicTrackId } from './music';
import type { Campaign, CampaignId, FlightCommand, Mission, SimState } from './types';
import { WORLD_REVISION } from './worldRevision';
import { createKeyboardResponse } from './keyboardResponse';
import './style.css';
import './ui/menu.css';
import './ui/flightRefinement.css';

const root = document.getElementById('app');
if (!root) throw new Error('Application root missing');
const contentErrors = validateContent();
if (contentErrors.length) throw new Error(`Scenario data invalid: ${contentErrors.join('; ')}`);

const emptyCommand = (): FlightCommand => ({ yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0, drop: false, fetch: false, faceObjective: false, returnHome: false, action: false });
let command = emptyCommand();
const keys = new Set<string>();
const keyboardResponse = createKeyboardResponse();
let state: SimState | null = null;
let campaign: Campaign | null = null;
let mission: Mission | null = null;
let scene: ReturnType<typeof createScene> | null = null;
let paused = true;
let mapOpen = false;
let accumulator = 0;
let lastFrame = performance.now();
let lastSaveTime = 0;
let lastPhase = '';
let saving = Promise.resolve();
const audio = new GameAudio();
const radio = new MissionRadioDirector(({ id, priority }) => audio.playVoiceCue(id, priority));
let voicePaused = false;
let radioReminderOnResume = false;

function syncVoicePause() {
  const next = paused && state?.outcome === 'none';
  if (next !== voicePaused) {
    audio.setVoicePaused(next);
    voicePaused = next;
  }
}

const ui = createUI(root, {
  onSelect: (campaignId, missionId) => { audio.setMusicTrack(missionId as MusicTrackId); audio.unlock(); return selectMission(campaignId, missionId).catch(error => { audio.setMusicTrack('menu'); throw error; }); },
  onCommand: name => { audio.unlock(); void act(name); },
  onControls: partial => { command = { ...command, ...partial }; },
  onMusicToggle: enabled => audio.setMusicEnabled(enabled),
  onVoiceToggle: enabled => {
    audio.setVoiceEnabled(enabled);
    if (!enabled) radioReminderOnResume = false;
    if (enabled && state && campaign && mission && state.outcome === 'none') {
      if (paused) radioReminderOnResume = true;
      else radio.reset(state, campaign, mission);
    }
  },
}, campaigns, audio.isMusicEnabled(), audio.isVoiceEnabled());

root.addEventListener('click', event => {
  if (event.target instanceof Element && event.target.closest('[data-music-toggle]')) return;
  audio.unlock();
}, { once: true, capture: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });

function queueSave() {
  if (!state) return;
  const snapshot = structuredClone(state);
  saving = saving.catch(() => undefined).then(() => saveCheckpoint(snapshot));
}

function clearInput() {
  command = emptyCommand();
  keys.clear();
  keyboardResponse.reset();
}

async function selectMission(campaignId: CampaignId, missionId: string) {
  queueSave();
  const nextCampaign = getCampaign(campaignId);
  const nextMission = getMission(campaignId, missionId);
  if (!nextCampaign || !nextMission) return;
  await saving.catch(() => undefined);
  const saved = await loadCheckpoint(campaignId);
  let nextState = saved?.missionId === missionId && saved.phase !== 'debrief' && saved.phase !== 'failed'
    ? saved : createSim(nextCampaign, nextMission);
  const sceneHost = ui.getSceneHost();
  const previousSceneNodes = new Set(sceneHost.childNodes);
  let nextScene: ReturnType<typeof createScene>;
  try {
    nextScene = createScene(sceneHost, { externalClock: true });
  } catch (error) {
    for (const node of Array.from(sceneHost.childNodes)) {
      if (!previousSceneNodes.has(node)) node.remove();
    }
    throw error;
  }
  scene?.dispose();
  scene = nextScene;
  if (nextState === saved && saved?.worldRevision !== WORLD_REVISION) {
    // Scene construction registers the exact terrain and solid scenery for the
    // mission before the legacy save is checked. Only an obstructed sortie is
    // restarted; completed campaign progress is stored separately.
    nextScene.update(nextState, nextCampaign, nextMission);
    if (checkpointIntersectsWorld(nextState, nextCampaign, nextMission)) {
      nextState = createSim(nextCampaign, nextMission);
      nextState.message = 'Map updated: this saved sortie restarted at the launch point.';
      nextState.messageUntil = 8;
    } else {
      nextState.worldRevision = WORLD_REVISION;
    }
  }
  campaign = nextCampaign;
  mission = nextMission;
  state = nextState;
  clearInput();
  paused = false;
  mapOpen = false;
  accumulator = 0;
  lastFrame = performance.now();
  lastPhase = state.phase;
  audio.setVoiceMission(campaign.id);
  syncVoicePause();
  radio.reset(state, campaign, mission);
  radioReminderOnResume = false;
  ui.showGame(state, campaign, mission, estimateLandingFuel(state, campaign, mission));
  ui.setPaused(false);
}

async function act(name: string) {
  if (name === 'menu') {
    radio.clear();
    radioReminderOnResume = false;
    audio.setVoiceMission(null);
    audio.setMusicTrack('menu');
    audio.update(null, false);
    queueSave();
    await saving.catch(() => undefined);
    paused = true;
    clearInput();
    scene?.dispose(); scene = null;
    state = null; campaign = null; mission = null;
    syncVoicePause();
    ui.showMenu();
    return;
  }
  if (!state || !campaign || !mission) return;
  if (name === 'restart') {
    await saving.catch(() => undefined);
    await clearCheckpoint(campaign.id);
    state = createSim(campaign, mission);
    paused = false; mapOpen = false; clearInput(); accumulator = 0;
    audio.setVoiceMission(campaign.id);
    syncVoicePause();
    radio.reset(state, campaign, mission);
    radioReminderOnResume = false;
    ui.setPaused(false);
    return;
  }
  if (name === 'map') { mapOpen = !mapOpen; paused = mapOpen; clearInput(); syncVoicePause(); return; }
  if (name === 'togglePause' || name === 'resume') {
    paused = name === 'resume' ? false : !paused;
    mapOpen = false;
    clearInput();
    syncVoicePause();
    if (!paused && radioReminderOnResume) { radio.reset(state, campaign, mission); radioReminderOnResume = false; }
    ui.setPaused(paused);
    if (paused) queueSave();
    return;
  }
  if (paused) return;
  if (name === 'drop') command.drop = true;
  if (name === 'fetch') command.fetch = true;
  if (name === 'action') command.action = true;
  if (name === 'return') command.returnHome = true;
}

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (!state || state.phase === 'debrief' || state.phase === 'failed') return;
  if (key === 'escape') {
    event.preventDefault();
    void act(mapOpen ? 'map' : 'togglePause');
    return;
  }
  if (paused || mapOpen || (event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="group"]'))) return;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key)) event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  if (key === ' ') void act('drop');
  if (key === 'e' && campaign && mission) {
    const opportunity = getObjectiveAction(state, campaign, mission);
    if (opportunity === 'fetch') void act('fetch');
    else if (opportunity === 'release') void act('drop');
    else if (opportunity) void act('action');
  }
  if (key === 'r') void act('return');
  if (key === 'm') void act('map');
});
window.addEventListener('keyup', event => {
  const key = event.key.toLowerCase();
  keys.delete(key);
  keyboardResponse.releaseKey(key);
});
window.addEventListener('blur', clearInput);
document.addEventListener('focusin', event => {
  if (event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="group"]')) {
    keys.clear();
    keyboardResponse.reset();
  }
});

function keyboardCommand(): FlightCommand {
  const keyboard = keyboardResponse.sample(keys, 1 / 60);
  return {
    ...command,
    yaw: Math.max(-1, Math.min(1, command.yaw + keyboard.yaw)),
    climb: Math.max(-1, Math.min(1, command.climb + keyboard.climb)),
    cyclicX: Math.max(-1, Math.min(1, command.cyclicX + keyboard.cyclicX)),
    cyclicY: Math.max(-1, Math.min(1, command.cyclicY + keyboard.cyclicY)),
  };
}

function frame(now: number) {
  const elapsed = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (document.hidden) { requestAnimationFrame(frame); return; }
  if (state && campaign && mission) {
    if (!paused && state.phase !== 'debrief' && state.phase !== 'failed') {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= 1 / 60 && steps < 8) {
        const cmd = keyboardCommand();
        state = stepSim(state, cmd, campaign, mission);
        radio.update(state, campaign, mission);
        command.drop = false; command.fetch = false; command.faceObjective = false;
        command.action = false; command.returnHome = false;
        accumulator -= 1 / 60;
        steps++;
      }
      if (steps === 8 && accumulator > 0.2) accumulator = 0.2;
      if (state.phase !== lastPhase || now - lastSaveTime > 15000) {
        queueSave();
        lastPhase = state.phase;
        lastSaveTime = now;
      }
      if (state.outcome !== 'none') writeProgress(state);
    }
    scene?.update(state, campaign, mission);
    if (scene?.renderScheduledFrame(now, paused)) ui.showGame(state, campaign, mission, estimateLandingFuel(state, campaign, mission));
    if (state.phase === 'debrief' || state.phase === 'failed') paused = true;
    syncVoicePause();
    if (mapOpen) {
      const d = distance2D(state.position, { ...mission.fire, y: 0 });
      root?.setAttribute('data-map-distance', `${Math.round(d)} m`);
    }
  }
  audio.update(state, paused, mission);
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state) { paused = true; mapOpen = false; clearInput(); syncVoicePause(); ui.setPaused(true); queueSave(); }
  audio.update(state, paused, mission);
});
window.addEventListener('pagehide', () => { if (state) queueSave(); });
window.addEventListener('orientationchange', clearInput);
root.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  paused = true;
  clearInput();
  syncVoicePause();
  ui.setPaused(true);
  queueSave();
});
root.addEventListener('webglcontextrestored', () => {
  if (state && campaign && mission) {
    scene?.dispose();
    scene = createScene(ui.getSceneHost(), { externalClock: true });
    paused = true;
    ui.setPaused(true);
  }
});
ui.showMenu();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
