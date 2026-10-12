import type { Campaign, CampaignId, Mission } from '../types';
import { loadCheckpoint } from '../persistence';
import { buildBriefingMapModel, renderBriefingMap } from './briefingMap';
import { createLaunchGuard, isMissionUnlocked, selectInitialMission, summarizeCheckpoint } from './menuState';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M13 5l7 7-7 7"/></svg>';
const lock = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';

type MenuOptions = {
  onLaunch(campaignId: CampaignId, missionId: string): Promise<void>;
  musicButton(): string;
  musicCredits(): string;
  syncMusic(): void;
};
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


function lightingPeriod(minutes: number): string {
  const hour = (minutes % 1440) / 60;
  return hour < 6 ? 'Dawn' : hour < 11 ? 'Morning' : hour < 16 ? 'Noon' : hour < 18 ? 'Sunset' : hour < 20 ? 'Dusk' : 'Night';
}
function missionSummary(mission: Mission): string {
  const start = lightingPeriod(mission.timeOfDay.startMinutes).toLowerCase();
  const startPhrase = start === 'morning' ? 'in the morning' : `at ${start}`;
  const riggingSite = mission.shore ? 'at the coastal airbase' : 'on the ship';
  return `Flight begins ${startPhrase}; rig the bucket ${riggingSite}, then collect water for the fire.`;
}
function progressFor(campaign: Campaign): unknown {
  try { return JSON.parse(localStorage.getItem(`progress:${campaign.id}`) || '{}'); }
  catch { return {}; }
}

