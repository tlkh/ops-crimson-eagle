import type { Campaign, CampaignId, FlightCommand, Mission, SimState } from '../types';
import type { ExtendedSimState } from '../sim/types';
import { getObjectiveAction } from '../sim';
import { createFlightHud } from './flightHud';
import { bucketReadyForDeckRecovery, isBucketFootprintOverDeck, isBucketTouchingLake } from '../sim/bucket';
import { shouldObserveFire } from '../sim/fireWork';
import { FLIGHT_STICK_RESPONSE, mapStickResponse, normalizeStickVector } from './stickResponse';
import { musicTracks } from '../music';
import { createMenu } from './menu';
import { cinematicEffectsEnabled, setCinematicEffectsEnabled } from '../visualPreferences';

type Callbacks = {
  onSelect(campaignId: CampaignId, missionId: string): Promise<void>;
  onCommand(name: string): void;
  onControls(command: Partial<FlightCommand>): void;
  onMusicToggle(enabled: boolean): void;
  onVoiceToggle(enabled: boolean): void;
};

const escapeText = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtFuel = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString()} kg`;
const fmtWater = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString()} L`;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function icon(name: 'map' | 'pause' | 'play' | 'home' | 'target' | 'water' | 'close' | 'lock' | 'restart' | 'arrow' | 'music' | 'musicOff' | 'radio' | 'radioOff' | 'operations') {
  const paths: Record<typeof name, string> = {
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    water: '<path d="M12 3c-2.4 3.2-6.5 7.1-6.5 11.1A6.5 6.5 0 0 0 18.5 14C18.5 10.1 14.4 6.1 12 3Z"/><path d="M9 15.5c.3 1.2 1.2 1.8 2.7 1.9"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    restart: '<path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 5v6h6"/>',
    arrow: '<path d="M4 12h16M13 5l7 7-7 7"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    musicOff: '<path d="M9 13V5l12-2v8M3 21 21 3"/><circle cx="6" cy="18" r="3"/>',
    radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 10-5M7 12h5M7 16h3"/><circle cx="17" cy="15" r="2"/>',
    radioOff: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 10-5M7 12h5M3 21 21 3"/>',
    operations: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function musicButton(className: string) {
  return `<button class="${className}" type="button" data-music-toggle data-tooltip="Turn music off" aria-pressed="true" aria-label="Turn music off">${icon('music')}<span>Music on</span></button>`;
}

function radioButton(className: string) {
  return `<button class="${className}" type="button" data-radio-toggle data-tooltip="Turn radio off" aria-pressed="true" aria-label="Turn radio off">${icon('radio')}<span>Radio on</span></button>`;
}

function musicCreditsMarkup() {
  const credits = Object.entries(musicTracks).map(([slot, track]) => `<li><b>${slot === 'menu' ? 'Menu' : escapeText(slot)}</b> · <a href="${escapeText(track.sourceUrl)}" target="_blank" rel="noopener noreferrer">“${escapeText(track.title)}”</a> by ${track.artist === 'Scott Buckley' ? '<a href="https://www.scottbuckley.com.au/" target="_blank" rel="noopener noreferrer">Scott Buckley</a>' : escapeText(track.artist)} · released under <a href="${escapeText(track.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeText(track.license)}</a>${track.changes ? ` · ${escapeText(track.changes)}` : ''}</li>`).join('');
  return `<details class="sf-music-credits"><summary>Music credits</summary><ol>${credits}</ol></details>`;
}

function phaseName(phase: SimState['phase']) {
  const labels: Record<SimState['phase'], string> = {
    prepare: 'Preflight', depart: 'Departure', shore_rig: 'Shore rigging', transit: 'Transit', work: 'Fire line',
    return: 'Return to ship', shore_unrig: 'Shore recovery', deck_rig: 'Deck rigging', land: 'Landing', debrief: 'Debrief', failed: 'Sortie failed',
  };
  return labels[phase];
}

function bucketPositionCue(state: SimState) {
  if (!state.bucketAttached) {
    if (state.bucketLocation === 'shore') {
      const site = state.bucket;
      const distance = Math.hypot(site.x - state.position.x, site.z - state.position.z);
      const range = distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`;
      return { hud: `at shore pad · ${range} away`, aria: `Bucket is at the shore rigging pad, ${range} from aircraft` };
    }
    return { hud: 'stowed on deck', aria: 'Bucket is stowed on the flight deck' };
  }
  const dx = state.bucket.x - state.position.x;
  const dz = state.bucket.z - state.position.z;
  const forward = dx * -Math.sin(state.heading) + dz * -Math.cos(state.heading);
  const right = dx * Math.cos(state.heading) + dz * -Math.sin(state.heading);
  const below = Math.max(0, Math.round(state.position.y - state.bucket.y));
  const aheadAft = Math.round(forward);
  const leftRight = Math.round(right);
  const directions: string[] = [];
  if (Math.abs(aheadAft) >= 1) directions.push(`${Math.abs(aheadAft)} m ${aheadAft > 0 ? 'ahead' : 'aft'}`);
  if (Math.abs(leftRight) >= 1) directions.push(`${Math.abs(leftRight)} m ${leftRight > 0 ? 'right' : 'left'}`);
  return {
    hud: `${below} m below${directions.length ? ` · ${directions.join(' · ')}` : ''}`,
    aria: `Bucket is ${below} metres below aircraft${directions.length ? `, ${directions.join(' and ').replace(/ m /g, ' metres ')}` : ', directly beneath aircraft'}`,
  };
}

export function createUI(root: HTMLElement, callbacks: Callbacks, campaigns: Campaign[], initialMusicEnabled: boolean, initialVoiceEnabled: boolean): {
  showMenu(): void;
  showGame(state: SimState, campaign: Campaign, mission: Mission, landingFuel: number): void;
  setPaused(paused: boolean): void;
  dispose(): void;
  getSceneHost(): HTMLElement;
} {
  root.classList.add('sf-root');
  root.innerHTML = `
    <main class="sf-app" aria-label="Ops Crimson Eagle">
      <div class="sf-scene-host" data-scene-host aria-label="3D firefighting flight scene"></div>
      <div class="sf-bucket-hud" data-bucket-hud hidden aria-label="Bucket water capacity">
        <span class="sf-bucket-hud-label" data-bucket-label>EMPTY</span>
        <div class="sf-bucket-meter" data-bucket-meter role="meter" aria-label="Water in bucket" aria-valuemin="0" aria-valuemax="5000" aria-valuenow="0" aria-valuetext="Empty, 0 of 5,000 litres">
          <span class="sf-bucket-meter-fill" data-bucket-fill></span>
        </div>
      </div>
      <section class="sf-menu" data-menu></section>
      <section class="sf-game" data-game aria-label="Flight controls" hidden>
        <header class="sf-topbar">
          <div class="sf-flight-title">
            <span class="sf-phase" data-phase>Preflight</span>
            <strong data-mission-title>Mission</strong>
            <span data-campaign-name></span>
          </div>
          <div class="sf-top-actions">
            ${musicButton('sf-icon-button sf-flight-music')}
            ${radioButton('sf-icon-button sf-flight-radio')}
            <button class="sf-icon-button" type="button" data-map data-tooltip="Open tactical map" aria-label="Open tactical map" aria-pressed="false">${icon('map')}<span>Map</span></button>
            <button class="sf-icon-button" type="button" data-pause data-tooltip="Pause sortie" aria-label="Pause sortie">${icon('pause')}<span>Pause</span></button>
            <button class="sf-menu-button sf-icon-button" type="button" data-menu-button data-tooltip="Operations" aria-label="Operations">${icon('operations')}<span>Operations</span></button>
          </div>
        </header>
        <div class="sf-readouts">
          <div class="sf-objective" data-objective role="group" aria-labelledby="sf-next-step-title" aria-describedby="sf-next-step-detail">
            <span class="sf-objective-kicker">NEXT OBJECTIVE</span>
            <div class="sf-objective-copy">
              <strong id="sf-next-step-title" data-objective-title>Hold the marked target</strong>
              <span id="sf-next-step-detail" data-objective-detail>Follow the marked objective.</span>
              <span class="sf-sr-only" data-objective-announcement role="status" aria-live="polite" aria-atomic="true"></span>
            </div>
          </div>
        </div>
        <div data-flight-hud></div>
        <div class="sf-message" data-message role="status" hidden></div>
        <aside class="sf-map-panel" data-map-panel hidden aria-label="Tactical map">
          <div class="sf-map-head"><div><strong>Sortie map</strong><span data-map-scale>Local theatre</span></div><button type="button" class="sf-icon-button sf-map-close" data-close-map aria-label="Close tactical map">${icon('close')}</button></div>
          <div class="sf-map-surface" data-map-surface>
            <span class="sf-map-water-label">SEA</span><span class="sf-map-land-label" data-map-region>KALIMANTAN</span>
            <svg class="sf-map-route" data-map-route viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="" /></svg>
            <span class="sf-map-mark ship" data-map-ship role="img"><i></i><b>SHIP</b></span>
            <span class="sf-map-mark shore" data-map-shore role="img" hidden><i></i><b>PAD</b></span>
            <span class="sf-map-mark lake" data-map-lake role="img"><i></i><b>LAKE</b></span>
            <span class="sf-map-mark fire" data-map-fire role="img"><i></i><b>FIRE</b></span>
            <span class="sf-map-mark aircraft" data-map-aircraft role="img"><i></i><b>YOU</b></span>
            <span class="sf-map-mark bucket" data-map-bucket role="img" hidden><i></i><b>BUCKET</b></span>
          </div>
          <div class="sf-map-legend"><span><i class="is-aircraft"></i>Aircraft</span><span data-bucket-legend hidden><i class="is-bucket"></i>Bucket</span><span><i class="is-ship"></i>Ship</span><span><i class="is-water"></i>Freshwater</span><span><i class="is-fire"></i>Fire line</span><span data-shore-legend hidden><i class="is-shore"></i>Shore rig</span></div>
        </aside>
        <div class="sf-controls" aria-label="Flight controls">
          <div class="sf-stick-wrap sf-stick-wrap--left">
            <div class="sf-stick-label"><b>COLLECTIVE</b><span>Climb · yaw</span></div>
            <div class="sf-stick" data-stick="left" role="group" tabindex="0" aria-label="Collective and yaw control. Arrow keys or drag to steer; release to centre" aria-description="Up and down change lift; left and right change yaw">
              <span class="sf-stick-cross sf-stick-cross--x"></span><span class="sf-stick-cross sf-stick-cross--y"></span><span class="sf-stick-knob"></span>
              <span class="sf-stick-cap">LIFT</span>
            </div>
          </div>
          <div class="sf-flight-actions">
            <button class="sf-flight-action sf-face" data-face type="button" aria-label="Face objective">${icon('target')}<span>Face objective</span></button>
            <div class="sf-context-slot" aria-live="polite">
              <button class="sf-flight-action sf-drop" data-drop type="button" hidden>${icon('water')}<span>Release water</span></button>
              <button class="sf-flight-action" data-action type="button" hidden>${icon('target')}<span>Attach bucket</span></button>
            </div>
            <button class="sf-flight-action sf-return" data-return type="button" aria-label="Set return route">${icon('home')}<span>Set return</span></button>
          </div>
          <div class="sf-stick-wrap sf-stick-wrap--right">
            <div class="sf-stick-label"><b>CYCLIC</b><span>Bank · pitch</span></div>
            <div class="sf-stick" data-stick="right" role="group" tabindex="0" aria-label="Cyclic bank and pitch control. Arrow keys or drag to steer; release to centre" aria-description="Up and down change pitch; left and right change bank">
              <span class="sf-stick-cross sf-stick-cross--x"></span><span class="sf-stick-cross sf-stick-cross--y"></span><span class="sf-stick-knob"></span>
              <span class="sf-stick-cap">MOVE</span>
            </div>
          </div>
        </div>
        <div class="sf-modal" data-pause-panel hidden role="dialog" aria-modal="true" aria-labelledby="sf-pause-title">
          <div class="sf-modal-card"><button class="sf-modal-close" data-resume aria-label="Resume sortie">${icon('close')}</button><h2 id="sf-pause-title">Sortie paused</h2><p>Take a breath. Your aircraft and sling load are waiting where you left them.</p>${musicButton('sf-menu-music sf-pause-music')}${radioButton('sf-menu-music sf-pause-radio')}<button type="button" class="sf-menu-music" data-cinematic aria-pressed="${cinematicEffectsEnabled()}">Cinematic effects ${cinematicEffectsEnabled() ? 'on' : 'off'}</button><div class="sf-modal-actions"><button class="sf-primary" data-resume>${icon('play')} Resume sortie</button><button data-restart>${icon('restart')} Restart mission</button><button data-briefing>${icon('arrow')} Mission selection</button></div></div>
        </div>
        <div class="sf-modal" data-outcome-panel hidden role="dialog" aria-modal="true" aria-labelledby="sf-outcome-title">
          <div class="sf-modal-card"><span class="sf-outcome-mark" data-outcome-mark></span><h2 data-outcome-title id="sf-outcome-title">Debrief</h2><p data-outcome-copy></p><div class="sf-modal-actions"><button class="sf-primary" data-restart>${icon('restart')} Fly again</button><button data-briefing>${icon('arrow')} Choose another mission</button></div></div>
        </div>
      </section>
    </main>`;

  const cinematicButton = root.querySelector<HTMLButtonElement>('[data-cinematic]')!;
  cinematicButton.addEventListener('click', () => {
    const enabled = !cinematicEffectsEnabled();
    setCinematicEffectsEnabled(enabled);
    cinematicButton.setAttribute('aria-pressed', String(enabled));
    cinematicButton.textContent = `Cinematic effects ${enabled ? 'on' : 'off'}`;
  });
  const app = root.querySelector<HTMLElement>('.sf-app')!;
  const sceneHost = root.querySelector<HTMLElement>('[data-scene-host]')!;
  const menu = root.querySelector<HTMLElement>('[data-menu]')!;
  const game = root.querySelector<HTMLElement>('[data-game]')!;
  const mapPanel = root.querySelector<HTMLElement>('[data-map-panel]')!;
  const pausePanel = root.querySelector<HTMLElement>('[data-pause-panel]')!;
  const outcomePanel = root.querySelector<HTMLElement>('[data-outcome-panel]')!;
  const by = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const flightHudHost = by<HTMLElement>('[data-flight-hud]');
  const flightHud = createFlightHud(flightHudHost);
  by<HTMLElement>('[data-objective]').after(flightHudHost.querySelector('.sf-compass')!);
  let mapOpen = false;
  let paused = false;
  let disposed = false;
  let musicEnabled = initialMusicEnabled;
  let voiceEnabled = initialVoiceEnabled;
  let currentCampaign: Campaign | undefined;
  let currentMission: Mission | undefined;
  let lastTick = -1;
  let lastTime = -1;
  let crashStartedAt: number | null = null;
  let activeDialog: HTMLElement | null = null;
  let dialogReturnFocus: HTMLElement | null = null;
  let objectiveTitleAnimation: Animation | null = null;
  const objectiveTitleNode = by<HTMLElement>('[data-objective-title]');
  const cancelObjectiveTitleAnimation = () => {
    objectiveTitleAnimation?.cancel();
    objectiveTitleAnimation = null;
  };
  const setObjectiveTitle = (title: string) => {
    if (objectiveTitleNode.textContent === title) return;
    cancelObjectiveTitleAnimation();
    objectiveTitleNode.textContent = title;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof objectiveTitleNode.animate !== 'function') return;
    const animation = objectiveTitleNode.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
    objectiveTitleAnimation = animation;
    animation.addEventListener('finish', () => {
      if (objectiveTitleAnimation !== animation) return;
      objectiveTitleAnimation = null;
      animation.cancel();
    }, { once: true });
  };
  const axes = { yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0 };
  const on = (selector: string, event: string, handler: (e: Event) => void) => by(selector).addEventListener(event, handler);
  const syncMusicButtons = () => root.querySelectorAll<HTMLButtonElement>('[data-music-toggle]').forEach(button => {
    const label = `Turn music ${musicEnabled ? 'off' : 'on'}`;
    button.setAttribute('aria-pressed', String(musicEnabled));
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.innerHTML = `${icon(musicEnabled ? 'music' : 'musicOff')}<span>Music ${musicEnabled ? 'on' : 'off'}</span>`;
  });
  const syncRadioButtons = () => root.querySelectorAll<HTMLButtonElement>('[data-radio-toggle]').forEach(button => {
    const label = `Turn radio ${voiceEnabled ? 'off' : 'on'}`;
    button.setAttribute('aria-pressed', String(voiceEnabled));
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.innerHTML = `${icon(voiceEnabled ? 'radio' : 'radioOff')}<span>Radio ${voiceEnabled ? 'on' : 'off'}</span>`;
  });
  const syncMapButton = () => {
    const label = `${mapOpen ? 'Close' : 'Open'} tactical map`;
    const button = by<HTMLButtonElement>('[data-map]');
    button.setAttribute('aria-pressed', String(mapOpen));
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
  };
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-music-toggle]')) return;
    musicEnabled = !musicEnabled;
    callbacks.onMusicToggle(musicEnabled);
    syncMusicButtons();
  });
  root.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-radio-toggle]')) return;
    voiceEnabled = !voiceEnabled;
    callbacks.onVoiceToggle(voiceEnabled);
    syncRadioButtons();
  });
  const setAxis = (name: keyof typeof axes, value: number) => {
    axes[name] = Math.round(clamp(value, -1, 1) * 100) / 100;
    callbacks.onControls({ [name]: axes[name] });
  };
  const releaseSticks = () => {
    setAxis('yaw', 0); setAxis('climb', 0); setAxis('cyclicX', 0); setAxis('cyclicY', 0);
    root.querySelectorAll<HTMLElement>('.sf-stick').forEach(stick => {
      delete (stick as HTMLElement & { activePointer?: number }).activePointer;
      stick.classList.remove('is-active');
      stick.querySelector<HTMLElement>('.sf-stick-knob')!.style.transform = 'translate(-50%, -50%)';
    });
  };

  const syncDialog = (panel: HTMLElement | null) => {
    if (activeDialog === panel) return;
    if (panel && !activeDialog && document.activeElement instanceof HTMLElement) dialogReturnFocus = document.activeElement;
    activeDialog = panel;
    for (const child of Array.from(game.children)) {
      if (child !== pausePanel && child !== outcomePanel) (child as HTMLElement).inert = !!panel;
    }
    sceneHost.inert = !!panel;
    if (panel) queueMicrotask(() => panel.querySelector<HTMLButtonElement>('.sf-primary')?.focus());
    else if (dialogReturnFocus?.isConnected) {
      dialogReturnFocus.focus();
      dialogReturnFocus = null;
    }
  };

  const syncPaused = (value: boolean) => {
    paused = value;
    pausePanel.hidden = !paused;
    syncDialog(paused ? pausePanel : outcomePanel.hidden ? null : outcomePanel);
    const button = by<HTMLButtonElement>('[data-pause]');
    const label = paused ? 'Resume sortie' : 'Pause sortie';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
    button.innerHTML = `${icon(paused ? 'play' : 'pause')}<span>${paused ? 'Resume' : 'Pause'}</span>`;
  };
  const resetTransientUI = () => {
    cancelObjectiveTitleAnimation();
    crashStartedAt = null;
    game.dataset.crashing = 'false';
    mapOpen = false;
    mapPanel.hidden = true;
    syncMapButton();
    syncPaused(false);
    outcomePanel.hidden = true;
    syncDialog(null);
    releaseSticks();
  };

  const menuController = createMenu(menu, campaigns, {
    onLaunch: callbacks.onSelect,
    musicButton: () => musicButton('sf-menu-music'),
    musicCredits: musicCreditsMarkup,
    syncMusic: syncMusicButtons,
  });

  const positionMapMark = (selector: string, p: { x: number; z: number }, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    const el = by<HTMLElement>(selector);
    const left = (p.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX) * 100;
    const top = (p.z - bounds.minZ) / Math.max(1, bounds.maxZ - bounds.minZ) * 100;
    el.style.left = `${left}%`;
    el.style.top = `${top}%`;
  };
  const updateMap = (state: SimState, campaign: Campaign, mission: Mission) => {
    const bucketPosition = state.bucket;
    const showBucket = state.bucketLocation !== 'ship';
    const points = [mission.ship, mission.lake, mission.fire, state.position, ...(showBucket ? [bucketPosition] : []), ...(mission.shore ? [mission.shore] : [])];
    const extent = Math.max(
      Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
      Math.max(...points.map(p => p.z)) - Math.min(...points.map(p => p.z)),
      200,
    );
    const pad = Math.max(100, extent * .14);
    const bounds = {
      minX: Math.min(...points.map(p => p.x)) - pad, maxX: Math.max(...points.map(p => p.x)) + pad,
      minZ: Math.min(...points.map(p => p.z)) - pad, maxZ: Math.max(...points.map(p => p.z)) + pad,
    };
    positionMapMark('[data-map-ship]', mission.ship, bounds);
    by('[data-map-ship]').setAttribute('aria-label', 'Home ship');
    const shore = by<HTMLElement>('[data-map-shore]');
    const showShore = campaign.id === 'jp_ketapang_2026_09' && !!mission.shore;
    by<HTMLElement>('[data-map-region]').textContent = campaign.id === 'jp_ketapang_2026_09' ? 'KETAPANG · WEST' : 'SERUYAN · CENTRAL';
    shore.hidden = !showShore;
    by<HTMLElement>('[data-shore-legend]').hidden = !showShore;
    if (showShore && mission.shore) {
      positionMapMark('[data-map-shore]', mission.shore, bounds);
      const shoreDistance = Math.hypot(state.position.x - mission.shore.x, state.position.z - mission.shore.z);
      shore.querySelector('b')!.textContent = `RIG ${(shoreDistance / 1000).toFixed(0)} KM`;
      shore.setAttribute('aria-label', `Reconstructed shore handling pad, ${(shoreDistance / 1000).toFixed(1)} kilometres from aircraft`);
    }
    positionMapMark('[data-map-lake]', mission.lake, bounds);
    positionMapMark('[data-map-fire]', mission.fire, bounds);
    positionMapMark('[data-map-aircraft]', state.position, bounds);
    by('[data-map-aircraft]').setAttribute('aria-label', 'Your aircraft');
    const bucketMarker = by<HTMLElement>('[data-map-bucket]');
    bucketMarker.hidden = !showBucket;
    by<HTMLElement>('[data-bucket-legend]').hidden = !showBucket;
    if (showBucket) {
      positionMapMark('[data-map-bucket]', bucketPosition, bounds);
      bucketMarker.setAttribute('aria-label', bucketPositionCue(state).aria);
    }
    const routePoints = [mission.ship, ...(showShore && mission.shore ? [mission.shore] : []), mission.lake, mission.fire]
      .map(p => `${(p.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX) * 100},${(p.z - bounds.minZ) / Math.max(1, bounds.maxZ - bounds.minZ) * 100}`)
      .join(' ');
    by<SVGPolylineElement>('[data-map-route] polyline').setAttribute('points', routePoints);
    const kmWide = (bounds.maxX - bounds.minX) / 1000;
    const kmDeep = (bounds.maxZ - bounds.minZ) / 1000;
    by('[data-map-scale]').textContent = `${Math.round(Math.max(kmWide, kmDeep))} km theatre view`;
  };

  const dispatchCommand = (name: string) => callbacks.onCommand(name);
  root.addEventListener('keydown', event => {
    if (!activeDialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (activeDialog === pausePanel) {
        syncPaused(false);
        dispatchCommand('resume');
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(activeDialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  on('[data-map]', 'click', () => {
    mapOpen = !mapOpen;
    mapPanel.hidden = !mapOpen;
    syncMapButton();
    dispatchCommand('map');
  });
  on('[data-close-map]', 'click', () => {
    mapOpen = false;
    mapPanel.hidden = true;
    syncMapButton();
    dispatchCommand('map');
  });
  on('[data-pause]', 'click', () => {
    if (mapOpen) {
      mapOpen = false;
      mapPanel.hidden = true;
      syncMapButton();
      dispatchCommand('map');
    }
    syncPaused(!paused);
    dispatchCommand('togglePause');
  });
  on('[data-menu-button]', 'click', () => { releaseSticks(); dispatchCommand('menu'); });
  on('[data-drop]', 'click', () => dispatchCommand('drop'));
  on('[data-action]', 'click', () => dispatchCommand(by<HTMLButtonElement>('[data-action]').dataset.command || 'action'));
  on('[data-return]', 'click', () => dispatchCommand('return'));
  on('[data-face]', 'click', () => dispatchCommand('faceObjective'));
  root.querySelectorAll<HTMLElement>('[data-resume]').forEach(button => button.addEventListener('click', () => {
    syncPaused(false);
    dispatchCommand('resume');
  }));
  root.querySelectorAll<HTMLElement>('[data-restart]').forEach(button => button.addEventListener('click', () => { resetTransientUI(); dispatchCommand('restart'); }));
  root.querySelectorAll<HTMLElement>('[data-briefing]').forEach(button => button.addEventListener('click', () => { releaseSticks(); dispatchCommand('menu'); }));

  root.querySelectorAll<HTMLElement>('[data-stick]').forEach(stick => {
    const side = stick.dataset.stick as 'left' | 'right';
    const knob = stick.querySelector<HTMLElement>('.sf-stick-knob')!;
    const updateStick = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      const maxTravel = rect.width * .32;
      const rawX = (event.clientX - (rect.left + rect.width / 2)) / maxTravel;
      const rawY = ((rect.top + rect.height / 2) - event.clientY) / maxTravel;
      const position = normalizeStickVector(rawX, rawY);
      const response = side === 'left'
        ? mapStickResponse(rawX, rawY, FLIGHT_STICK_RESPONSE.yawLimit, FLIGHT_STICK_RESPONSE.collectiveLimit)
        : mapStickResponse(rawX, rawY, FLIGHT_STICK_RESPONSE.cyclicLimit, FLIGHT_STICK_RESPONSE.cyclicLimit);
      knob.style.transform = `translate(calc(-50% + ${position.x * maxTravel}px), calc(-50% - ${position.y * maxTravel}px))`;
      // Positive aircraft yaw turns left; the knob still follows the pointer.
      if (side === 'left') { setAxis('yaw', -response.x); setAxis('climb', response.y); }
      else { setAxis('cyclicX', response.x); setAxis('cyclicY', response.y); }
    };
    stick.addEventListener('pointerdown', event => {
      const e = event as PointerEvent;
      e.preventDefault();
      (stick as HTMLElement & { activePointer?: number }).activePointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stick.classList.add('is-active');
      updateStick(e);
    });
    stick.addEventListener('pointermove', event => {
      const e = event as PointerEvent;
      if ((stick as HTMLElement & { activePointer?: number }).activePointer === e.pointerId) updateStick(e);
    });
    const release = (event: Event) => {
      const e = event as PointerEvent;
      if ((stick as HTMLElement & { activePointer?: number }).activePointer !== e.pointerId) return;
      delete (stick as HTMLElement & { activePointer?: number }).activePointer;
      stick.classList.remove('is-active');
      knob.style.transform = 'translate(-50%, -50%)';
      if (side === 'left') { setAxis('yaw', 0); setAxis('climb', 0); }
      else { setAxis('cyclicX', 0); setAxis('cyclicY', 0); }
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('lostpointercapture', release);
    stick.addEventListener('keydown', event => {
      const e = event as KeyboardEvent;
      const amount = e.shiftKey ? 1 : .5;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const horizontal = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0;
      const y = e.key === 'ArrowUp' ? amount : e.key === 'ArrowDown' ? -amount : 0;
      const response = side === 'left'
        ? mapStickResponse(horizontal, y, FLIGHT_STICK_RESPONSE.yawLimit, FLIGHT_STICK_RESPONSE.collectiveLimit)
        : mapStickResponse(horizontal, y, FLIGHT_STICK_RESPONSE.cyclicLimit, FLIGHT_STICK_RESPONSE.cyclicLimit);
      if (side === 'left') { setAxis('yaw', -response.x); setAxis('climb', response.y); }
      else { setAxis('cyclicX', response.x); setAxis('cyclicY', response.y); }
      const maxTravel = stick.getBoundingClientRect().width * .32;
      const position = normalizeStickVector(horizontal, y);
      knob.style.transform = `translate(calc(-50% + ${position.x * maxTravel}px), calc(-50% - ${position.y * maxTravel}px))`;
    });
    stick.addEventListener('keyup', event => {
      const e = event as KeyboardEvent;
      if (e.key.startsWith('Arrow') || e.key === ' ') {
        e.stopPropagation();
        if (side === 'left') { setAxis('yaw', 0); setAxis('climb', 0); }
        else { setAxis('cyclicX', 0); setAxis('cyclicY', 0); }
        knob.style.transform = 'translate(-50%, -50%)';
      }
    });
  });

  const showMenu = () => {
    const returningFromGame = app.dataset.screen === 'game';
    releaseSticks();
    app.dataset.screen = 'menu';
    game.hidden = true;
    menu.hidden = false;
    resetTransientUI();
    lastTick = -1;
    lastTime = -1;
    menuController.showCampaigns();
    if (returningFromGame) menu.querySelector<HTMLButtonElement>('.cm-campaign-card[aria-current="true"], .cm-campaign-card')?.focus();
  };
  const setPaused = (value: boolean) => syncPaused(value);
  const showGame = (state: SimState, campaign: Campaign, mission: Mission, landingFuel: number) => {
    if (disposed) return;
    if (currentMission?.id !== mission.id || currentCampaign?.id !== campaign.id || (lastTick >= 0 && (state.tick < lastTick || state.timeSec < lastTime))) {
      resetTransientUI();
      currentCampaign = campaign;
      currentMission = mission;
    }
    app.dataset.screen = 'game';
    game.hidden = false;
    menu.hidden = true;
    const phase = by('[data-phase]');
    phase.textContent = phaseName(state.phase);
    by('[data-mission-title]').textContent = mission.title;
    by('[data-campaign-name]').textContent = `${campaign.name} · ${mission.date}`;
    by('[data-water]').textContent = fmtWater(state.waterLitres);
    flightHud.update(state, campaign, mission, landingFuel);
    const bucketCue = by<HTMLElement>('[data-bucket-cue]');
    const bucketCueText = bucketPositionCue(state);
    by('[data-sling]').textContent = bucketCueText.hud;
    bucketCue.setAttribute('aria-label', bucketCueText.aria);
    const extended = state as ExtendedSimState;
    const bucketHud = by<HTMLElement>('[data-bucket-hud]');
    const bucketMeter = by<HTMLElement>('[data-bucket-meter]');
    const bucketFill = by<HTMLElement>('[data-bucket-fill]');
    const bucketLitres = clamp(state.waterLitres, 0, 5000);
    const bucketPercent = bucketLitres / 5000 * 100;
    const bucketLabel = bucketLitres <= 0 ? 'EMPTY'
      : bucketLitres >= 5000 ? 'FULL'
        : `${(bucketLitres / 1000).toFixed(1)}K L`;
    const bucketLoad = `${Math.round(bucketLitres).toLocaleString()} of 5,000 litres`;
    bucketHud.hidden = !state.bucketAttached || state.outcome !== 'none' || state.phase === 'debrief' || state.phase === 'failed';
    by('[data-bucket-label]').textContent = bucketLabel;
    bucketFill.style.transform = `scaleX(${bucketPercent / 100})`;
    bucketMeter.setAttribute('aria-valuenow', String(Math.round(bucketLitres)));
    bucketMeter.setAttribute('aria-valuetext', `${bucketLabel === 'EMPTY' || bucketLabel === 'FULL' ? `${bucketLabel.toLowerCase()}, ` : ''}${bucketLoad}`);
    by('[data-reserve]').textContent = fmtFuel(landingFuel);
    const guidance = extended.guidance;
    const objectiveAction = getObjectiveAction(state, campaign, mission);
    const observingFire = shouldObserveFire(state, mission);
    const deckRecoveryApproach = campaign.id === 'sg_fictional_2026_10' && state.bucketAttached &&
      ['return', 'land'].includes(state.phase)
      ? (() => {
        if (bucketReadyForDeckRecovery(state, campaign, mission) && (guidance?.distanceM ?? Infinity) <= 5) {
          return {
            title: 'Descend vertically onto the landing spot',
            detail: state.position.y > 10 ? 'The bucket is clear and over the deck. Descend vertically onto the marked landing spot.'
              : Math.hypot(state.velocity.x, state.velocity.z) > 10 ? 'The bucket is clear and over the deck. Slow down before settling onto the landing spot.'
                : 'The bucket is clear and over the deck. Settle vertically onto the marked landing spot.',
          };
        }
        if (isBucketFootprintOverDeck(state, campaign, mission) && !bucketReadyForDeckRecovery(state, campaign, mission)) {
          return {
            title: 'Raise the bucket clear of the deck',
            detail: 'Raise the bucket clear of the deck before descending; keep the aircraft above 26 m while the sling comes free.',
          };
        }
        return {
          title: 'Fly the bucket over the landing spot',
          detail: state.position.y > 26
            ? 'Move the hanging bucket over the marked landing spot while keeping the aircraft above 26 m.'
            : 'Climb above 26 m to lift the bucket, then move it over the marked landing spot.',
        };
      })()
      : null;
    const objectiveDistance = guidance?.distanceM ?? 0;
    const roundedDistance = Math.round(objectiveDistance / 10) * 10;
    const distanceText = roundedDistance >= 1000
      ? `${(roundedDistance / 1000).toFixed(1)} km`
      : `${roundedDistance.toLocaleString()} m`;
    by('[data-guidance]').textContent = state.phase === 'failed'
      ? 'Mission failed'
      : guidance ? `${guidance.label} · ${Math.round(guidance.distanceM)} m` : '—';

    const contextualActions: Record<NonNullable<typeof objectiveAction>, { label: string; title: string; ready: string; command: 'action' | 'fetch' | 'drop' }> = {
      attach: { label: 'Attach bucket', title: 'Attach the bucket at the shore pad', ready: 'Tap to align and attach at the shore pad.', command: 'action' },
      fetch: { label: 'Fetch water', title: 'Fill the bucket at the lake', ready: isBucketTouchingLake(state.bucket, mission) ? 'Bucket touching water. Tap Fetch water to fill.' : 'Tap to align and fill the bucket at the lake.', command: 'fetch' },
      release: { label: 'Release water', title: 'Release water over the fire', ready: 'Tap to align and release water over the fire.', command: 'drop' },
      unrig: { label: 'Remove bucket', title: 'Remove the bucket at the shore pad', ready: 'Tap to align and remove the bucket at the pad.', command: 'action' },
      'deck-rig': { label: 'Attach bucket', title: 'Attach the bucket on deck', ready: 'Tap to align and attach on the flight deck.', command: 'action' },
      'deck-recover': { label: 'Secure bucket', title: 'Secure the bucket on deck', ready: 'Tap to align and secure the bucket on deck.', command: 'action' },
    };
    const nextStepByPhase: Record<SimState['phase'], string> = {
      prepare: 'Lift clear of the ship deck',
      depart: campaign.id === 'jp_ketapang_2026_09' ? 'Fly to the shore handling pad' : 'Fly to the freshwater lake',
      shore_rig: 'Approach the shore pad to attach the bucket',
      transit: 'Fly to the freshwater lake',
      work: state.waterLitres >= 4500 ? 'Fly to the fire line and release water' : 'Fill the bucket at the freshwater lake',
      return: deckRecoveryApproach?.title ?? (campaign.id === 'jp_ketapang_2026_09' && state.bucketAttached ? 'Land at the shore pad to remove the bucket' : 'Return to the ship deck'),
      shore_unrig: 'Remove the bucket at the shore pad',
      deck_rig: state.bucketAttached ? 'Secure the bucket on the flight deck' : 'Attach the bucket on the flight deck',
      land: 'Settle onto the ship deck',
      debrief: 'Review the sortie debrief',
      failed: 'Review the sortie result',
    };
    const nextTitle = observingFire ? 'Observe fire cooling'
      : objectiveAction ? contextualActions[objectiveAction].title
        : deckRecoveryApproach?.title ?? nextStepByPhase[state.phase];
    const activeOperation = (() => {
      if (extended.dumping) {
        const startLitres = Math.max(0, extended.dumpStartedWithLitres);
        const releasedPercent = startLitres > 0 ? clamp((startLitres - bucketLitres) / startLitres, 0, 1) : 0;
        return {
          title: 'Releasing water',
          detail: `Releasing load · ${Math.round(releasedPercent * 100)}% released · ${fmtWater(bucketLitres)} remaining.`,
        };
      }
      if (observingFire) {
        if (extended.waterPackets.length > 0 || state.airborneLitres > 1e-8) {
          return { title: 'Observe water impact', detail: 'Falling water is still reaching the fire. Stay nearby and watch the cooling before leaving the fire line.' };
        }
        return {
          title: 'Observe fire cooling',
          detail: 'Water has suppressed the surface fire. Hold near the fire while the ground crew secures the line.',
        };
      }
      if (extended.fetching || extended.precisionAction === 'fetch') {
        const bucketDistance = Math.hypot(state.bucket.x - mission.lake.x, state.bucket.z - mission.lake.z);
        const atLake = bucketDistance <= mission.lake.radius;
        const touchingWater = isBucketTouchingLake(state.bucket, mission);
        const filling = touchingWater && Math.hypot(state.bucketVelocity.x, state.bucketVelocity.z) <= 2;
        const stage = filling ? 'Filling bucket' : touchingWater ? 'Steadying bucket' : atLake ? 'Dipping bucket' : 'Aligning over lake';
        return {
          title: stage,
          detail: filling
            ? `Filling · ${fmtWater(bucketLitres)} of 5,000 L.`
            : `${stage} · ${fmtWater(bucketLitres)} of 5,000 L loaded.`,
        };
      }
      const rigAction = extended.precisionAction && ['attach', 'unrig', 'deck-rig', 'deck-recover'].includes(extended.precisionAction)
        ? extended.precisionAction
        : state.rigProgress > 0
          ? state.phase === 'shore_unrig' ? 'unrig'
            : state.phase === 'deck_rig' ? state.bucketAttached ? 'deck-recover' : 'deck-rig'
              : state.phase === 'shore_rig' ? 'attach' : null
          : null;
      if (rigAction) {
        const labels: Record<string, string> = {
          attach: 'Attaching bucket', unrig: 'Removing bucket', 'deck-rig': 'Attaching bucket', 'deck-recover': 'Securing bucket',
        };
        const progress = clamp(state.rigProgress, 0, 1);
        return {
          title: progress > 0 ? labels[rigAction] : 'Aligning at the handling point',
          detail: progress > 0 ? `${progress < .2 ? 'Crew moving into position' : progress < .72 ? (rigAction === 'unrig' || rigAction === 'deck-recover' ? 'Crew releasing the sling and winding the reel' : 'Crew connecting and checking the sling') : 'Crew securing equipment and stepping clear'} · ${Math.round(progress * 100)}%.` : 'Holding position for the ground crew.',
        };
      }
      if (extended.precisionAction === 'release') {
        return { title: 'Aligning over fire', detail: `Preparing release · ${distanceText} away · ${fmtWater(bucketLitres)} in bucket.` };
      }
      return undefined;
    })();
    let approachHint: string | undefined;
    if (!objectiveAction && guidance && objectiveDistance < 110) {
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (deckRecoveryApproach) {
        approachHint = deckRecoveryApproach.detail;
      } else if (guidance.label === 'Freshwater lake' && state.bucketAttached) {
        approachHint = state.position.y > 36 ? 'Lower toward 25 m to dip the bucket.'
          : state.position.y < 15 ? 'Climb toward 25 m over the lake.'
            : speed > 12 ? 'Slow down over the lake to fetch water.'
              : 'Move closer to the lake marker.';
      } else if (guidance.label === 'Active fire' && state.waterLitres > 0) {
        approachHint = state.position.y < 32 || state.position.y > 85 ? 'Hold near 55 m over the fire.'
          : speed > 12 ? 'Slow down before releasing water.'
            : 'Move closer to the fire marker.';
      } else if (['deck_rig', 'shore_rig', 'shore_unrig', 'land', 'return'].includes(state.phase)) {
        approachHint = state.position.y > 10 ? 'Descend toward the marked landing point.'
          : speed > 10 ? 'Slow down for the landing point.'
            : 'Settle onto the marked landing point.';
      }
    }
    const objectiveDetail = state.phase === 'failed'
      ? 'Aircraft lost. The sortie has ended.'
      : activeOperation
      ? activeOperation.detail
      : objectiveAction
      ? contextualActions[objectiveAction].ready
      : approachHint
        ? approachHint
      : guidance
        ? `${distanceText} away. Face objective turns toward it.`
        : 'Follow the marked objective.';
    by<HTMLElement>('.sf-objective-kicker').textContent = activeOperation ? 'IN PROGRESS' : 'NEXT OBJECTIVE';
    setObjectiveTitle(activeOperation?.title ?? nextTitle);
    by('[data-objective-detail]').textContent = objectiveDetail;
    const announcement = observingFire && activeOperation?.title === 'Observe water impact'
      ? 'Water is still falling onto the fire. Stay nearby and watch the cooling before leaving the fire line.'
      : observingFire && activeOperation?.title === 'Observe fire cooling'
      ? activeOperation.detail
      : activeOperation
      ? `Bucket operation in progress: ${activeOperation.title}.`
      : objectiveAction
      ? `Next step: ${contextualActions[objectiveAction].title}. Action ready.`
      : `Next step: ${nextTitle}.`;
    const announcementNode = by('[data-objective-announcement]');
    if (announcementNode.textContent !== announcement) announcementNode.textContent = announcement;
    const message = by<HTMLElement>('[data-message]');
    const showMessage = !activeOperation && !!state.message && (!state.messageUntil || state.timeSec <= state.messageUntil);
    message.hidden = !showMessage;
    if (showMessage) message.textContent = state.message;
    const drop = by<HTMLButtonElement>('[data-drop]');
    const action = by<HTMLButtonElement>('[data-action]');
    const face = by<HTMLButtonElement>('[data-face]');
    const context = objectiveAction ? contextualActions[objectiveAction] : undefined;
    drop.hidden = !!activeOperation || objectiveAction !== 'release';
    action.hidden = !!activeOperation || !context || context.command === 'drop';
    face.hidden = state.outcome !== 'none' || state.phase === 'debrief' || state.phase === 'failed';
    if (context && context.command !== 'drop') {
      action.querySelector('span')!.textContent = context.label;
      action.setAttribute('aria-label', context.label);
      action.dataset.command = context.command;
    }
    if (context?.command === 'drop') {
      drop.querySelector('span')!.textContent = context.label;
      drop.setAttribute('aria-label', context.label);
      drop.classList.add('is-ready');
    } else {
      drop.classList.remove('is-ready');
    }
    const returnButton = by<HTMLButtonElement>('[data-return]');
    const returnSelected = state.phase === 'return' || state.phase === 'land';
    returnButton.querySelector('span')!.textContent = returnSelected ? 'Return set' : 'Set return';
    returnButton.disabled = returnSelected || ['deck_rig', 'shore_rig', 'shore_unrig', 'debrief', 'failed'].includes(state.phase);
    const targetDist = Math.hypot(state.position.x - mission.fire.x, state.position.z - mission.fire.z);
    by('[data-map-fire]').setAttribute('aria-label', `Fire line, ${Math.round(targetDist)} metres from aircraft`);
    by('[data-map-lake]').setAttribute('aria-label', `Freshwater lake, ${Math.round(mission.lake.radius).toLocaleString()} metre radius`);
    const mapCallout = by<HTMLElement>('[data-map-panel]');
    mapCallout.setAttribute('data-open', String(mapOpen));
    updateMap(state, campaign, mission);
    const collisionFailure = state.phase === 'failed' && (state as ExtendedSimState).failureCause === 'collision';
    if (collisionFailure && crashStartedAt === null) crashStartedAt = performance.now();
    const crashPlaying = collisionFailure && crashStartedAt !== null && performance.now() - crashStartedAt < 2400;
    game.dataset.crashing = String(crashPlaying);
    const terminal = state.outcome !== 'none' || state.phase === 'debrief' || state.phase === 'failed';
    face.hidden = terminal;
    outcomePanel.hidden = !terminal || crashPlaying;
    syncDialog(terminal && !crashPlaying ? outcomePanel : paused ? pausePanel : null);
    if (terminal) {
      const success = state.outcome === 'success';
      by('[data-outcome-title]').textContent = collisionFailure ? 'Aircraft destroyed' : success ? 'Water delivered' : state.outcome === 'failed' ? 'Sortie ended early' : 'Crew debrief';
      by('[data-outcome-copy]').textContent = collisionFailure
        ? `${state.message || 'The aircraft struck an obstacle. Mission failed.'} Fly again or choose another mission.`
        : success
        ? `The fire line is secured. ${fmtWater(state.usefulLitres)} of useful water delivered; landing fuel reserve ${fmtFuel(landingFuel)}.`
        : `${fmtWater(state.usefulLitres)} of useful water reached the target. Landing fuel reserve ${fmtFuel(landingFuel)}. You can fly the sortie again or choose another mission.`;
      by('[data-outcome-mark]').innerHTML = icon(success ? 'target' : 'restart');
    }
    lastTick = state.tick;
    lastTime = state.timeSec;
  };

  showMenu();
  syncRadioButtons();
  return {
    showMenu,
    showGame,
    setPaused,
    getSceneHost: () => sceneHost,
    dispose() {
      disposed = true;
      cancelObjectiveTitleAnimation();
      menuController.dispose();
      releaseSticks();
      callbacks.onControls({ yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0 });
      root.innerHTML = '';
      root.classList.remove('sf-root');
    },
  };
}
