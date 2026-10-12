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
import { clearRelocatedObjectiveActions } from './sim/checkpoint';
import { createKeyboardResponse } from './keyboardResponse';
import { isResumableCheckpoint } from './checkpointSelection';
import { flightOverlayShortcut, nextFlightOverlay, type FlightOverlay } from './ui/flightOverlay';
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
let flightOverlay: FlightOverlay = 'pause';
const isPaused = () => flightOverlay !== 'flight';
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
  const next = isPaused() && state?.outcome === 'none';
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
      if (isPaused()) radioReminderOnResume = true;
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

function setFlightOverlay(next: FlightOverlay) {
  clearInput();
  if (flightOverlay === next) return;
  const wasPaused = isPaused();
  flightOverlay = next;
  accumulator = 0;
  lastFrame = performance.now();
  syncVoicePause();
  ui.setFlightOverlay(next);
  if (wasPaused && !isPaused() && radioReminderOnResume && state && campaign && mission) {
    radio.reset(state, campaign, mission);
    radioReminderOnResume = false;
  }
  if (!wasPaused && isPaused()) queueSave();
}

async function selectMission(campaignId: CampaignId, missionId: string) {
  queueSave();
  const nextCampaign = getCampaign(campaignId);
  const nextMission = getMission(campaignId, missionId);
  if (!nextCampaign || !nextMission) return;
  await saving.catch(() => undefined);
  const saved = await loadCheckpoint(campaignId);
  let nextState = isResumableCheckpoint(saved, campaignId, missionId)
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
    clearRelocatedObjectiveActions(nextState, nextMission);
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
  accumulator = 0;
  lastFrame = performance.now();
  lastPhase = state.phase;
  audio.setVoiceMission(campaign.id);
  syncVoicePause();
  radio.reset(state, campaign, mission);
  radioReminderOnResume = false;
  ui.showGame(state, campaign, mission, estimateLandingFuel(state, campaign, mission));
  setFlightOverlay('flight');
}

async function act(name: string) {
  if (name === 'menu') {
    setFlightOverlay('pause');
    radio.clear();
    radioReminderOnResume = false;
    audio.setVoiceMission(null);
    audio.setMusicTrack('menu');
    audio.update(null, false);
    queueSave();
    await saving.catch(() => undefined);
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
    clearInput(); accumulator = 0;
    audio.setVoiceMission(campaign.id);
    syncVoicePause();
    radio.reset(state, campaign, mission);
    radioReminderOnResume = false;
    ui.showGame(state, campaign, mission, estimateLandingFuel(state, campaign, mission));
    setFlightOverlay('flight');
    return;
  }
  if (name === 'map' || name === 'togglePause' || name === 'resume' || name === 'escape') {
    setFlightOverlay(nextFlightOverlay(flightOverlay, name));
    return;
  }
  if (isPaused()) return;
  if (name === 'drop') command.drop = true;
  if (name === 'fetch') command.fetch = true;
  if (name === 'action') command.action = true;
  if (name === 'return') command.returnHome = true;
}

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (!state || state.phase === 'debrief' || state.phase === 'failed') return;
  const shortcut = flightOverlayShortcut(key, event.target instanceof Element && !!event.target.closest('input, select, textarea'), event.repeat);
  if (shortcut) {
    event.preventDefault();
    void act(shortcut);
    return;
  }
  if (isPaused() || (event.target instanceof Element && event.target.closest('button, input, select, textarea, [role="group"]'))) return;
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
    if (!isPaused() && state.phase !== 'debrief' && state.phase !== 'failed') {
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
    if ((state.phase === 'debrief' || state.phase === 'failed') && !isPaused()) setFlightOverlay('pause');
    scene?.update(state, campaign, mission);
    if (scene?.renderScheduledFrame(now, isPaused())) ui.showGame(state, campaign, mission, estimateLandingFuel(state, campaign, mission));
    syncVoicePause();
    if (flightOverlay === 'map') {
      const d = distance2D(state.position, { ...mission.fire, y: 0 });
      root?.setAttribute('data-map-distance', `${Math.round(d)} m`);
    }
  }
  audio.update(state, isPaused(), mission);
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state) setFlightOverlay('pause');
  audio.update(state, isPaused(), mission);
});
window.addEventListener('pagehide', () => { if (state) queueSave(); });
window.addEventListener('orientationchange', clearInput);
root.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  setFlightOverlay('pause');
});
root.addEventListener('webglcontextrestored', () => {
  if (state && campaign && mission) {
    scene?.dispose();
    scene = createScene(ui.getSceneHost(), { externalClock: true });
    setFlightOverlay('pause');
  }
});
ui.showMenu();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
