import type { Campaign, Mission, Vec3 } from '../types';
import { getCampaignGeography, sampleRoad, type CampaignRoad, type LocalPoint } from '../content/geography';
import { campaignTerrainFrame } from '../content/terrainFrame';
import { renderedTerrainHeight, terrainHeight } from './collision';

const ENGINE_SPEED_MPS = 5;
const WALK_SPEED_MPS = 1;
const TURN_SECONDS = 2.4;
const ROAD_SAMPLE_M = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type XZ = { x: number; z: number };
type RoadPoint = LocalPoint & XZ;
type BridgeSpan = { start: number; entry: number; exit: number; end: number; startGround: number; deckY: number; endGround: number };

export type FirefighterPose = {
  id: string;
  position: Vec3;
  heading: number;
  activity: 'hose' | 'walk' | 'standby';
  gaitPhase: number;
  motion: number;
};

export type FireEnginePose = {
  id: 'staged' | 'patrol';
  position: Vec3;
  heading: number;
  speed: number;
  halfWidth: number;
  halfLength: number;
  height: number;
};

export type FireResponseHose = { id: string; points: Vec3[]; kind: 'hose' | 'spray' };
export type FireResponseFrame = { people: FirefighterPose[]; engines: FireEnginePose[]; hoses: FireResponseHose[] };
export type FireEngineCollider = {
  id: FireEnginePose['id']; x: number; z: number; y: number; heading: number;
  halfWidth: number; halfLength: number; bottom: number; top: number;
};
export type FireResponseExclusionZone = { center: XZ; radius: number };

type RoadPath = { road: CampaignRoad; points: RoadPoint[]; cumulative: number[]; length: number; bridges: BridgeSpan[] };
type Layout = {
  people: Array<Omit<FirefighterPose, 'position'> & { x: number; z: number; heading: number }>;
  walkPaths: Array<{ start: number; end: number; lateral: number; path: RoadPath }>;
  staged: FireEnginePose;
  patrolRoad: RoadPath;
  exclusions: FireResponseExclusionZone[];
};

const layoutByMission = new WeakMap<Mission, Layout>();

function toWorld(campaign: Campaign, mission: Mission, point: LocalPoint): XZ {
  const { origin, ux, uz, sx, sz } = campaignTerrainFrame(campaign, mission);
  return { x: origin.x + point.t * ux + point.s * sx, z: origin.z + point.t * uz + point.s * sz };
}

function supportHeight(campaign: Campaign, mission: Mission, point: XZ): number {
  return renderedTerrainHeight(campaign, mission, point.x, point.z) ?? terrainHeight(campaign, mission, point.x, point.z) ?? 0;
}

function riverCenter(t: number): number {
  return -850 + 120 * Math.sin(t * .0021) + 75 * Math.sin(t * .0053);
}

function roadPath(campaign: Campaign, mission: Mission, road: CampaignRoad): RoadPath {
  const localPoints = sampleRoad(road.points, ROAD_SAMPLE_M);
  const points: RoadPoint[] = localPoints.map(local => ({ ...local, ...toWorld(campaign, mission, local) }));
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].t - points[i - 1].t, points[i].s - points[i - 1].s));
  const length = cumulative[cumulative.length - 1] ?? 0;
  const riverHalfWidth = (campaign.id === 'jp_ketapang_2026_09' ? 68 : 48) * 1.22 + (road.kind === 'paved' ? 10 : road.kind === 'gravel' ? 7.2 : 5.2) * .5 + 4;
  const signed = points.map(point => Math.abs(point.s - riverCenter(point.t)) - riverHalfWidth);
  const spans: Array<{ entry: number; exit: number }> = [];
  let entry: number | undefined = signed[0] <= 0 ? 0 : undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const a = signed[i], b = signed[i + 1];
    if ((a <= 0) === (b <= 0)) continue;
    const fraction = clamp(a / (a - b), 0, 1);
    const crossing = cumulative[i] + (cumulative[i + 1] - cumulative[i]) * fraction;
    if (a > 0) entry = crossing;
    else {
      spans.push({ entry: entry ?? 0, exit: crossing });
      entry = undefined;
    }
  }
  if (entry !== undefined) spans.push({ entry, exit: length });
  const base = { road, points, cumulative, length, bridges: [] as BridgeSpan[] };
  const at = (along: number) => pointAt(base, along);
  base.bridges = spans.map(({ entry: bridgeEntry, exit }) => {
    const start = Math.max(0, bridgeEntry - 12), end = Math.min(length, exit + 12);
    const startGround = supportHeight(campaign, mission, at(start));
    const endGround = supportHeight(campaign, mission, at(end));
    return {
      start, entry: bridgeEntry, exit, end, startGround, endGround,
      deckY: Math.max(.65, startGround + .32, endGround + .32),
    };
  });
  return base;
}

