import { createScene, type SceneCameraPose } from '../../src/render';
import { getCampaign, getMission } from '../../src/content';
import { bucketSurfaceHeight, BUCKET_BODY_HEIGHT_M } from '../../src/sim/bucket';
import { createSim } from '../../src/sim';
import { recordSortie } from './pilot';
import { WaterPacketReplay } from './packetReplay';
import { renderTrailerAudio } from './audio';
import type { ExtendedSimState } from '../../src/sim/types';

// This page is a development entrypoint, not imported by the shipping game.
if (!import.meta.env.DEV) throw new Error('Trailer capture is development-only');
const width = innerWidth, height = innerHeight, portrait = height > width;
const root = document.querySelector<HTMLElement>('#scene')!;
root.replaceChildren();
root.style.position = 'relative';
root.style.width = '100%';
root.style.height = '100%';

function makeViewport(zIndex: number) {
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'absolute', left: '0px', top: '0px', overflow: 'hidden', zIndex: String(zIndex),
  });
  root.appendChild(element);
  return element;
}

const primaryHost = makeViewport(1);
const secondaryHost = makeViewport(2);
const setHostBox = (host: HTMLElement, x: number, y: number, w: number, h: number) => {
  host.style.left = `${x}px`; host.style.top = `${y}px`;
  host.style.width = `${w}px`; host.style.height = `${h}px`;
};
setHostBox(primaryHost, 0, 0, width, height);
setHostBox(secondaryHost, 0, 0, width, height);
secondaryHost.style.visibility = 'hidden';

// Each side of the split has its own renderer and world. This keeps the two
// sorties, packet identities, reflection targets, and camera histories separate.
const view = createScene(primaryHost, { externalClock: true, pixelRatio: 1 });
const secondView = createScene(secondaryHost, { externalClock: true, pixelRatio: 1 });
const output = document.createElement('canvas');
output.width = width; output.height = height;
const ctx = output.getContext('2d')!;
const face = new FontFace('Trailer', `url(${import.meta.env.BASE_URL}fonts/Rajdhani-SemiBold.ttf)`);
await face.load(); document.fonts.add(face);

type Recording = ReturnType<typeof recordSortie>;
type CampaignKey = 'sg_fictional_2026_10' | 'jp_ketapang_2026_09';
function sortie(id: CampaignKey, missionId: string): Recording {
  const campaign = getCampaign(id)!, mission = getMission(id, missionId)!;
  // Build actual scenery and colliders before the headless sortie is piloted.
  view.update(createSim(campaign, mission), campaign, mission);
  return recordSortie(id, missionId);
}

const sg = sortie('sg_fictional_2026_10', 'SG-01');
const jpDawn = sortie('jp_ketapang_2026_09', 'JP-01');
const jpDusk = sortie('jp_ketapang_2026_09', 'JP-04');
const jp = sortie('jp_ketapang_2026_09', 'JP-02');
const sgDusk = sortie('sg_fictional_2026_10', 'SG-04');
const jpNight = sortie('jp_ketapang_2026_09', 'JP-05');
// Prepare both persistent capture worlds before exposing the frame API. The
// renderer host can then size each view for its actual panel before drawing.
view.update(createSim(sgDusk.campaign, sgDusk.mission), sgDusk.campaign, sgDusk.mission);
secondView.update(createSim(jp.campaign, jp.mission), jp.campaign, jp.mission);

const find = (r: Recording, predicate: (state: ExtendedSimState) => boolean, label = 'shot event') => {
  const index = r.frames.findIndex(predicate);
  if (index < 0) throw new Error(`Missing ${label} in ${r.mission.id}`);
  return index;
};
const findAfter = (r: Recording, start: number, predicate: (state: ExtendedSimState) => boolean, label = 'follow-up event') => {
  const index = r.frames.findIndex((state, i) => i > start && predicate(state));
  if (index < 0) throw new Error(`Missing ${label} in ${r.mission.id} after frame ${start}`);
  return index;
};
const dumpEvents = (r: Recording) => r.frames.flatMap((state, i) =>
  state.dumping && (i === 0 || !r.frames[i - 1].dumping) ? [i] : []);
