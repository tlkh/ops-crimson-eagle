import type { Campaign, CampaignId, FlightCommand, Mission, SimState } from '../types';
import type { ExtendedSimState } from '../sim/types';
import { getObjectiveAction } from '../sim';
import { createFlightHud } from './flightHud';
import { isBucketTouchingLake } from '../sim/bucket';

type Callbacks = {
  onSelect(campaignId: CampaignId, missionId: string): void;
  onCommand(name: string): void;
  onControls(command: Partial<FlightCommand>): void;
};

const escapeText = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmtFuel = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString()} kg`;
const fmtWater = (value: number) => `${Math.max(0, Math.round(value)).toLocaleString()} L`;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function icon(name: 'map' | 'pause' | 'play' | 'home' | 'target' | 'water' | 'close' | 'lock' | 'restart' | 'arrow') {
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
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function campaignCopy(campaign: Campaign) {
  if (campaign.id === 'sg_fictional_2026_10') return {
    location: 'Seruyan · Central Kalimantan',
    copy: 'Due to hazardous levels of haze affecting Singapore, the SAF forward deploys RSS Persistence, an LST, and an RSAF Chinook crew to aid firefighting efforts in the Seruyan area.',
    date: 'October 2026',
    aircraft: 'RSAF CH-47F Chinook',
    ship: 'RSS Persistence',
    shipClass: 'Endurance-class LST · 209',
    paint: 'sg',
  };
  return {
    location: 'Ketapang · West Kalimantan',
    copy: 'Deploy with JS Kunisaki and a JGSDF Chinook crew to support firefighting around Ketapang. Fly reconstructed sorties inspired by Japan’s September 2026 deployment to Indonesia.',
    date: '23–29 September 2026',
    aircraft: 'JGSDF CH-47JA Chinook',
    ship: 'JS Kunisaki',
    shipClass: 'Ōsumi-class LST · LST-4003',
    paint: 'jp',
  };
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

export function createUI(root: HTMLElement, callbacks: Callbacks, campaigns: Campaign[]): {
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
            <button class="sf-icon-button" type="button" data-map aria-label="Open tactical map" aria-pressed="false">${icon('map')}<span>Map</span></button>
            <button class="sf-icon-button" type="button" data-pause aria-label="Pause sortie">${icon('pause')}<span>Pause</span></button>
            <button class="sf-menu-button" type="button" data-menu-button>Operations</button>
          </div>
        </header>
        <div class="sf-readouts">
          <div class="sf-objective" data-objective role="group" aria-labelledby="sf-next-step-title" aria-describedby="sf-next-step-detail">
            <span class="sf-objective-dot" aria-hidden="true"></span>
            <div class="sf-objective-copy">
              <strong id="sf-next-step-title" data-objective-title>Next: Hold the marked target</strong>
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
          <div class="sf-modal-card"><button class="sf-modal-close" data-resume aria-label="Resume sortie">${icon('close')}</button><h2 id="sf-pause-title">Sortie paused</h2><p>Take a breath. Your aircraft and sling load are waiting where you left them.</p><div class="sf-modal-actions"><button class="sf-primary" data-resume>${icon('play')} Resume sortie</button><button data-restart>${icon('restart')} Restart mission</button><button data-briefing>${icon('arrow')} Mission selection</button></div></div>
        </div>
        <div class="sf-modal" data-outcome-panel hidden role="dialog" aria-modal="true" aria-labelledby="sf-outcome-title">
          <div class="sf-modal-card"><span class="sf-outcome-mark" data-outcome-mark></span><h2 data-outcome-title id="sf-outcome-title">Debrief</h2><p data-outcome-copy></p><div class="sf-modal-actions"><button class="sf-primary" data-restart>${icon('restart')} Fly again</button><button data-briefing>${icon('arrow')} Choose another mission</button></div></div>
        </div>
      </section>
    </main>`;

  const app = root.querySelector<HTMLElement>('.sf-app')!;
  const sceneHost = root.querySelector<HTMLElement>('[data-scene-host]')!;
  const menu = root.querySelector<HTMLElement>('[data-menu]')!;
  const game = root.querySelector<HTMLElement>('[data-game]')!;
  const mapPanel = root.querySelector<HTMLElement>('[data-map-panel]')!;
  const pausePanel = root.querySelector<HTMLElement>('[data-pause-panel]')!;
  const outcomePanel = root.querySelector<HTMLElement>('[data-outcome-panel]')!;
  const by = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const flightHud = createFlightHud(by<HTMLElement>('[data-flight-hud]'));
  let mapOpen = false;
  let paused = false;
  let disposed = false;
  let currentCampaign: Campaign | undefined;
  let currentMission: Mission | undefined;
  let lastTick = -1;
  let lastTime = -1;
  let crashStartedAt: number | null = null;
  let activeDialog: HTMLElement | null = null;
  let dialogReturnFocus: HTMLElement | null = null;
  const axes = { yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0 };
  const on = (selector: string, event: string, handler: (e: Event) => void) => by(selector).addEventListener(event, handler);
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
    by('[data-pause]').setAttribute('aria-pressed', String(paused));
    by('[data-pause]').innerHTML = `${icon(paused ? 'play' : 'pause')}<span>${paused ? 'Resume' : 'Pause'}</span>`;
  };
  const resetTransientUI = () => {
    crashStartedAt = null;
    game.dataset.crashing = 'false';
    mapOpen = false;
    mapPanel.hidden = true;
    by('[data-map]').setAttribute('aria-pressed', 'false');
    syncPaused(false);
    outcomePanel.hidden = true;
    syncDialog(null);
    releaseSticks();
  };

  let menuHasOpened = false;
  let selectedCampaignId: CampaignId | undefined;
  const menuAnimations = new Set<Animation>();
  const enterMenu = (direction: 'initial' | 'forward' | 'back', event?: Event) => {
    menu.scrollTop = 0;
    for (const animation of menuAnimations) animation.cancel();
    menuAnimations.clear();
    const keyboard = event instanceof MouseEvent && event.detail === 0;
    if (keyboard) return;
    const target = menu.querySelector<HTMLElement>(direction === 'initial' ? '.sf-campaign-grid' : '.sf-menu-inner');
    if (!target) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = reduced ? 'none' : direction === 'initial' ? 'translateY(6px)' : `translateX(${direction === 'forward' ? 10 : -10}px)`;
    const animation = target.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], {
      duration: reduced ? 80 : direction === 'initial' ? 220 : 180,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
    });
    menuAnimations.add(animation);
    animation.onfinish = () => menuAnimations.delete(animation);
  };
  const fleetMarkup = (campaign: Campaign) => `<span class="sf-fleet-portrait" data-fleet="${campaign.id}">
    <img data-fleet-image alt="Side view of ${escapeText(campaignCopy(campaign).aircraft)} flying alongside ${escapeText(campaignCopy(campaign).ship)}" width="1200" height="420" hidden />
    <span class="sf-fleet-loading">Preparing aircraft and ship view…</span>
  </span>`;
  const loadFleet = (campaign: Campaign) => {
    const target = menu.querySelector<HTMLElement>(`[data-fleet="${campaign.id}"]`);
    if (!target) return;
    requestAnimationFrame(() => {
      if (disposed || !target.isConnected) return;
      void import('../render/campaignFleet').then(({ renderCampaignFleet }) => renderCampaignFleet(campaign)).then(url => {
        if (disposed || !target.isConnected) return;
        const image = target.querySelector<HTMLImageElement>('[data-fleet-image]')!;
        image.src = url; image.hidden = false;
        target.querySelector('.sf-fleet-loading')?.remove();
      }).catch(() => {
        if (target.isConnected) target.querySelector('.sf-fleet-loading')!.textContent = 'Aircraft and ship ready for deployment';
      });
    });
  };
  const kitMarkup = (campaign: Campaign) => {
    const c = campaignCopy(campaign);
    return `<span><small>Aircraft</small><b>${escapeText(c.aircraft)}</b></span><span><small>Home ship</small><b>${escapeText(c.ship)}</b><span class="sf-kit-detail">${escapeText(c.shipClass)}</span></span>`;
  };

  const renderCampaigns = (event?: Event) => {
    const firstVisit = !menuHasOpened;
    const ordered = [...campaigns].sort((a, b) => Number(b.id.startsWith('sg_')) - Number(a.id.startsWith('sg_')));
    menu.innerHTML = `
      <div class="sf-menu-inner">
        <header class="sf-brand-block">
          <img class="sf-brand-mark" src="${import.meta.env.BASE_URL}assets/crimson-eagle-mark.png" width="128" height="128" alt="" />
          <div><h1>Ops Crimson Eagle</h1><p>Water where the fire needs it.</p></div>
        </header>
        <div class="sf-campaign-section-head"><h2>Choose your campaign</h2><span>02 campaigns</span></div>
        <div class="sf-campaign-grid" data-campaign-grid></div>
        <footer class="sf-credits">
          <p>Created by <strong>Timothy Liu</strong></p>
          <nav class="sf-credits-links" aria-label="Author and project links">
            <a href="https://github.com/tlkh" target="_blank" rel="noopener noreferrer">GitHub <span>@tlkh</span></a>
            <a href="https://www.instagram.com/tlkh/" target="_blank" rel="noopener noreferrer">Instagram <span>@tlkh</span></a>
            <a class="sf-source-link" href="https://github.com/tlkh/ops-crimson-eagle" target="_blank" rel="noopener noreferrer">View source on GitHub <span aria-hidden="true">↗</span></a>
          </nav>
        </footer>
      </div>`;
    const grid = menu.querySelector<HTMLElement>('[data-campaign-grid]')!;
    ordered.slice(0, 2).forEach((campaign, index) => {
      const c = campaignCopy(campaign);
      const card = document.createElement('button');
      card.className = `sf-campaign-card sf-campaign-card--${c.paint}`;
      card.type = 'button';
      card.dataset.campaign = campaign.id;
      card.setAttribute('aria-label', `Choose ${campaign.name} campaign`);
      card.innerHTML = `
        <span class="sf-campaign-top"><span class="sf-index">${index ? '02' : '01'}</span><span class="sf-campaign-date">${escapeText(c.date)}</span></span>
        <span class="sf-campaign-title">${escapeText(campaign.name)}</span>
        <span class="sf-campaign-subtitle">${escapeText(campaign.subtitle)}</span>
        <span class="sf-campaign-art"><img src="${import.meta.env.BASE_URL}assets/${c.paint === 'sg' ? 'seruyan-satellite-fire.webp' : 'ketapang-satellite-fire.webp'}" alt="Satellite-inspired view of ${c.paint === 'sg' ? 'Seruyan' : 'Ketapang'} with fire and smoke" /><span class="sf-region-caption"><b>${escapeText(c.location)}</b><small>Satellite illustration</small></span></span>
        <span class="sf-campaign-copy">${escapeText(c.copy)}</span>
        ${fleetMarkup(campaign)}
        <span class="sf-kit-line">${kitMarkup(campaign)}</span>
        <span class="sf-select-line"><span>View ${campaign.missions.length} missions</span><span class="sf-select-arrow" aria-hidden="true">${icon('arrow')}</span></span>`;
      card.addEventListener('click', event => renderMissions(campaign, event));
      grid.appendChild(card);
      loadFleet(campaign);
    });
    enterMenu(firstVisit ? 'initial' : 'back', event);
    menuHasOpened = true;
    if (event && selectedCampaignId) menu.querySelector<HTMLButtonElement>(`[data-campaign="${selectedCampaignId}"]`)?.focus({ preventScroll: true });
  };

  const renderMissions = (campaign: Campaign, event?: Event) => {
    selectedCampaignId = campaign.id;
    const c = campaignCopy(campaign);
    const missions = campaign.missions;
    menu.innerHTML = `
      <div class="sf-menu-inner sf-mission-screen">
        <button class="sf-back-button" type="button" data-back>${icon('arrow')} All campaigns</button>
        <div class="sf-mission-heading"><div><span class="sf-mission-region">${escapeText(c.location)} · ${escapeText(c.date)}</span><h1 tabindex="-1">${escapeText(campaign.name)}</h1><span class="sf-mission-evidence">${escapeText(campaign.subtitle)}</span><p>${escapeText(c.copy)}</p></div><div class="sf-mission-fleet">${fleetMarkup(campaign)}<div class="sf-operation-facts">${kitMarkup(campaign)}</div></div></div>
        <div class="sf-mission-section-head"><h2>Choose a sortie</h2><span>${missions.length} missions · about 5 minutes each</span></div>
        <div class="sf-mission-list" data-mission-list></div>
        <footer class="sf-menu-footer"><span>${escapeText(campaign.operator)}</span><span>${escapeText(c.date)}</span></footer>
      </div>`;
    menu.querySelector('[data-back]')!.addEventListener('click', renderCampaigns);
    loadFleet(campaign);
    enterMenu('forward', event);
    if (event instanceof MouseEvent && event.detail === 0) menu.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    const list = menu.querySelector<HTMLElement>('[data-mission-list]')!;
    let saved: Record<string, { score?: number; outcome?: string }> = {};
    try {
      const raw = localStorage.getItem(`progress:${campaign.id}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as typeof saved;
      }
    } catch { /* A blocked or malformed local save keeps later sorties locked. */ }
    missions.forEach((mission, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sf-mission-row';
      const training = /training|practice/i.test(mission.title);
      const previous = i > 0 ? missions[i - 1] : undefined;
      const unlocked = training || !previous || saved[previous.id]?.outcome === 'success';
      const lockNote = !unlocked && previous ? `Complete “${previous.title}” successfully to unlock this sortie.` : '';
      button.disabled = !unlocked;
      if (!unlocked) button.classList.add('is-locked');
      button.setAttribute('aria-label', unlocked ? `Launch ${mission.title}` : `${mission.title}. Locked. ${lockNote}`);
      button.innerHTML = `<span class="sf-mission-index">${String(i + 1).padStart(2, '0')}</span><span class="sf-mission-main"><span class="sf-mission-meta">${unlocked ? `${escapeText(mission.date)}${training ? ' · TRAINING' : ` · ${mission.requiredDrops} WATER RELEASES`}` : 'LOCKED · PREVIOUS SORTIE REQUIRED'}</span><strong>${escapeText(mission.title)}</strong><span>${escapeText(unlocked ? mission.description : lockNote)}</span></span><span class="sf-mission-go" aria-hidden="true">${icon(unlocked ? 'arrow' : 'lock')}</span>`;
      if (unlocked) button.addEventListener('click', () => callbacks.onSelect(campaign.id, mission.id));
      list.appendChild(button);
    });
  };

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
    by('[data-map]').setAttribute('aria-pressed', String(mapOpen));
    dispatchCommand('map');
  });
  on('[data-close-map]', 'click', () => {
    mapOpen = false;
    mapPanel.hidden = true;
    by('[data-map]').setAttribute('aria-pressed', 'false');
    dispatchCommand('map');
  });
  on('[data-pause]', 'click', () => {
    if (mapOpen) {
      mapOpen = false;
      mapPanel.hidden = true;
      by('[data-map]').setAttribute('aria-pressed', 'false');
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
      const dx = clamp((event.clientX - (rect.left + rect.width / 2)) / maxTravel, -1, 1);
      const dy = clamp(((rect.top + rect.height / 2) - event.clientY) / maxTravel, -1, 1);
      const magnitude = Math.hypot(dx, dy);
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const x = Math.abs(dx * scale) < .055 ? 0 : dx * scale;
      const y = Math.abs(dy * scale) < .055 ? 0 : dy * scale;
      knob.style.transform = `translate(calc(-50% + ${x * maxTravel}px), calc(-50% - ${y * maxTravel}px))`;
      // Positive aircraft yaw turns left; the knob still follows the pointer.
      if (side === 'left') { setAxis('yaw', -x); setAxis('climb', y); }
      else { setAxis('cyclicX', x); setAxis('cyclicY', y); }
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
      const x = side === 'left' ? -horizontal : horizontal;
      const y = e.key === 'ArrowUp' ? amount : e.key === 'ArrowDown' ? -amount : 0;
      if (side === 'left') { setAxis('yaw', x); setAxis('climb', y); }
      else { setAxis('cyclicX', x); setAxis('cyclicY', y); }
      knob.style.transform = `translate(calc(-50% + ${horizontal * 30}px), calc(-50% - ${y * 30}px))`;
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
    renderCampaigns();
    if (returningFromGame) menu.querySelector<HTMLButtonElement>('.sf-campaign-card')?.focus();
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
      return: campaign.id === 'jp_ketapang_2026_09' && state.bucketAttached ? 'Land at the shore pad to remove the bucket' : 'Return to the ship deck',
      shore_unrig: 'Remove the bucket at the shore pad',
      deck_rig: state.bucketAttached ? 'Secure the bucket on the flight deck' : 'Attach the bucket on the flight deck',
      land: 'Settle onto the ship deck',
      debrief: 'Review the sortie debrief',
      failed: 'Review the sortie result',
    };
    const nextTitle = objectiveAction ? contextualActions[objectiveAction].title : nextStepByPhase[state.phase];
    const activeOperation = (() => {
      if (extended.dumping) {
        const startLitres = Math.max(0, extended.dumpStartedWithLitres);
        const releasedPercent = startLitres > 0 ? clamp((startLitres - bucketLitres) / startLitres, 0, 1) : 0;
        return {
          title: 'Releasing water',
          detail: `Releasing load · ${Math.round(releasedPercent * 100)}% released · ${fmtWater(bucketLitres)} remaining.`,
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
      if (guidance.label === 'Freshwater lake' && state.bucketAttached) {
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
    by('[data-objective-title]').textContent = `${activeOperation ? 'In progress' : 'Next'}: ${activeOperation?.title ?? nextTitle}`;
    by('[data-objective-detail]').textContent = objectiveDetail;
    const announcement = activeOperation
      ? `Bucket operation in progress: ${activeOperation.title}.`
      : objectiveAction
      ? `Next step: ${contextualActions[objectiveAction].title}. Action ready.`
      : `Next step: ${nextStepByPhase[state.phase]}.`;
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
  return {
    showMenu,
    showGame,
    setPaused,
    getSceneHost: () => sceneHost,
    dispose() {
      disposed = true;
      for (const animation of menuAnimations) animation.cancel();
      menuAnimations.clear();
      releaseSticks();
      callbacks.onControls({ yaw: 0, climb: 0, cyclicX: 0, cyclicY: 0 });
      root.innerHTML = '';
      root.classList.remove('sf-root');
    },
  };
}