function pointAt(path: RoadPath, along: number): RoadPoint {
  const d = clamp(along, 0, path.length);
  let low = 1, high = path.cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (path.cumulative[middle] < d) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(1, low);
  const a = path.points[index - 1] ?? path.points[0] ?? { t: 0, s: 0, x: 0, z: 0 };
  const b = path.points[index] ?? a;
  const span = (path.cumulative[index] ?? 0) - (path.cumulative[index - 1] ?? 0);
  const u = span > 0 ? (d - (path.cumulative[index - 1] ?? 0)) / span : 0;
  return { t: a.t + (b.t - a.t) * u, s: a.s + (b.s - a.s) * u, x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
}

function roadSurfaceY(campaign: Campaign, mission: Mission, path: RoadPath, along: number): number {
  const d = clamp(along, 0, path.length);
  const bridge = path.bridges.find(span => d >= span.start && d <= span.end);
  if (!bridge) return supportHeight(campaign, mission, pointAt(path, d)) + .22;
  if (d < bridge.entry) {
    const u = bridge.entry > bridge.start ? (d - bridge.start) / (bridge.entry - bridge.start) : 1;
    return bridge.startGround + .12 + (bridge.deckY - bridge.startGround - .12) * u + .1;
  }
  if (d <= bridge.exit) return bridge.deckY + .1;
  const span = bridge.end - bridge.exit;
  const u = span > 0 ? (d - bridge.exit) / span : 1;
  return bridge.deckY + (bridge.endGround + .12 - bridge.deckY) * u + .1;
}

function headingAt(path: RoadPath, along: number, reverse = false): number {
  const a = pointAt(path, clamp(along - 4, 0, path.length));
  const b = pointAt(path, clamp(along + 4, 0, path.length));
  const dx = b.x - a.x, dz = b.z - a.z;
  const heading = Math.atan2(dx, dz);
  return reverse ? heading + Math.PI : heading;
}

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function enginePose(campaign: Campaign, mission: Mission, path: RoadPath, timeSec: number): FireEnginePose {
  const outboundSec = path.length / ENGINE_SPEED_MPS;
  const cycle = outboundSec * 2 + TURN_SECONDS * 2;
  const clock = ((Math.max(0, Number.isFinite(timeSec) ? timeSec : 0) % cycle) + cycle) % cycle;
  let along: number, heading: number, speed = ENGINE_SPEED_MPS;
  if (clock < outboundSec) {
    along = clock * ENGINE_SPEED_MPS;
    heading = headingAt(path, along);
  } else if (clock < outboundSec + TURN_SECONDS) {
    along = path.length;
    const u = (clock - outboundSec) / TURN_SECONDS;
    const ease = u * u * (3 - 2 * u);
    const first = headingAt(path, path.length), last = headingAt(path, path.length, true);
    heading = first + angleDelta(first, last) * ease;
    speed = 0;
  } else if (clock < outboundSec * 2 + TURN_SECONDS) {
    const returnClock = clock - outboundSec - TURN_SECONDS;
    along = path.length - returnClock * ENGINE_SPEED_MPS;
    heading = headingAt(path, along, true);
  } else {
    along = 0;
    const u = (clock - outboundSec * 2 - TURN_SECONDS) / TURN_SECONDS;
    const ease = u * u * (3 - 2 * u);
    const first = headingAt(path, 0, true), last = headingAt(path, 0);
    heading = first + angleDelta(first, last) * ease;
    speed = 0;
  }
  const point = pointAt(path, along);
  return { id: 'patrol', position: { x: point.x, y: roadSurfaceY(campaign, mission, path, along), z: point.z }, heading, speed, halfWidth: 1.8, halfLength: 3.55, height: 2.65 };
}

function getLayout(campaign: Campaign, mission: Mission): Layout {
  const cached = layoutByMission.get(mission);
  if (cached) return cached;

  const geography = getCampaignGeography(campaign);
  const patrolRoadDef = geography.roads.find(road => road.id === 'main-paved') ?? geography.roads.find(road => road.kind === 'paved') ?? geography.roads[0];
  const sectorRoadDef = geography.roads.find(road => road.id === `sector-access-${mission.id.toLowerCase()}`);
  const responseRoadDef = geography.roads.find(road => road.id === `response-access-${mission.id.toLowerCase()}`);
  const stagingRoadDef = responseRoadDef ?? sectorRoadDef ?? patrolRoadDef;
  if (!patrolRoadDef || !stagingRoadDef) throw new Error(`No authored road available for fire response in ${mission.id}`);
  const patrolRoad = roadPath(campaign, mission, patrolRoadDef);
  const stagingRoad = roadPath(campaign, mission, stagingRoadDef);
  const stageAlong = Math.max(0, stagingRoad.length - 18);
  const stageCenter = pointAt(stagingRoad, stageAlong);
  const tangent = headingAt(stagingRoad, stageAlong);
  const forward = { x: Math.sin(tangent), z: Math.cos(tangent) };
  const right = { x: Math.cos(tangent), z: -Math.sin(tangent) };
  const fire = { x: mission.fire.x, z: mission.fire.z };
  const people: Layout['people'] = [];
  const putPerson = (id: string, x: number, z: number, heading: number, activity: FirefighterPose['activity']) => {
    people.push({ id, x, z, heading, activity, gaitPhase: 0, motion: 1 });
  };
  for (const [pair, side] of [['north', 1], ['south', -1]] as const) {
    for (const [index, longitudinal] of [-1, 1].entries()) {
      const x = stageCenter.x + right.x * side * 7.2 + forward.x * longitudinal * 2.1;
      const z = stageCenter.z + right.z * side * 7.2 + forward.z * longitudinal * 2.1;
      putPerson(`firefighter-${pair}-${index + 1}`, x, z, Math.atan2(fire.x - x, fire.z - z), 'hose');
    }
  }
  const walkEnd = Math.max(0, stagingRoad.length - 34);
  const walkStart = Math.max(0, stagingRoad.length - 84);
  const walkPaths = [
    { start: walkStart, end: walkEnd, lateral: 6.2, path: stagingRoad },
    { start: walkStart, end: walkEnd, lateral: -6.2, path: stagingRoad },
  ];
  for (let index = 0; index < walkPaths.length; index++) {
    const { path, start, end, lateral } = walkPaths[index];
    const point = pointAt(path, (start + end) * .5);
    const h = headingAt(path, (start + end) * .5);
    const rightSide = { x: Math.cos(h), z: -Math.sin(h) };
    const x = point.x + rightSide.x * lateral, z = point.z + rightSide.z * lateral;
    putPerson(`roadside-walker-${index + 1}`, x, z, h, 'walk');
  }

  const stagedAlong = Math.max(0, stageAlong - 5);
  const stagedPoint = pointAt(stagingRoad, stagedAlong);
  const staged: FireEnginePose = {
    id: 'staged',
    position: { x: stagedPoint.x, y: roadSurfaceY(campaign, mission, stagingRoad, stagedAlong), z: stagedPoint.z },
    heading: headingAt(stagingRoad, stagedAlong), speed: 0, halfWidth: 1.8, halfLength: 3.55, height: 2.65,
  };
  const exclusions: FireResponseExclusionZone[] = [];
  const addZone = (x: number, z: number, radius: number) => exclusions.push({ center: { x, z }, radius });
  for (const worker of people) {
    if (worker.activity !== 'walk') addZone(worker.x, worker.z, 8.5);
  }
  addZone(staged.position.x, staged.position.z, 14);
  for (const walkPath of walkPaths) {
    for (let along = walkPath.start; along <= walkPath.end; along += 8) {
      const point = pointAt(walkPath.path, along);
      const heading = headingAt(walkPath.path, along);
      const right = { x: Math.cos(heading), z: -Math.sin(heading) };
      addZone(point.x + right.x * walkPath.lateral, point.z + right.z * walkPath.lateral, 8.5);
    }
    const point = pointAt(walkPath.path, walkPath.end);
    const heading = headingAt(walkPath.path, walkPath.end);
    const right = { x: Math.cos(heading), z: -Math.sin(heading) };
    addZone(point.x + right.x * walkPath.lateral, point.z + right.z * walkPath.lateral, 8.5);
  }

  const layout = { people, walkPaths, staged, patrolRoad, exclusions };
  layoutByMission.set(mission, layout);
  return layout;
}

function walkerPosition(path: RoadPath, start: number, end: number, timeSec: number, lateral: number, index: number) {
  const span = Math.max(1, end - start);
  const forwardSeconds = span / WALK_SPEED_MPS;
  const cycle = forwardSeconds * 2 + TURN_SECONDS * 2;
  const phaseTime = ((Math.max(0, timeSec) + index * 5.5) % cycle + cycle) % cycle;
  let along: number, reverse: boolean, turning = false, turnFraction = 0;
  if (phaseTime < forwardSeconds) { along = start + phaseTime * WALK_SPEED_MPS; reverse = false; }
  else if (phaseTime < forwardSeconds + TURN_SECONDS) {
    along = end; reverse = false; turning = true; turnFraction = (phaseTime - forwardSeconds) / TURN_SECONDS;
  } else if (phaseTime < forwardSeconds * 2 + TURN_SECONDS) {
    along = end - (phaseTime - forwardSeconds - TURN_SECONDS) * WALK_SPEED_MPS; reverse = true;
  } else {
    along = start; reverse = true; turning = true; turnFraction = (phaseTime - forwardSeconds * 2 - TURN_SECONDS) / TURN_SECONDS;
  }
  const point = pointAt(path, along);
  const roadHeading = headingAt(path, along);
  const baseHeading = reverse ? roadHeading + Math.PI : roadHeading;
  const right = { x: Math.cos(roadHeading), z: -Math.sin(roadHeading) };
  const offset = { x: point.x + right.x * lateral, z: point.z + right.z * lateral };
  let heading = baseHeading;
  if (turning) {
    const other = baseHeading + Math.PI;
    const smooth = turnFraction * turnFraction * (3 - 2 * turnFraction);
    heading = baseHeading + angleDelta(baseHeading, other) * smooth;
  }
  return { ...offset, heading, walking: !turning, gaitPhase: (phaseTime * 1.75 + index * Math.PI) % (Math.PI * 2), motion: turning ? 0 : 1 };
}

function buildFrame(campaign: Campaign, mission: Mission, timeSec: number, secured: boolean): FireResponseFrame {
  const layout = getLayout(campaign, mission);
  const time = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  const people: FirefighterPose[] = layout.people.map((worker, index) => {
    if (worker.activity === 'walk') {
      const path = layout.walkPaths[index - (layout.people.length - layout.walkPaths.length)];
      const walk = walkerPosition(path.path, path.start, path.end, time, path.lateral, index);
      return {
        id: worker.id,
        position: { x: walk.x, y: supportHeight(campaign, mission, walk) + .04, z: walk.z },
        heading: walk.heading,
        activity: 'walk',
        gaitPhase: walk.gaitPhase,
        motion: walk.motion,
      };
    }
    const sway = secured ? .025 : .14;
    const x = worker.x + Math.sin(time * .72 + index * 1.7) * sway;
    const z = worker.z + Math.cos(time * .64 + index * 1.3) * sway;
    return {
      id: worker.id,
      position: { x, y: supportHeight(campaign, mission, { x, z }) + .04, z },
      heading: worker.heading,
      activity: secured ? 'standby' : worker.activity,
      gaitPhase: secured ? 0 : time * .9 + index * Math.PI,
      motion: secured ? .04 : .42,
    };
  });
  const patrol = enginePose(campaign, mission, layout.patrolRoad, time);
  const engines = [layout.staged, patrol];
  const staged = layout.staged;
  const nearbyWorkers = people.filter(person => person.id.startsWith('firefighter-'));
  const forward = { x: Math.sin(staged.heading), z: Math.cos(staged.heading) };
  const rear = { x: staged.position.x - forward.x * staged.halfLength * .76, y: staged.position.y + .12, z: staged.position.z - forward.z * staged.halfLength * .76 };
  const nozzleWorkers = nearbyWorkers.filter(worker => worker.id.endsWith('-1'));
  const hoses: FireResponseHose[] = nozzleWorkers.map((worker, index) => ({
    id: `hose-${index + 1}`,
    kind: 'hose',
    points: [rear, { x: (rear.x + worker.position.x) * .5, y: Math.max(rear.y, worker.position.y) + .11, z: (rear.z + worker.position.z) * .5 },
      { ...worker.position, y: worker.position.y + 1.02 }],
  }));
  if (!secured) {
    for (const [index, worker] of nozzleWorkers.entries()) {
      const dx = mission.fire.x - worker.position.x, dz = mission.fire.z - worker.position.z;
      const fireDistance = Math.hypot(dx, dz);
      const length = Math.min(45, Math.max(10, fireDistance - mission.fire.radius + 4));
      const ux = dx / Math.max(1, fireDistance), uz = dz / Math.max(1, fireDistance);
      const end = { x: worker.position.x + ux * length, z: worker.position.z + uz * length };
      const middle = { x: (worker.position.x + end.x) * .5, z: (worker.position.z + end.z) * .5 };
      hoses.push({
        id: `spray-${index + 1}`,
        kind: 'spray',
        points: [
          { x: worker.position.x + ux * .35, y: worker.position.y + 1.02, z: worker.position.z + uz * .35 },
          { x: middle.x, y: supportHeight(campaign, mission, middle) + .36 + Math.sin(time * 2.1 + index) * .06, z: middle.z },
          { x: end.x, y: supportHeight(campaign, mission, end) + .14, z: end.z },
        ],
      });
    }
  }
  return { people, engines, hoses };
}

/** Deterministic ambient positions and gestures, sampled only from simulation time. */
export function sampleFireResponse(campaign: Campaign, mission: Mission, timeSec: number, secured = false): FireResponseFrame {
  return buildFrame(campaign, mission, timeSec, secured);
}

/** Shared truck bounds consumed by both the renderer and the headless collision model. */
export function fireResponseEngineColliders(campaign: Campaign, mission: Mission, timeSec: number): FireEngineCollider[] {
  // Collision is part of the headless simulation, which also supports compact
  // training/custom missions with no campaign road network. World construction
  // explicitly prepares authored responder layouts through
  // getFireResponseExclusionZones before the simulation starts. Keep collision
  // inert until then rather than resolving geography from every sim step.
  const layout = layoutByMission.get(mission);
  if (!layout) return [];
  const engines = [layout.staged, enginePose(campaign, mission, layout.patrolRoad, timeSec)];
  return engines.map(engine => ({
    id: engine.id, x: engine.position.x, z: engine.position.z, y: engine.position.y,
    heading: engine.heading, halfWidth: engine.halfWidth, halfLength: engine.halfLength,
    bottom: engine.position.y, top: engine.position.y + engine.height,
  }));
}

/** Prepare the authored layout and reserve responders, the staged engine, and the complete walker paths. */
export function getFireResponseExclusionZones(campaign: Campaign, mission: Mission): FireResponseExclusionZone[] {
  return getLayout(campaign, mission).exclusions.map(zone => ({ center: { ...zone.center }, radius: zone.radius }));
}