const dropAt = (r: Recording, event = 0) => {
  const index = dumpEvents(r)[event];
  if (index === undefined) throw new Error(`Missing water release ${event + 1} in ${r.mission.id}`);
  return index;
};
const rimCleared = (r: Recording, state: ExtendedSimState) => state.bucketAttached &&
  state.bucket.y - BUCKET_BODY_HEIGHT_M > bucketSurfaceHeight(r.campaign, r.mission, state.bucket.x, state.bucket.z) + .6;

const sgDrop = dropAt(sg);
const sgFill = find(sg, state => state.waterLitres > 10, 'water pickup');
const sgShipDeparture = findAfter(sg, 89, state => rimCleared(sg, state) &&
  Math.hypot(state.velocity.x, state.velocity.z) > 3, 'Singapore ship departure');
const jpShipDeparture = findAfter(jpDawn, 89, state => state.phase === 'depart' && state.position.y > 4, 'Japan ship departure');
const sgDuskBucketAttach = find(sgDusk, state => state.bucketAttached, 'Singapore deck sling attachment');
const sgDuskDrop = dropAt(sgDusk);
const jpShoreStart = find(jp, state => state.phase === 'shore_rig', 'Japan airbase arrival');
const jpBucketAttach = findAfter(jp, jpShoreStart, state => state.bucketAttached, 'Japan bucket rigging');
const jpBucketClear = findAfter(jp, jpBucketAttach, state => rimCleared(jp, state), 'Japan bucket lift-off');
const jpFinalDrop = dropAt(jpNight, 2);
const jpNightReturn = findAfter(jpNight, jpFinalDrop, state => state.phase === 'return' && state.position.y > 45, 'night return flight');
const jpDayFlight = findAfter(jp, jpBucketClear + 60,
  state => state.phase === 'transit' && state.position.y > 45, 'daylight flight after airbase departure');

type CameraKind = 'bucket' | 'drop' | 'ship' | 'side' | 'route' | 'airbase' | 'lift' | 'flyby';
type Clip = { r: Recording; source: number; camera: CameraKind };
type FullShot = { id: string; seconds: number; layout: 'full'; source: Clip; start: number };
type SplitShot = { id: string; seconds: number; layout: 'split'; singapore: Clip; japan: Clip; start: number };
type Shot = FullShot | SplitShot;
type PlannedShot = Omit<FullShot, 'start'> | Omit<SplitShot, 'start'>;
const plan: PlannedShot[] = [
  { id: 'lake-pickup', seconds: 3, layout: 'full', source: { r: sg, source: Math.max(0, sgFill - 28), camera: 'bucket' } },
  { id: 'fire-suppression', seconds: 5, layout: 'full', source: { r: sg, source: sgDrop, camera: 'drop' } },
  {
    id: 'dawn-ship-departure-split', seconds: 4, layout: 'split',
    singapore: { r: sg, source: sgShipDeparture, camera: 'side' },
    japan: { r: jpDawn, source: jpShipDeparture, camera: 'side' },
  },
  {
    id: 'dusk-firefighting-split', seconds: 4, layout: 'split',
    singapore: { r: sgDusk, source: sgDuskDrop, camera: 'drop' },
    japan: { r: jpDusk, source: dropAt(jpDusk), camera: 'drop' },
  },
  { id: 'singapore-bucket-liftoff', seconds: 7, layout: 'full', source: { r: sgDusk, source: sgDuskBucketAttach + 60, camera: 'lift' } },
  { id: 'japan-airbase-approach', seconds: 4, layout: 'full', source: { r: jp, source: Math.max(0, jpShoreStart - 120), camera: 'route' } },
  { id: 'japan-bucket-rigging', seconds: 4, layout: 'full', source: { r: jp, source: Math.max(0, jpBucketAttach - 120), camera: 'airbase' } },
  { id: 'japan-bucket-liftoff', seconds: 4, layout: 'full', source: { r: jp, source: Math.max(jpBucketAttach, jpBucketClear - 60), camera: 'lift' } },
  { id: 'daylight-flight', seconds: 3, layout: 'full', source: { r: jp, source: jpDayFlight, camera: 'route' } },
  { id: 'dusk-fire', seconds: 3, layout: 'full', source: { r: sgDusk, source: dropAt(sgDusk, 1), camera: 'drop' } },
  { id: 'night-return', seconds: 4, layout: 'full', source: { r: jpNight, source: jpNightReturn, camera: 'flyby' } },
];