export function createMenu(menu: HTMLElement, campaigns: Campaign[], options: MenuOptions) {
  menu.classList.add('cm-menu');
  const narrow = matchMedia('(max-width: 767px)');
  const preferred = new Map<CampaignId, string>();
  const listScroll = new Map<CampaignId, number>();
  const launch = createLaunchGuard();
  const animations = new Set<Animation>();
  let campaignId: CampaignId | undefined;
  let activeCampaign: Campaign | undefined;
  let selected: Mission | undefined;
  let mobileView: 'list' | 'briefing' = 'list';
  let campaignScroll = 0;
  let briefingRevision = 0;
  let opened = false;
  let disposed = false;

  const keyboardEvent = (event?: Event) => event instanceof KeyboardEvent || event instanceof MouseEvent && event.detail === 0;
  function animate(target: HTMLElement | null, direction: 'initial' | 'forward' | 'back' | 'detail', event?: Event) {
    for (const animation of animations) animation.cancel();
    animations.clear();
    if (!target || keyboardEvent(event) || !target.animate) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transform = reduced || direction === 'detail' ? 'none' : direction === 'initial' ? 'translateY(6px)' : `translateX(${direction === 'back' ? -10 : 10}px)`;
    const animation = target.animate([{ opacity: 0, transform }, { opacity: 1, transform: 'none' }], {
      duration: reduced ? 80 : direction === 'initial' ? 220 : direction === 'detail' ? 140 : 180,
      easing: 'cubic-bezier(.23,1,.32,1)',
    });
    animations.add(animation);
    animation.onfinish = () => animations.delete(animation);
  }
  function fleet(campaign: Campaign) {
    const c = campaignCopy(campaign);
    return `<div class="cm-fleet" data-fleet="${campaign.id}"><img width="1200" height="420" alt="Side view of ${escape(c.aircraft)} flying alongside ${escape(c.ship)}" hidden><span>Preparing aircraft and ship view…</span></div>`;
  }
  function loadFleet(campaign: Campaign) {
    const target = menu.querySelector<HTMLElement>(`[data-fleet="${campaign.id}"]`);
    if (!target) return;
    requestAnimationFrame(() => {
      if (disposed || !target.isConnected) return;
      void import('../render/campaignFleet').then(m => m.renderCampaignFleet(campaign)).then(async url => {
        if (disposed || !target.isConnected) return;
        const image = target.querySelector('img')!;
        image.src = url;
        await image.decode().catch(() => undefined);
        if (disposed || !target.isConnected) return;
        image.hidden = false;
        target.querySelector('span')?.remove();
      }).catch(() => {
        if (target.isConnected) target.querySelector('span')!.textContent = 'Fleet preview unavailable. Aircraft and ship details below.';
      });
    });
  }
  function kit(campaign: Campaign) {
    const c = campaignCopy(campaign);
    return `<div class="cm-kit"><span><small>Aircraft</small><strong>${escape(c.aircraft)}</strong></span><span><small>Home ship</small><strong>${escape(c.ship)}</strong></span></div>`;
  }
  function footer() {
    return `<footer class="cm-footer"><p>Created by <strong>Timothy Liu</strong></p><nav aria-label="Author and project links"><a href="https://github.com/tlkh" target="_blank" rel="noopener noreferrer">GitHub @tlkh</a><a href="https://www.instagram.com/tlkh/" target="_blank" rel="noopener noreferrer">Instagram @tlkh</a><a href="https://github.com/tlkh/ops-crimson-eagle" target="_blank" rel="noopener noreferrer">View source</a></nav>${options.musicCredits()}</footer>`;
  }
  function showCampaigns(event?: Event) {
    if (disposed || launch.pending) return;
    briefingRevision += 1;
    activeCampaign = undefined;
    selected = undefined;
    menu.innerHTML = `<div class="cm-shell"><header class="cm-header"><div class="cm-brand"><img src="${import.meta.env.BASE_URL}assets/crimson-eagle-mark.png" width="64" height="64" alt=""><div class="cm-brand-copy"><h1>Ops Crimson Eagle</h1><p>Water where the fire needs it.</p></div></div><div class="cm-tools">${options.musicButton()}</div></header><div class="cm-section-head"><h2>Choose deployment</h2><span>02 campaigns</span></div><div class="cm-campaign-grid"></div>${footer()}</div>`;
    const grid = menu.querySelector('.cm-campaign-grid')!;
    [...campaigns].sort((a, b) => Number(b.id.startsWith('sg_')) - Number(a.id.startsWith('sg_'))).forEach((campaign, i) => {
      const c = campaignCopy(campaign);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cm-campaign-card';
      card.dataset.campaign = campaign.id;
      card.setAttribute('aria-current', String(campaignId === campaign.id));
      card.setAttribute('aria-label', `Choose ${campaign.name} campaign`);
      card.innerHTML = `<span class="cm-card-top"><span>${String(i + 1).padStart(2, '0')}</span><span>${escape(c.date)}</span></span><h2>${escape(campaign.name)}</h2><span class="cm-evidence">${escape(campaign.subtitle)}</span><span class="cm-location">${escape(c.location)}</span>${fleet(campaign)}${kit(campaign)}<span class="cm-card-action"><span>View ${campaign.missions.length} missions</span>${arrow}</span>`;
      card.addEventListener('click', e => { if (launch.pending) return; campaignScroll = menu.scrollTop; showMissions(campaign, e); });
      grid.appendChild(card);
      loadFleet(campaign);
    });
    options.syncMusic();
    menu.scrollTop = event ? campaignScroll : 0;
    animate(menu.querySelector(opened ? '.cm-shell' : '.cm-campaign-grid'), opened ? 'back' : 'initial', event);
    opened = true;
    if (event && campaignId) menu.querySelector<HTMLElement>(`[data-campaign="${campaignId}"]`)?.focus({ preventScroll: true });
  }
  function showMissions(campaign: Campaign, event?: Event) {
    if (launch.pending) return;
    activeCampaign = campaign;
    campaignId = campaign.id;
    const progress = progressFor(campaign);
    selected = selectInitialMission(campaign, progress, preferred.get(campaign.id));
    preferred.set(campaign.id, selected.id);
    mobileView = 'list';
    const c = campaignCopy(campaign);
    menu.innerHTML = `<div class="cm-shell" data-mobile-view="list"><div class="cm-toolbar"><button type="button" class="cm-back" data-campaign-back>${arrow}<span>All campaigns</span></button>${options.musicButton()}</div><header class="cm-campaign-heading"><span class="cm-location">${escape(c.location)} · ${escape(c.date)}</span><h1 tabindex="-1">${escape(campaign.name)}</h1><p class="cm-evidence">${escape(campaign.subtitle)}</p><details><summary>Deployment context</summary><p>${escape(c.copy)}</p></details></header><button type="button" class="cm-back cm-briefing-back" data-list-back>${arrow}<span>All missions</span></button><div class="cm-workspace"><section class="cm-missions" aria-label="Sortie selection"><h2>Choose a sortie</h2><p>6 missions · about 5 simulated minutes each</p><div class="cm-mission-list"></div></section><section class="cm-briefing" aria-label="Mission briefing"><div class="cm-briefing-scroll"><div class="cm-briefing-copy"></div><figure class="cm-map-panel" data-map-expanded="false"><div class="cm-map" id="briefing-map-preview"></div><figcaption><span class="cm-map-caption">Gameplay terrain · daylight overview</span><button type="button" class="cm-map-toggle" data-map-toggle aria-expanded="false" aria-controls="briefing-map-preview">Expand map</button></figcaption></figure><div class="cm-briefing-body"></div></div><div class="cm-launch-area"><button type="button" class="cm-launch" disabled><span><strong>Checking saved sortie…</strong><small>Looking for an in-progress checkpoint.</small></span>${arrow}</button><p class="cm-error" role="alert" hidden></p></div></section></div><footer class="cm-footer"><p>${escape(campaign.operator)}</p>${options.musicCredits()}</footer></div>`;
    menu.querySelector('[data-campaign-back]')!.addEventListener('click', showCampaigns);
    menu.querySelector('[data-list-back]')!.addEventListener('click', backToList);
    menu.querySelector<HTMLButtonElement>('[data-map-toggle]')!.addEventListener('click', event => {
      const button = event.currentTarget as HTMLButtonElement;
      const panel = menu.querySelector<HTMLElement>('.cm-map-panel')!;
      const expanded = panel.dataset.mapExpanded !== 'true';
      panel.dataset.mapExpanded = String(expanded);
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? 'Collapse map' : 'Expand map';
    });
    const list = menu.querySelector('.cm-mission-list')!;
    campaign.missions.forEach((mission, i) => {
      const unlocked = isMissionUnlocked(campaign, mission.id, progress);
      const note = !unlocked ? `Complete “${campaign.missions[i - 1]?.title}” successfully to unlock.` : `${mission.date} · ${mission.requiredDrops} useful ${mission.requiredDrops === 1 ? 'drop' : 'drops'}`;
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'cm-mission-row'; row.dataset.mission = mission.id; row.disabled = !unlocked;
      row.setAttribute('aria-pressed', String(selected?.id === mission.id));
      row.setAttribute('aria-label', unlocked ? `Briefing for ${mission.title}` : `${mission.title}. Locked. ${note}`);
      row.innerHTML = `<span class="cm-number">${String(i + 1).padStart(2, '0')}</span><span class="cm-row-copy"><strong>${escape(mission.title)}</strong><small>${escape(note)}</small></span><span class="cm-row-icon">${unlocked ? arrow : lock}</span>`;
      row.addEventListener('click', e => {
        if (launch.pending || !isMissionUnlocked(campaign, mission.id, progressFor(campaign))) return;
        selected = mission; preferred.set(campaign.id, mission.id);
        listScroll.set(campaign.id, menu.scrollTop);
        mobileView = 'briefing';
        menu.querySelector<HTMLElement>('.cm-shell')!.dataset.mobileView = mobileView;
        renderBriefing(campaign, mission, e);
        if (narrow.matches) menu.scrollTop = 0;
        if (keyboardEvent(e) || narrow.matches) menu.querySelector<HTMLElement>('.cm-briefing h2')?.focus({ preventScroll: true });
      });
      list.appendChild(row);
    });
    renderBriefing(campaign, selected);
    options.syncMusic();
    menu.scrollTop = listScroll.get(campaign.id) ?? 0;
    animate(menu.querySelector('.cm-shell'), 'forward', event);
    if (keyboardEvent(event)) menu.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
  function backToList(event: Event) {
    if (launch.pending || !activeCampaign) return;
    mobileView = 'list';
    menu.querySelector<HTMLElement>('.cm-shell')!.dataset.mobileView = mobileView;
    menu.scrollTop = listScroll.get(activeCampaign.id) ?? 0;
    menu.querySelector<HTMLElement>(`[data-mission="${selected?.id}"]`)?.focus({ preventScroll: true });
    animate(menu.querySelector('.cm-missions'), 'back', event);
  }
  function renderBriefing(campaign: Campaign, mission: Mission, event?: Event) {
    const revision = ++briefingRevision;
    const isCurrentBriefing = () => !disposed && revision === briefingRevision
      && selected === mission && activeCampaign === campaign;
    menu.querySelectorAll<HTMLButtonElement>('[data-mission]').forEach(row => row.setAttribute('aria-pressed', String(row.dataset.mission === mission.id)));
    const map = menu.querySelector<HTMLElement>('.cm-map')!;
    const mapPanel = menu.querySelector<HTMLElement>('.cm-map-panel')!;
    mapPanel.dataset.mapExpanded = 'false';
    const mapToggle = menu.querySelector<HTMLButtonElement>('[data-map-toggle]')!;
    mapToggle.setAttribute('aria-expanded', 'false');
    mapToggle.textContent = 'Expand map';
    map.innerHTML = renderBriefingMap(campaign, mission);
    map.setAttribute('aria-busy', 'true');
    const caption = menu.querySelector<HTMLElement>('.cm-map-caption')!;
    caption.textContent = 'Preparing terrain overview…';
    // Paint the selected mission immediately; the temporary renderer returns a cached image.
    requestAnimationFrame(() => {
      if (!isCurrentBriefing() || !map.isConnected) return;
      void import('../render/briefingTerrain').then(({ renderBriefingTerrain }) =>
        renderBriefingTerrain(campaign, mission, buildBriefingMapModel(campaign, mission)),
      ).then(image => {
        if (!isCurrentBriefing() || !map.isConnected) return;
        map.innerHTML = renderBriefingMap(campaign, mission, image);
        map.removeAttribute('aria-busy');
        caption.textContent = 'Gameplay terrain · daylight overview · inland ↑';
      }).catch(() => {
        if (!isCurrentBriefing() || !map.isConnected) return;
        map.removeAttribute('aria-busy');
        caption.textContent = 'Terrain preview unavailable · route schematic shown';
      });
    });
    const panel = menu.querySelector<HTMLElement>('.cm-briefing')!;
    const index = campaign.missions.indexOf(mission) + 1;
    panel.querySelector<HTMLElement>('.cm-briefing-copy')!.innerHTML = `<p class="cm-evidence">${escape(campaign.name)} · ${escape(campaign.subtitle)}</p><span class="cm-eyebrow">Mission ${String(index).padStart(2, '0')} / ${mission.id.endsWith('01') ? 'Training' : 'Fire suppression'}</span><h2 tabindex="-1">${escape(mission.title)}</h2><p>${escape(mission.description)}</p>`;
    panel.querySelector<HTMLElement>('.cm-briefing-body')!.innerHTML = `${fleet(campaign)}${kit(campaign)}<details class="cm-lesson"><summary>Flying advice</summary><p>${escape(mission.lesson)}</p></details><div class="cm-facts"><p class="cm-summary">${escape(missionSummary(mission))}</p></div>`;
    loadFleet(campaign);
    const button = panel.querySelector<HTMLButtonElement>('.cm-launch')!;
    button.disabled = true;
    button.querySelector('strong')!.textContent = 'Checking saved sortie…';
    button.querySelector('small')!.textContent = 'Looking for an in-progress checkpoint.';
    panel.querySelector<HTMLElement>('.cm-error')!.hidden = true;
    button.onclick = () => { void launchMission(campaign, mission, revision); };
    void loadCheckpoint(campaign.id).then(checkpoint => {
      if (!isCurrentBriefing() || !button.isConnected) return;
      const summary = summarizeCheckpoint(checkpoint, campaign.id, mission.id);
      button.dataset.actionLabel = summary ? 'Resume sortie' : 'Launch sortie';
      button.dataset.actionSubtitle = summary?.subtitle ?? 'Start a new sortie at the launch point.';
      button.querySelector('strong')!.textContent = button.dataset.actionLabel;
      button.querySelector('small')!.textContent = button.dataset.actionSubtitle;
      button.disabled = false;
    }).catch(() => {
      if (!isCurrentBriefing() || !button.isConnected) return;
      button.dataset.actionLabel = 'Launch sortie';
      button.dataset.actionSubtitle = 'Start a new sortie at the launch point.';
      button.querySelector('strong')!.textContent = button.dataset.actionLabel;
      button.querySelector('small')!.textContent = button.dataset.actionSubtitle;
      button.disabled = false;
    });
    if (event) animate(panel.querySelector('.cm-briefing-copy'), 'detail', event);
  }
  async function launchMission(campaign: Campaign, mission: Mission, revision: number) {
    if (launch.pending || revision !== briefingRevision || selected !== mission || activeCampaign !== campaign
      || !isMissionUnlocked(campaign, mission.id, progressFor(campaign))) return;
    const button = menu.querySelector<HTMLButtonElement>('.cm-launch');
    if (!button || button.disabled) return;
    const error = menu.querySelector<HTMLElement>('.cm-error')!;
    button.disabled = true; button.querySelector('strong')!.textContent = 'Opening sortie…'; error.hidden = true;
    menu.setAttribute('aria-busy', 'true');
    try { await launch.run(() => options.onLaunch(campaign.id, mission.id)); }
    catch { if (!disposed && revision === briefingRevision && error.isConnected) { error.textContent = 'The sortie could not open. Please try again.'; error.hidden = false; } }
    finally {
      menu.removeAttribute('aria-busy');
      if (!disposed && revision === briefingRevision && button.isConnected) {
        button.disabled = false;
        button.querySelector('strong')!.textContent = button.dataset.actionLabel ?? 'Launch sortie';
        button.querySelector('small')!.textContent = button.dataset.actionSubtitle ?? 'Start a new sortie at the launch point.';
      }
    }
  }
  function onResize() {
    if (!activeCampaign || !selected || menu.hidden) return;
    const focused = document.activeElement as HTMLElement | null;
    if (focused && !focused.getClientRects().length) {
      const selector = narrow.matches && mobileView === 'list' ? `[data-mission="${selected.id}"]` : '.cm-briefing h2';
      menu.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }
  }
  narrow.addEventListener('change', onResize);
  return { showCampaigns, dispose() { disposed = true; narrow.removeEventListener('change', onResize); for (const a of animations) a.cancel(); animations.clear(); } };
}