let cursor = 0;
const shots: Shot[] = plan.map(shot => {
  const withStart = { ...shot, start: cursor } as Shot;
  cursor += shot.seconds * 30;
  return withStart;
});
const durationSeconds = cursor / 30;
const frameCount = cursor;
if (durationSeconds !== 45) throw new Error(`Trailer timeline is ${durationSeconds}s, expected 45s`);

// Every visible source frame belongs to one output window. This also checks
// the simultaneous left/right panels and prevents a cut from replaying footage.
const usedRanges: { r: Recording; start: number; end: number; shot: string; lane: string }[] = [];
function reserve(shot: Shot, lane: string, clip: Clip) {
  const start = clip.source, end = start + shot.seconds * 30;
  if (start < 0 || end > clip.r.frames.length) {
    throw new Error(`Shot ${shot.id} ${lane} exceeds ${clip.r.mission.id}: ${start}-${end}/${clip.r.frames.length}`);
  }
  for (const prior of usedRanges) {
    if (prior.r === clip.r && start < prior.end && prior.start < end) {
      throw new Error(`Shots ${prior.shot} (${prior.lane}) and ${shot.id} (${lane}) repeat ${clip.r.mission.id} frames`);
    }
  }
  usedRanges.push({ r: clip.r, start, end, shot: shot.id, lane });
}
for (const shot of shots) {
  if (shot.layout === 'full') reserve(shot, 'full', shot.source);
  else { reserve(shot, 'Singapore', shot.singapore); reserve(shot, 'Japan', shot.japan); }
}

const currentPanel = () => portrait
  ? { banner: 270, width, height: Math.floor((height - 270) / 2) }
  : { banner: 185, width: Math.floor(width / 2), height: height - 185 };
let activeLayout: 'full' | 'split' | undefined;
function nextAnimationFrame() { return new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
async function prepareLayout(layout: 'full' | 'split') {
  if (layout === 'split') {
    const panel = currentPanel();
    setHostBox(primaryHost, 0, portrait ? 0 : panel.banner, panel.width, panel.height);
    setHostBox(secondaryHost, portrait ? 0 : panel.width, portrait ? panel.banner + panel.height : panel.banner,
      portrait ? width : width - panel.width, portrait ? height - panel.banner - panel.height : panel.height);
    secondaryHost.style.visibility = 'visible';
  } else {
    setHostBox(primaryHost, 0, 0, width, height);
    setHostBox(secondaryHost, 0, 0, width, height);
    secondaryHost.style.visibility = 'hidden';
  }
  if (activeLayout !== layout) {
    activeLayout = layout;
    await nextAnimationFrame();
    await nextAnimationFrame();
    // ResizeObserver updates renderer buffers and camera aspect before capture.
    const expectedPrimaryWidth = layout === 'full' ? width : currentPanel().width;
    const expectedPrimaryHeight = layout === 'full' ? height : currentPanel().height;
    if (view.diagnostics().width !== expectedPrimaryWidth || view.diagnostics().height !== expectedPrimaryHeight) {
      await nextAnimationFrame();
    }
  }
}

function clipFor(shot: Shot, lane: 'primary' | 'secondary' = 'primary'): Clip {
  if (shot.layout === 'full') return shot.source;
  return lane === 'primary' ? shot.singapore : shot.japan;
}
const replays = [new WaterPacketReplay(), new WaterPacketReplay()];
function stateFor(clip: Clip, offset: number): ExtendedSimState {
  const index = clip.source + offset;
  if (index < 0 || index >= clip.r.frames.length) throw new Error(`Shot source exceeds ${clip.r.mission.id} at frame ${index}`);
  return clip.r.frames[index];
}
function updateView(which: 0 | 1, clip: Clip, offset: number): ExtendedSimState {
  const state = stateFor(clip, offset);
  const playback = replays[which].apply(state, clip.r.framePacketIds[clip.source + offset]);
  (which === 0 ? view : secondView).update(playback, clip.r.campaign, clip.r.mission);
  return state;
}
function pose(clip: Clip, state: ExtendedSimState, progress: number, aspect: number): SceneCameraPose {
  const p = state.position, bucket = state.bucket;
  let target = { x: p.x, y: p.y + (state.bucketAttached ? -10 : 0), z: p.z };
  const panel = aspect < 1.45;
  let distance = panel ? 122 : portrait ? 86 : 66, elevation = 22, angle = .8 + progress * .16;
  if (clip.camera === 'ship') {
    distance = 88; elevation = 24;
    angle = .78 + progress * .18; target = { x: p.x, y: p.y - 1, z: p.z - 4 };
  }
  if (clip.camera === 'side') {
    distance = panel ? 108 : portrait ? 110 : 92; elevation = 24; angle = .65 + progress * .16;
    target = { x: p.x, y: p.y - 2, z: p.z };
  }
  if (clip.camera === 'route') {
    distance = panel ? 165 : portrait ? 180 : 190; elevation = 58; angle = .9 + progress * .10;
    target = { x: p.x, y: p.y + 8, z: p.z };
  }
  if (clip.camera === 'airbase') {
    distance = panel ? 76 : portrait ? 90 : 80; elevation = panel ? 28 : portrait ? 36 : 30;
    angle = .95 + progress * .08; target = { x: p.x, y: p.y + 3, z: p.z };
  }
  if (clip.camera === 'bucket') {
    target = { x: bucket.x, y: bucket.y + 9, z: bucket.z };
    distance = panel ? 90 : portrait ? 77 : 68; elevation = 14; angle = .92 + progress * .15;
  }
  if (clip.camera === 'drop') {
    target = { x: p.x, y: p.y - 20, z: p.z };
    distance = panel ? 102 : portrait ? 103 : 82; elevation = 32; angle = 1.1 + progress * .12;
  }
  if (clip.camera === 'lift') {
    target = { x: p.x, y: state.bucketAttached ? (p.y + bucket.y) / 2 : p.y - 8, z: p.z };
    distance = portrait ? 128 : 104; elevation = 23; angle = .72 + progress * .12;
  }
  if (clip.camera === 'flyby') {
    target = { x: p.x, y: p.y - 3, z: p.z };
    distance = panel ? 115 : portrait ? 94 : 78; elevation = -4; angle = 2.05 - progress * .42;
  }
  return { position: { x: target.x + Math.cos(angle) * distance, y: target.y + elevation, z: target.z + Math.sin(angle) * distance }, target, fov: panel ? 48 : portrait ? 49 : 45 };
}

// Tie reflection throttling to output time even though browser capture is offline.
let captureClock = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => captureClock });
function renderCurrent(shot: Shot, offset: number, progress: number) {
  captureClock += 1000 / 30;
  const primaryClip = clipFor(shot, 'primary');
  const primaryState = updateView(0, primaryClip, offset);
  const primaryAspect = primaryHost.clientWidth / Math.max(1, primaryHost.clientHeight);
  view.renderFrame(1 / 30, pose(primaryClip, primaryState, progress, primaryAspect));
  if (shot.layout === 'split') {
    const secondaryClip = clipFor(shot, 'secondary');
    const secondaryState = updateView(1, secondaryClip, offset);
    const secondaryAspect = secondaryHost.clientWidth / Math.max(1, secondaryHost.clientHeight);
    secondView.renderFrame(1 / 30, pose(secondaryClip, secondaryState, progress, secondaryAspect));
  }
}

function wrap(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/), lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function drawLowerThird(kicker: string, title: string[], support: string, time: number, start: number, end: number) {
  const alpha = Math.min(1, Math.max(0, (time - start) / .45), Math.max(0, (end - time) / .45));
  if (alpha <= 0) return;
  const margin = portrait ? 76 : 112;
  const y = portrait ? height * .76 : height * .73;
  const small = portrait ? 31 : 31 * width / 1920;
  const big = portrait ? 74 : 78 * width / 1920;
  const maxWidth = width - margin * 2;
  ctx.save(); ctx.globalAlpha = alpha;
  const shade = ctx.createLinearGradient(0, y - 110, 0, height);
  shade.addColorStop(0, 'rgba(3,12,15,0)'); shade.addColorStop(1, 'rgba(3,12,15,.82)');
  ctx.fillStyle = shade; ctx.fillRect(0, y - 110, width, height - y + 110);
  ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = 13; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  let cursorY = y;
  if (kicker) {
    ctx.fillStyle = '#d9e3d1'; ctx.font = `600 ${small}px Trailer`;
    for (const line of wrap(kicker, maxWidth)) { ctx.fillText(line, margin, cursorY); cursorY += small * 1.15; }
    cursorY += 16;
  }
  ctx.fillStyle = '#f8f5e9'; ctx.font = `600 ${big}px Trailer`;
  for (const text of title) {
    for (const line of wrap(text, maxWidth)) { ctx.fillText(line, margin, cursorY); cursorY += big * 1.03; }
  }
  if (support) {
    cursorY += 12; ctx.fillStyle = '#e2e9e1'; ctx.font = `600 ${small + 3}px Trailer`;
    for (const line of wrap(support, maxWidth)) { ctx.fillText(line, margin, cursorY); cursorY += (small + 3) * 1.16; }
  }
  ctx.restore();
}
function drawSplitCopy() {
  const panel = currentPanel(), message = 'Play as Singaporean or Japanese crews forward deployed to fight the peat fires';
  ctx.save();
  const bannerY = portrait ? panel.height : 0;
  const banner = ctx.createLinearGradient(0, bannerY, 0, bannerY + panel.banner);
  banner.addColorStop(0, 'rgba(3,10,13,.96)'); banner.addColorStop(1, 'rgba(3,10,13,.86)');
  ctx.fillStyle = banner; ctx.fillRect(0, bannerY, width, panel.banner);
  const fontSize = portrait ? 42 : 41 * width / 1920;
  ctx.font = `600 ${fontSize}px Trailer`; ctx.fillStyle = '#f8f5e9'; ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8;
  const lines = wrap(message, width - (portrait ? 96 : 190));
  const lineHeight = fontSize * 1.08;
  const firstY = bannerY + (panel.banner - (lines.length - 1) * lineHeight) / 2 + fontSize * .34;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, firstY + i * lineHeight));
  const labelFont = portrait ? 29 : 27 * width / 1920;
  ctx.font = `600 ${labelFont}px Trailer`; ctx.textAlign = 'left';
  const labelMargin = portrait ? 48 : 58;
  const labels: [number, number, number, string][] = portrait ? [
    [labelMargin, 0, width, 'RSAF CH-47F · RSS PERSISTENCE'],
    [labelMargin, panel.banner + panel.height, width, 'JGSDF CH-47 · JS KUNISAKI'],
  ] : [
    [labelMargin, 0, panel.width, 'RSAF CH-47F · RSS PERSISTENCE'],
    [panel.width + labelMargin, 0, width - panel.width, 'JGSDF CH-47 · JS KUNISAKI'],
  ];
  for (const [x, panelY, w, label] of labels) {
    const leftY = panelY + (portrait ? panel.height : height) - (portrait ? 40 : 42);
    ctx.fillStyle = 'rgba(3,10,13,.66)'; ctx.fillRect(x - 14, leftY - labelFont - 11, w - labelMargin, labelFont + 27);
    ctx.fillStyle = '#e9eee6'; ctx.fillText(label, x, leftY, Math.max(80, w - labelMargin * 2));
  }
  ctx.restore();
}
function drawCallToAction(time: number) {
  const alpha = Math.min(1, Math.max(0, (time - 35.15) / .5), Math.max(0, (45 - time) / .45));
  if (alpha <= 0) return;
  const margin = portrait ? 70 : 112, y = portrait ? height * .70 : height * .73;
  const fontSize = portrait ? 40 : 40 * width / 1920;
  const lineHeight = fontSize * 1.22;
  ctx.save(); ctx.globalAlpha = alpha;
  const shade = ctx.createLinearGradient(0, y - 70, 0, height);
  shade.addColorStop(0, 'rgba(3,12,15,0)'); shade.addColorStop(1, 'rgba(3,12,15,.84)');
  ctx.fillStyle = shade; ctx.fillRect(0, y - 70, width, height - y + 70);
  ctx.font = `600 ${fontSize}px Trailer`; ctx.fillStyle = '#f8f5e9';
  ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,.78)'; ctx.shadowBlur = 12;
  const maxWidth = width - margin * 2;
  const lines = [
    ...wrap('Play now at tlkh.github.io/ops-crimson-eagle', maxWidth),
    ...wrap('Do your part to protect Singapore from the haze', maxWidth),
  ];
  lines.forEach((line, i) => ctx.fillText(line, margin, y + i * lineHeight));
  ctx.restore();
}
function drawOpening(time: number) {
  const alpha = Math.min(1, Math.max(0, (time - .2) / .5), Math.max(0, (8 - time) / .45));
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const shade = ctx.createLinearGradient(0, 0, 0, portrait ? 360 : 300);
  shade.addColorStop(0, 'rgba(3,12,15,.60)'); shade.addColorStop(1, 'rgba(3,12,15,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, width, portrait ? 360 : 300);
  ctx.fillStyle = '#f8f5e9'; ctx.font = `600 ${portrait ? 64 : 62}px Trailer`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 12;
  ['Do your part to protect', 'Singapore from the haze'].forEach((line, i) =>
    ctx.fillText(line, portrait ? 70 : 96, (portrait ? 110 : 72) + i * 70));
  ctx.restore();
}
function drawOverlay(index: number) {
  const t = index / 30;
  if (t < 8) drawOpening(t);
  else if (t >= 8 && t < 16) drawSplitCopy();
  else if (t >= 16 && t < 23) drawLowerThird(
    'Campaign 01 / Seruyan Regency, Central Kalimantan', ['RSAF Deployment'], 'Fictional campaign', t, 16, 23,
  );
  else if (t >= 23 && t < 35) drawLowerThird(
    'Campaign 02 / Ketapang Regency, West Kalimantan', ['JSDF Deployment'], 'Reconstructed from an actual mission', t, 23, 35,
  );
  else if (t >= 35) drawCallToAction(t);
}

let previousShot = -1;
let previousFrame = -1;
async function frame(index: number, jpeg = true) {
  if (!Number.isInteger(index) || index < 0 || index >= frameCount) throw new Error(`Frame ${index} outside the trailer`);
  const shotIndex = shots.findIndex(shot => index >= shot.start && index < shot.start + shot.seconds * 30);
  if (shotIndex < 0) throw new Error('Frame outside edit');
  const shot = shots[shotIndex], local = index - shot.start;
  await prepareLayout(shot.layout);
  if (shotIndex !== previousShot || index !== previousFrame + 1) {
    replays.forEach(replay => replay.reset());
    const firstClip = clipFor(shot, 'primary');
    const secondClip = shot.layout === 'split' ? clipFor(shot, 'secondary') : undefined;
    // Two seconds of visual history also makes arbitrary preview-frame seeks stable.
    for (let pre = Math.max(-firstClip.source, secondClip ? -secondClip.source : -Infinity, local - 60); pre < local; pre++) {
      captureClock += 1000 / 30;
      const primaryState = updateView(0, firstClip, pre);
      view.renderFrame(1 / 30, pose(firstClip, primaryState, Math.max(0, pre) / (shot.seconds * 30),
        primaryHost.clientWidth / Math.max(1, primaryHost.clientHeight)));
      if (secondClip) {
        const secondaryState = updateView(1, secondClip, pre);
        secondView.renderFrame(1 / 30, pose(secondClip, secondaryState, Math.max(0, pre) / (shot.seconds * 30),
          secondaryHost.clientWidth / Math.max(1, secondaryHost.clientHeight)));
      }
    }
    previousShot = shotIndex;
  }
  renderCurrent(shot, local, local / (shot.seconds * 30));
  previousFrame = index;
  if (shot.layout === 'full') ctx.drawImage(view.canvas, 0, 0, width, height);
  else {
    const panel = currentPanel();
    ctx.fillStyle = '#071216'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(view.canvas, 0, 0, view.canvas.width, view.canvas.height, 0, portrait ? 0 : panel.banner, panel.width, panel.height);
    const rightX = portrait ? 0 : panel.width;
    const rightY = portrait ? panel.banner + panel.height : panel.banner;
    const rightW = portrait ? width : width - panel.width;
    const rightH = portrait ? height - panel.banner - panel.height : panel.height;
    ctx.drawImage(secondView.canvas, 0, 0, secondView.canvas.width, secondView.canvas.height, rightX, rightY, rightW, rightH);
  }
  drawOverlay(index);
  const visibility = Math.min(1, index / 15, (frameCount - index) / 18);
  if (visibility < 1) { ctx.fillStyle = `rgba(3,10,13,${1 - visibility})`; ctx.fillRect(0, 0, width, height); }
  return jpeg ? output.toDataURL('image/jpeg', .94).split(',')[1] : output.toDataURL('image/png').split(',')[1];
}

const samples = shots.flatMap(shot => {
  const clip = clipFor(shot, 'primary');
  return Array.from({ length: shot.seconds * 30 }, (_, i) => ({
    time: (shot.start + i) / 30,
    state: stateFor(clip, i), campaign: clip.r.campaign, mission: clip.r.mission,
  }));
});
const recordings = [sg, jpDawn, jp, sgDusk, jpDusk, jpNight];
const metadata = {
  width, height, fps: 30, duration: durationSeconds,
  sorties: recordings.map(r => ({ mission: r.mission.id, duration: r.result.timeSec, outcome: r.result.outcome, fuel: r.result.fuelKg })),
  shots: shots.map(shot => ({
    id: shot.id, start: shot.start / 30, duration: shot.seconds, layout: shot.layout,
    ...(shot.layout === 'full' ? {
      mission: shot.source.r.mission.id, sourceTime: shot.source.source / 30, camera: shot.source.camera,
    } : {
      tracks: [
        { campaign: 'Singapore', mission: shot.singapore.r.mission.id, sourceTime: shot.singapore.source / 30, camera: shot.singapore.camera },
        { campaign: 'Japan', mission: shot.japan.r.mission.id, sourceTime: shot.japan.source / 30, camera: shot.japan.camera },
      ],
    }),
  })),
};
async function audio() {
  const blob = await renderTrailerAudio(samples, durationSeconds);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject;
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
Object.assign(window, { trailer: { frame, audio, metadata } });
console.log('TRAILER_READY', JSON.stringify(metadata));
