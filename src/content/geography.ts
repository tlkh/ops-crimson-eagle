import type { Campaign, Mission } from '../types';
import { campaignTerrainFrame } from './terrainFrame';
import { isWithinLakeOutline, lakeRadiusBounds } from '../sim/lakeShape';
import { getCampaignSites } from './geographySites';
import { buildRoadGraph, findUnmodeledRoadCrossings, smoothRoadPath } from './roadGraph';
import { nodeRoadIntersections } from './roadIntersections';

/** Local gameplay metres in the campaign's stable ship-to-inland coordinate frame. */
export type LocalPoint = { t: number; s: number };

export type SettlementKind = 'village' | 'hamlet' | 'farm';
export type RoadKind = 'paved' | 'gravel' | 'track';

export interface CampaignSettlement {
  readonly id: string;
  readonly label: string;
  readonly kind: SettlementKind;
  readonly position: LocalPoint;
}

export interface CampaignSector {
  readonly id: string;
  readonly missionId: string;
  readonly label: string;
  readonly position: LocalPoint;
  readonly settlementId: string;
}

export interface CampaignRoad {
  readonly id: string;
  readonly kind: RoadKind;
  readonly points: readonly LocalPoint[];
  readonly frontage?: 'settlement' | 'rural' | 'none';
}

export type RoadGraphNodeKind = 'junction' | 'settlement' | 'farm' | 'field' | 'coastal' | 'gate' | 'response' | 'worksite';

export interface RoadGraphNode {
  readonly id: string;
  readonly position: LocalPoint;
  readonly kind: RoadGraphNodeKind;
}

export interface RoadGraphEdge {
  readonly id: string;
  readonly roadId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: RoadKind;
  /** Centerline from `from` to `to`, taken from the rendered CampaignRoad geometry. */
  readonly points: readonly LocalPoint[];
}

export interface RoadJunction {
  readonly id: string;
  readonly position: LocalPoint;
  readonly arms: readonly { roadId: string; kind: RoadKind; direction: LocalPoint }[];
}

export interface CampaignDestination {
  readonly id: string;
  readonly kind: 'settlement' | 'farm' | 'field' | 'coastal' | 'gate' | 'response' | 'worksite';
  readonly position: LocalPoint;
}

export interface CampaignRoadTerminus {
  readonly roadId: string;
  readonly kind: RoadKind;
  readonly end: 'start' | 'end';
  readonly position: LocalPoint;
}

export interface CampaignGeography {
  readonly settlements: readonly CampaignSettlement[];
  readonly sectors: readonly CampaignSector[];
  readonly roads: readonly CampaignRoad[];
  readonly nodes: readonly RoadGraphNode[];
  readonly edges: readonly RoadGraphEdge[];
  readonly junctions: readonly RoadJunction[];
  readonly destinations: readonly CampaignDestination[];
}

interface LocalFrame {
  toLocal(point: { x: number; z: number }): LocalPoint;
  fromLocal(point: LocalPoint): { x: number; z: number };
  coastAt(s: number): number;
}

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);
const unitDirection = (from: LocalPoint, to: LocalPoint): LocalPoint => {
  const length = distance(from, to);
  if (length < 1e-5) throw new Error('Road arm cannot have zero length');
  return { t: (to.t - from.t) / length, s: (to.s - from.s) / length };
};
const angleBetweenDirections = (a: LocalPoint, b: LocalPoint) => Math.acos(Math.max(-1, Math.min(1, a.t * b.t + a.s * b.s)));

function distanceToPolyline(point: LocalPoint, points: readonly LocalPoint[]): number {
  let nearest = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dt = b.t - a.t, ds = b.s - a.s;
    const lengthSquared = dt * dt + ds * ds;
    const fraction = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSquared));
    nearest = Math.min(nearest, distance(point, { t: a.t + dt * fraction, s: a.s + ds * fraction }));
  }
  return nearest;
}

function makeLocalFrame(campaign: Campaign, mission: Mission): LocalFrame {
  const { origin, length: routeLength, ux, uz, sx, sz } = campaignTerrainFrame(campaign, mission);
  const coastStart = routeLength * .42;
  return {
    toLocal(point) {
      const rx = point.x - origin.x;
      const rz = point.z - origin.z;
      return { t: rx * ux + rz * uz, s: rx * sx + rz * sz };
    },
    fromLocal(point) {
      return {
        x: origin.x + point.t * ux + point.s * sx,
        z: origin.z + point.t * uz + point.s * sz,
      };
    },
    coastAt(s) {
      return coastStart + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);
    },
  };
}

function pathIsOnLand(path: readonly LocalPoint[], frame: LocalFrame, coastMargin = 160): boolean {
  for (const point of sampleRoad(path, 20)) {
    // Rural routes continue into the outer map margins beyond the mission sectors.
    if (point.t < frame.coastAt(point.s) + coastMargin || point.t > 6400 || Math.abs(point.s) > 4550) return false;
  }
  return true;
}

function pathClearsLakes(
  campaignId: Campaign['id'],
  frame: LocalFrame,
  path: readonly LocalPoint[],
  lakes: readonly { boundary: { x: number; z: number; radius: number } }[],
  margin: number,
): boolean {
  for (const point of sampleRoad(path, 8)) {
    const world = frame.fromLocal(point);
    for (const lake of lakes) {
      if (isWithinLakeOutline(campaignId, lake.boundary, world, margin + 4)) return false;
    }
  }
  return true;
}

function nearestSettlement(point: LocalPoint, settlements: readonly CampaignSettlement[]): string {
  let nearest = settlements[0];
  for (const settlement of settlements.slice(1)) {
    if (distance(point, settlement.position) < distance(point, nearest.position)) nearest = settlement;
  }
  return nearest.id;
}

function projectToSegment(point: LocalPoint, a: LocalPoint, b: LocalPoint): { point: LocalPoint; fraction: number } {
  const dt = b.t - a.t, ds = b.s - a.s;
  const lengthSquared = dt * dt + ds * ds;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.t - a.t) * dt + (point.s - a.s) * ds) / lengthSquared));
  return { point: { t: a.t + dt * fraction, s: a.s + ds * fraction }, fraction };
}

/** Reject shallow at-grade crossings before they become awkward shared junctions. */
function hasShallowRoadCrossing(
  path: readonly LocalPoint[],
  roads: readonly CampaignRoad[],
  allowedJoin?: { roadId: string; point: LocalPoint },
): boolean {
  const cross = (a: LocalPoint, b: LocalPoint) => a.t * b.s - a.s * b.t;
  for (let pathIndex = 1; pathIndex < path.length; pathIndex++) {
    const a = path[pathIndex - 1], b = path[pathIndex];
    const ab = { t: b.t - a.t, s: b.s - a.s };
    const abLength = Math.hypot(ab.t, ab.s);
    if (abLength < 1e-6) continue;
    for (const road of roads) for (let roadIndex = 1; roadIndex < road.points.length; roadIndex++) {
      const c = road.points[roadIndex - 1], d = road.points[roadIndex];
      const cd = { t: d.t - c.t, s: d.s - c.s };
      const cdLength = Math.hypot(cd.t, cd.s);
      if (cdLength < 1e-6) continue;
      const ac = { t: c.t - a.t, s: c.s - a.s };
      const determinant = cross(ab, cd);
      if (Math.abs(determinant) < abLength * cdLength * 1e-10) {
        if (Math.abs(cross(ab, ac)) / abLength < .2) {
          const projectionC = (ac.t * ab.t + ac.s * ab.s) / abLength;
          const projectionD = ((d.t - a.t) * ab.t + (d.s - a.s) * ab.s) / abLength;
          if (Math.min(abLength, Math.max(projectionC, projectionD)) - Math.max(0, Math.min(projectionC, projectionD)) > .2) return true;
        }
        continue;
      }
      const pathFraction = cross(ac, cd) / determinant;
      const roadFraction = cross(ac, ab) / determinant;
      if (pathFraction < -1e-8 || pathFraction > 1 + 1e-8 || roadFraction < -1e-8 || roadFraction > 1 + 1e-8) continue;
      const intersection = { t: a.t + ab.t * pathFraction, s: a.s + ab.s * pathFraction };
      if (allowedJoin && road.id === allowedJoin.roadId && distance(intersection, allowedJoin.point) < .2) continue;
      const cosine = Math.abs((ab.t * cd.t + ab.s * cd.s) / (abLength * cdLength));
      if (Math.acos(Math.max(-1, Math.min(1, cosine))) < Math.PI / 6) return true;
    }
  }
  return false;
}

/**
 * Sample an authored road with piecewise-linear interpolation. Every input vertex
 * is copied into the output exactly, so branch endpoints and junctions coincide.
 */
export function sampleRoad(points: readonly LocalPoint[], spacing = 8): LocalPoint[] {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError('Road sample spacing must be a positive finite number');
  if (points.length < 2) return points.map(point => ({ t: point.t, s: point.s }));

  const samples: LocalPoint[] = [{ t: points[0].t, s: points[0].s }];
  for (let segment = 1; segment < points.length; segment++) {
    const a = points[segment - 1];
    const b = points[segment];
    const length = distance(a, b);
    const divisions = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= divisions; step++) {
      if (step === divisions) {
        samples.push({ t: b.t, s: b.s });
      } else {
        const fraction = step / divisions;
        samples.push({
          t: a.t + (b.t - a.t) * fraction,
          s: a.s + (b.s - a.s) * fraction,
        });
      }
    }
  }
  return samples;
}

/** Return the unshared ends of the connected road graph in stable order. */
export function getCampaignRoadTermini(roads: readonly CampaignRoad[]): CampaignRoadTerminus[] {
  const endpoints: Array<{ road: CampaignRoad; end: 'start' | 'end'; position: LocalPoint }> = [];
  for (const road of roads) {
    if (road.points.length < 2) continue;
    for (const [end, position] of [['start', road.points[0]], ['end', road.points[road.points.length - 1]]] as const) {
      endpoints.push({ road, end, position: { ...position } });
    }
  }
  return endpoints.filter(endpoint => !roads.some(other => other.id !== endpoint.road.id
    && distanceToPolyline(endpoint.position, other.points) <= 1.5))
    .map(({ road, end, position }) => ({ roadId: road.id, kind: road.kind, end, position }));
}

/** Build deterministic rural roads, shared destination access, and a graph of all real junctions. */
export function getCampaignGeography(campaign: Campaign): CampaignGeography {
  const referenceMission = campaign.missions[0];
  if (!referenceMission) throw new Error(`Campaign ${campaign.id} has no missions for geography`);
  const jp = campaign.id === 'jp_ketapang_2026_09';
  const frame = makeLocalFrame(campaign, referenceMission);
  const sites = getCampaignSites(campaign);
  const lakePositions = campaign.missions.map(mission => ({
    center: frame.toLocal(mission.lake),
    boundary: mission.lake,
    outerRadius: lakeRadiusBounds(campaign.id, mission.lake.radius).max,
  }));
  const villageS = lakePositions[0].center.s + Math.max(520, referenceMission.lake.radius * 1.25 + 100);
  const villageT = Math.max(
    lakePositions[0].center.t + 300,
    referenceMission.shore ? frame.toLocal(referenceMission.shore).t + 1050 : -Infinity,
    frame.coastAt(villageS) + 620,
  );
  const village = { t: villageT, s: villageS };
  const hamlet = { t: 2700, s: 1550 };
  const farmOne = { t: 3520, s: 1120 };
  const farmTwo = { t: 4770, s: -1520 };
  const settlements: CampaignSettlement[] = [
    { id: 'village', label: 'Lakeside village', kind: 'village', position: village },
    { id: 'hamlet', label: 'Inland hamlet', kind: 'hamlet', position: hamlet },
    { id: 'farm-one', label: 'Farmstead A', kind: 'farm', position: farmOne },
    { id: 'farm-two', label: 'Farmstead B', kind: 'farm', position: farmTwo },
  ];

  const roads: CampaignRoad[] = [];
  const nodes: RoadGraphNode[] = [];
  const destinations: CampaignDestination[] = settlements.map(settlement => ({
    id: settlement.id,
    kind: settlement.kind === 'farm' ? 'farm' : 'settlement',
    position: settlement.position,
  }));

  const ensureNode = (id: string, position: LocalPoint, kind: RoadGraphNode['kind']): RoadGraphNode => {
    const present = nodes.find(node => distance(node.position, position) < 1e-4);
    if (present) return present;
    const node = { id, kind, position: { ...position } };
    nodes.push(node);
    return node;
  };
  settlements.forEach(settlement => ensureNode(settlement.id, settlement.position, settlement.kind === 'farm' ? 'farm' : 'settlement'));
  const addRoad = (id: string, kind: RoadKind, points: LocalPoint[], frontage: CampaignRoad['frontage'] = 'rural') => {
    if (roads.some(road => road.id === id)) throw new Error(`Duplicate authored road ${id}`);
    ensureNode(`${id}:start`, points[0], 'junction');
    ensureNode(`${id}:end`, points.at(-1)!, 'junction');
    const road = { id, kind, frontage, points: points.map(point => ({ ...point })) };
    roads.push(road);
    return road;
  };

  // Every local street is a branch from a continuous through-route. The
  // highway passes the village/hamlet/farm intersections; it does not double
  // back through the settlement itself, which avoids parallel duplicate roads.
  const mainHamletJunction = { t: hamlet.t + 85, s: hamlet.s - 105 };
  const farmOneJunction = { t: farmOne.t - 60, s: farmOne.s - 60 };
  const farmTwoJunction = { t: 4140, s: 700 };
  const lakeCenter = lakePositions[0].center;
  const spineT = lakeCenter.t + 650;
  const spineAt = (s: number): LocalPoint => ({
    t: spineT + 34 * Math.sin((s - lakeCenter.s) * .0015),
    s,
  });
  const spineStart = spineAt(lakeCenter.s + 1100);
  const spineEnd = spineAt(lakeCenter.s - 1250);
  // Keep the JP through-route on a direct inland-to-spine alignment. Its village
  // access is a branch from the route, rather than a dip through nearby response
  // tracks that creates multiple tiny parallel junctions.
  const mainVillageApproach = { t: village.t - 125, s: village.s + 320 };
  const mainVillageJunction = jp
    ? {
      t: mainVillageApproach.t + (spineStart.t - mainVillageApproach.t) * .18,
      s: mainVillageApproach.s + (spineStart.s - mainVillageApproach.s) * .18,
    }
    : { t: village.t + 105, s: village.s + 130 };
  const seawardGates = jp
    ? sites.airbaseGates.filter(gate => gate.id !== 'japan-airbase-north-service-gate')
    : [];
  let japanCoastalCollectorJunction: LocalPoint | undefined;
  if (jp && (seawardGates.length !== 2 || !sites.airbaseGates.some(gate => gate.id === 'japan-airbase-north-service-gate'))) {
    throw new Error('Japan campaign geography needs both seaward gates and the northern service gate');
  }
  const collectorT = jp ? Math.min(...seawardGates.map(gate => gate.position.t)) - 22 : 0;
  const mainStart = jp ? { t: collectorT, s: 1585 } : { t: village.t - 330, s: village.s + 50 };
  const airbaseInlandJunction = { t: mainStart.t + 990, s: 1600 };
  const mainEnd = { t: 4820, s: 260 };
  const mainPoints: LocalPoint[] = jp ? [
    mainStart,
    { t: mainStart.t + 410, s: 1605 },
    { t: mainStart.t + 730, s: 1610 },
    airbaseInlandJunction,
    mainVillageApproach,
    mainVillageJunction,
    spineStart,
    mainHamletJunction,
    { t: 3210, s: 1335 },
    farmOneJunction,
    { t: 3830, s: 930 },
    farmTwoJunction,
    mainEnd,
  ] : [
    mainStart,
    mainVillageApproach,
    mainVillageJunction,
    spineStart,
    mainHamletJunction,
    { t: 3210, s: 1335 },
    farmOneJunction,
    { t: 3830, s: 930 },
    farmTwoJunction,
    mainEnd,
  ];
  const mainPaved = addRoad('main-paved', 'paved', mainPoints, 'settlement');
  ensureNode('village-main-junction', mainVillageJunction, 'junction');
  ensureNode('hamlet-main-junction', mainHamletJunction, 'junction');
  ensureNode('farm-one-main-junction', farmOneJunction, 'junction');
  ensureNode('farm-two-crossroads', farmTwoJunction, 'junction');
  ensureNode('sector-spine-start', spineStart, 'junction');
  if (jp) ensureNode('japan-airbase-inland-junction', airbaseInlandJunction, 'junction');

  const villageEnd = { t: village.t - 115, s: village.s - 105 };
  const hamletEnd = { t: hamlet.t - 135, s: hamlet.s + 180 };
  const farmOneEnd = { t: farmOne.t + 145, s: farmOne.s + 145 };
  const villageLinkWaypoint = jp
    ? { t: village.t - 165, s: village.s + 10 }
    : { t: village.t + 45, s: village.s + 55 };
  addRoad('village-link', 'gravel', [mainVillageJunction, villageLinkWaypoint, village], 'settlement');
  addRoad('village-side-street', 'gravel', [village, { t: village.t - 55, s: village.s - 55 }, villageEnd], 'settlement');
  addRoad('hamlet-link', 'gravel', [mainHamletJunction, { t: hamlet.t + 45, s: hamlet.s - 45 }, hamlet, hamletEnd], 'settlement');
  addRoad('farm-one-link', 'track', [farmOneJunction, { t: farmOne.t - 30, s: farmOne.s - 30 }, farmOne, farmOneEnd], 'rural');
  addRoad('farm-two-link', 'track', [farmTwoJunction, { t: 4335, s: 270 }, { t: 4510, s: -330 }, { t: 4665, s: -970 }, farmTwo], 'rural');

  if (jp) {
    const gatesOrdered = [...seawardGates].sort((a, b) => a.position.s - b.position.s);
    const gateJunctions = gatesOrdered.map(gate => ({
      gate,
      junction: { t: collectorT, s: gate.position.s },
    }));
    gateJunctions.forEach(({ gate, junction }) => {
      ensureNode(`${gate.id}-road-junction`, junction, 'junction');
      ensureNode(gate.id, gate.position, 'gate');
      destinations.push({ id: gate.id, kind: 'gate', position: gate.position });
      const path = [junction, gate.position];
      if (!pathIsOnLand(path, frame, 55) || !pathClearsLakes(campaign.id, frame, path, lakePositions, 40)) {
        throw new Error(`Japan airbase gate ${gate.id} does not reach the shared road on dry land`);
      }
      addRoad(gate.id, 'gravel', path, 'none');
    });
    japanCoastalCollectorJunction = sites.coastal
      ? { t: collectorT, s: sites.coastal.entrance.s }
      : { t: collectorT, s: gateJunctions[0].junction.s - 240 };
    ensureNode('japan-coastal-collector-coast-end', japanCoastalCollectorJunction, 'junction');
    const collectorPoints = [
      japanCoastalCollectorJunction,
      ...gateJunctions.map(item => item.junction),
      { t: collectorT, s: 965 },
      { t: collectorT + 5, s: 1290 },
      mainStart,
    ];
    ensureNode('japan-coastal-collector-end', mainStart, 'junction');
    if (!pathIsOnLand(collectorPoints, frame, 65) || !pathClearsLakes(campaign.id, frame, collectorPoints, lakePositions, 40)) {
      throw new Error('Japan coastal collector does not remain on dry land outside the lake shore');
    }
    addRoad('japan-coastal-collector', 'gravel', collectorPoints, 'rural');

    const northGate = sites.airbaseGates.find(gate => gate.id === 'japan-airbase-north-service-gate')!;
    const northGateOutside = { t: northGate.position.t, s: northGate.position.s + 58 };
    ensureNode(northGate.id, northGate.position, 'gate');
    ensureNode(`${northGate.id}-outside-junction`, northGateOutside, 'junction');
    destinations.push({ id: northGate.id, kind: 'gate', position: northGate.position });
    // Approach the north fence opening from its inland side, then skirt the
    // clear approach footprint before joining the paved route at grade.
    addRoad(northGate.id, 'gravel', [northGateOutside, northGate.position], 'none');
    addRoad('japan-airbase-north-connector', 'gravel', [
      northGateOutside,
      { t: northGateOutside.t + 115, s: 1090 },
      { t: northGateOutside.t + 330, s: 1365 },
      airbaseInlandJunction,
    ], 'rural');
  }

  // Response crews share one inland collector rather than a broken ring around the refill lake.
  ensureNode('sector-spine-end', spineEnd, 'junction');
  const sectors: CampaignSector[] = campaign.missions.map((mission, index) => {
    const fire = frame.toLocal(mission.fire);
    const lake = frame.toLocal(mission.lake);
    const awayT = fire.t - lake.t, awayS = fire.s - lake.s;
    const separation = Math.max(1, Math.hypot(awayT, awayS));
    const terminalOffset = Math.max(340, mission.fire.radius + 260);
    const position = { t: fire.t + awayT / separation * terminalOffset, s: fire.s + awayS / separation * terminalOffset };
    return {
      id: `sector-${mission.id.toLowerCase()}`,
      missionId: mission.id,
      label: (campaign.id === 'sg_fictional_2026_10'
        ? ['Practice clearing', 'Lakeside settlement', 'Peat access road', 'Working waterfront', 'Jetty access corridor', 'Forest boundary']
        : ['Practice shore sector', 'Ketapang settlement fringe', 'Smoke-lane access', 'Drainage-line sector', 'Community access road', 'Settlement boundary'])[index]
        ?? `${mission.id} access sector`,
      position,
      settlementId: nearestSettlement(position, settlements),
    };
  });
  const responsePosition = (mission: Mission): LocalPoint => {
    const fire = frame.toLocal(mission.fire);
    const lake = frame.toLocal(mission.lake);
    const awayT = fire.t - lake.t, awayS = fire.s - lake.s;
    const separation = Math.max(1, Math.hypot(awayT, awayS));
    const radialUnitT = awayT / separation, radialUnitS = awayS / separation;
    const lateralOffset = 55;
    const stagingRadius = mission.fire.radius + 25;
    const radialOffset = Math.sqrt(stagingRadius * stagingRadius - lateralOffset * lateralOffset);
    const lateralSign = mission.seed % 2 === 0 ? 1 : -1;
    return {
      t: fire.t + radialUnitT * radialOffset - radialUnitS * lateralOffset * lateralSign,
      s: fire.s + radialUnitS * radialOffset + radialUnitT * lateralOffset * lateralSign,
    };
  };
  const spineRoad = addRoad('sector-access-spine', 'track', [spineStart, spineEnd], 'none');

  const attachRoad = (
    id: string,
    source: LocalPoint,
    candidateRoadIds: readonly string[],
    coastMargin: number,
    maxDistance: number,
    fireClearance: number,
  ): LocalPoint => {
    type Candidate = { road: CampaignRoad; segmentIndex: number; point: LocalPoint; distance: number };
    const candidates: Candidate[] = [];
    const rejected = { gap: 0, crowded: 0, angle: 0, land: 0, lake: 0, fire: 0 };
    const direction = (from: LocalPoint, to: LocalPoint): LocalPoint | null => {
      const length = distance(from, to);
      return length < 1e-5 ? null : { t: (to.t - from.t) / length, s: (to.s - from.s) / length };
    };
    const angleBetween = (a: LocalPoint, b: LocalPoint) => Math.acos(Math.max(-1, Math.min(1, a.t * b.t + a.s * b.s)));
    for (const road of roads) {
      if (!candidateRoadIds.includes(road.id)) continue;
      for (let segmentIndex = 1; segmentIndex < road.points.length; segmentIndex++) {
        const a = road.points[segmentIndex - 1], b = road.points[segmentIndex];
        const projected = projectToSegment(source, a, b);
        let joinPoint = projected.point;
        let joinSegmentIndex = segmentIndex;
        const nearbyNode = nodes
          .filter(node => distance(node.position, projected.point) < 90
            && road.points.some(point => distance(point, node.position) < 1e-4))
          .sort((left, right) => distance(left.position, projected.point) - distance(right.position, projected.point))[0];
        if (nearbyNode) {
          let existingArms = 0;
          const existingDirections: LocalPoint[] = [];
          for (const candidateRoad of roads) {
            for (let pointIndex = 0; pointIndex < candidateRoad.points.length; pointIndex++) {
              if (distance(candidateRoad.points[pointIndex], nearbyNode.position) < 1e-4) {
                existingArms += pointIndex === 0 || pointIndex === candidateRoad.points.length - 1 ? 1 : 2;
                const previous = candidateRoad.points[pointIndex - 1];
                const next = candidateRoad.points[pointIndex + 1];
                if (previous) existingDirections.push(direction(nearbyNode.position, previous)!);
                if (next) existingDirections.push(direction(nearbyNode.position, next)!);
              }
            }
          }
          const branchDirection = direction(nearbyNode.position, source);
          const canJoinNode = existingArms <= 3 && branchDirection !== null
            && existingDirections.every(arm => angleBetween(arm, branchDirection) >= Math.PI / 6);
          if (canJoinNode) {
            joinPoint = nearbyNode.position;
            const pointIndex = road.points.findIndex(point => distance(point, joinPoint) < 1e-4);
            if (pointIndex >= 0) joinSegmentIndex = Math.max(1, pointIndex);
          } else if (distance(projected.point, nearbyNode.position) < 42) {
            // Avoid creating a tiny offset branch when a snapped approach
            // would be crowded or nearly parallel to an existing arm.
            rejected.angle++; continue;
          }
        }
        const gap = distance(source, joinPoint);
        if (gap > maxDistance || gap < 1e-3) { rejected.gap++; continue; }
        const roadLength = distance(a, b), branchLength = gap;
        if (roadLength < 1 || branchLength < 1) continue;
        const sine = Math.abs((b.t - a.t) * (source.s - joinPoint.s)
          - (b.s - a.s) * (source.t - joinPoint.t)) / (roadLength * branchLength);
        if (sine < .5) { rejected.angle++; continue; }
        const route = [joinPoint, source];
        if (!pathIsOnLand(route, frame, coastMargin)) { rejected.land++; continue; }
        if (!pathClearsLakes(campaign.id, frame, route, lakePositions, 42)) { rejected.lake++; continue; }
        let clearsFires = true;
        for (const point of sampleRoad(route, 12)) for (const mission of campaign.missions) {
          const fire = frame.toLocal(mission.fire);
          if (distance(point, fire) < mission.fire.radius + fireClearance) clearsFires = false;
        }
        if (!clearsFires) { rejected.fire++; continue; }
        candidates.push({ road, segmentIndex: joinSegmentIndex, point: joinPoint, distance: gap });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = candidates[0];
    if (!selected) throw new Error(`Could not connect ${id} to a safe frontage road in ${campaign.id} (${JSON.stringify(rejected)})`);
    const node = ensureNode(`${id}-junction`, selected.point, 'junction');
    const host = selected.road as CampaignRoad & { points: LocalPoint[] };
    const existingIndex = host.points.findIndex(point => distance(point, selected.point) < 1e-4);
    if (existingIndex < 0) host.points.splice(selected.segmentIndex, 0, { ...selected.point });
    // Return the access point. The caller adds its destination and road after the projection is fixed.
    void node;
    return selected.point;
  };

  for (const sector of sectors) {
    const mission = campaign.missions.find(item => item.id === sector.missionId)!;
    const fire = frame.toLocal(mission.fire);
    const lake = frame.toLocal(mission.lake);
    const radialT = (fire.t - lake.t) / Math.max(1, distance(fire, lake));
    const radialS = (fire.s - lake.s) / Math.max(1, distance(fire, lake));
    const perpendicular = { t: -radialS, s: radialT };
    const signs = mission.seed % 2 === 0 ? [1, -1] : [-1, 1];
    const response = responsePosition(mission);
    const responseDirectionLength = distance(sector.position, response);
    const responseDirection = {
      t: (response.t - sector.position.t) / responseDirectionLength,
      s: (response.s - sector.position.s) / responseDirectionLength,
    };
    let selected: { station: LocalPoint; path: LocalPoint[]; length: number; host: CampaignRoad } | undefined;
    const rejected = { land: 0, lake: 0, angle: 0, fire: 0 };
    // JP-05 lies west of the village. A straight approach from the shared
    // inland spine cuts across the village/response tracks; connect its access
    // spur to the western main-road segment instead, leaving those local routes
    // as one clean cluster around the village.
    if (jp && mission.id === 'JP-05') {
      const station = mainPaved.points.find(point => distance(point, { t: 1015, s: 1610 }) < 30);
      if (station) {
        const path = [station, sector.position];
        const previous = mainPaved.points[mainPaved.points.indexOf(station) - 1];
        const next = mainPaved.points[mainPaved.points.indexOf(station) + 1];
        const branch = unitDirection(station, sector.position);
        const arms = [previous, next].filter((point): point is LocalPoint => Boolean(point))
          .map(point => unitDirection(station, point));
        const otherFireSafe = sampleRoad(path, 12).every(point => campaign.missions.every(other =>
          distance(point, frame.toLocal(other.fire)) >= other.fire.radius + (other.id === mission.id ? 24 : 48)));
        if (arms.every(arm => angleBetweenDirections(arm, branch) >= Math.PI * 35 / 180)
          && pathIsOnLand(path, frame, 145)
          && pathClearsLakes(campaign.id, frame, path, lakePositions, 38)
          && otherFireSafe) {
          selected = { station, path, length: distance(station, sector.position), host: mainPaved };
        }
      }
    }
    const stationCandidates: LocalPoint[] = [];
    for (let s = lakeCenter.s + 1350; s >= lakeCenter.s - 1350; s -= 100) stationCandidates.push(spineAt(s));
    stationCandidates.sort((a, b) => distance(a, sector.position) - distance(b, sector.position));
    for (const station of selected ? [] : stationCandidates) {
      const candidatePaths: LocalPoint[][] = [[station, sector.position]];
      for (const sign of signs) for (const offset of [140, 260, 400]) {
        const elbow = { t: sector.position.t + perpendicular.t * sign * offset, s: sector.position.s + perpendicular.s * sign * offset };
        candidatePaths.push([station, elbow, sector.position]);
      }
      for (const path of candidatePaths) {
        if (!pathIsOnLand(path, frame, 145)) { rejected.land++; continue; }
        if (!pathClearsLakes(campaign.id, frame, path, lakePositions, 38)) { rejected.lake++; continue; }
        const branchLength = distance(path[0], path[1]);
        const along = spineAt(station.s + 20), against = spineAt(station.s - 20);
        const tangentLength = distance(along, against);
        const tangent = { t: (along.t - against.t) / tangentLength, s: (along.s - against.s) / tangentLength };
        const branch = { t: (path[1].t - path[0].t) / branchLength, s: (path[1].s - path[0].s) / branchLength };
        if (Math.abs(branch.t * tangent.t + branch.s * tangent.s) > .82) { rejected.angle++; continue; }
        const accessArmLength = distance(path.at(-1)!, path.at(-2)!);
        const accessArm = {
          t: (path.at(-2)!.t - path.at(-1)!.t) / accessArmLength,
          s: (path.at(-2)!.s - path.at(-1)!.s) / accessArmLength,
        };
        if (Math.acos(Math.max(-1, Math.min(1, accessArm.t * responseDirection.t + accessArm.s * responseDirection.s))) < Math.PI * 35 / 180) {
          rejected.angle++;
          continue;
        }
        const otherFireSafe = sampleRoad(path, 12).every(point => campaign.missions.every(other => {
          if (other.id === mission.id) return distance(point, fire) >= other.fire.radius + 24;
          return distance(point, frame.toLocal(other.fire)) >= other.fire.radius + 48;
        }));
        if (!otherFireSafe) { rejected.fire++; continue; }
        const length = path.slice(1).reduce((total, point, index) => total + distance(point, path[index]), 0);
        if (!selected || length < selected.length) selected = { station, path, length, host: spineRoad };
      }
      if (selected && distance(station, sector.position) > selected.length + 200) break;
    }
    if (!selected) throw new Error(`Could not connect ${mission.id} staging sector without crossing the lakes or fire fronts (${JSON.stringify(rejected)})`);
    const mutableHostPoints = selected.host.points as LocalPoint[];
    if (!mutableHostPoints.some(point => distance(point, selected!.station) < 1e-4)) {
      let insertAt = mutableHostPoints.findIndex((point, index) => index > 0
        && point.s < selected!.station.s && mutableHostPoints[index - 1].s > selected!.station.s);
      if (insertAt < 0) insertAt = mutableHostPoints.length - 1;
      mutableHostPoints.splice(insertAt, 0, { ...selected.station });
    }
    ensureNode(`${selected.host.id === 'main-paved' ? 'sector-main' : 'sector-spine'}-${mission.id.toLowerCase()}`, selected.station, 'junction');
    ensureNode(sector.id, sector.position, 'worksite');
    addRoad(`sector-access-${mission.id.toLowerCase()}`, 'track', selected.path, 'none');
    destinations.push({ id: sector.id, kind: 'worksite', position: sector.position });
  }

  const responseAccessRoads: CampaignRoad[] = [];
  for (const sector of sectors) {
    const mission = campaign.missions.find(item => item.id === sector.missionId)!;
    const staging = responsePosition(mission);
    ensureNode(`response-${mission.id.toLowerCase()}`, staging, 'response');
    destinations.push({ id: `response-${mission.id.toLowerCase()}`, kind: 'response', position: staging });
    const sectorAccess = roads.find(road => road.id === `sector-access-${mission.id.toLowerCase()}`)!;
    const accessPoint = sectorAccess.points.at(-2)!;
    const accessLength = distance(sector.position, accessPoint);
    const accessDirection = { t: (accessPoint.t - sector.position.t) / accessLength, s: (accessPoint.s - sector.position.s) / accessLength };
    const radialLength = Math.max(1, distance(frame.toLocal(mission.fire), frame.toLocal(mission.lake)));
    const fire = frame.toLocal(mission.fire), lake = frame.toLocal(mission.lake);
    const radial = { t: (fire.t - lake.t) / radialLength, s: (fire.s - lake.s) / radialLength };
    const perpendicular = { t: -radial.s, s: radial.t };
    const midpoint = { t: (sector.position.t + staging.t) * .5, s: (sector.position.s + staging.s) * .5 };
    const candidatePaths = [[sector.position, staging]];
    for (const side of [-1, 1]) for (const offset of [48, 90, 145]) {
      candidatePaths.push([
        sector.position,
        { t: midpoint.t + radial.t * 32 + perpendicular.t * side * offset,
          s: midpoint.s + radial.s * 32 + perpendicular.s * side * offset },
        staging,
      ]);
    }
    const responseRejected = { angle: 0, land: 0, lake: 0, fire: 0, crossing: 0 };
    const chosen = candidatePaths.find(path => {
      const firstDirection = unitDirection(path[0], path[1]);
      if (angleBetweenDirections(accessDirection, firstDirection) < Math.PI * 35 / 180) { responseRejected.angle++; return false; }
      if (!pathIsOnLand(path, frame, 145)) { responseRejected.land++; return false; }
      if (!pathClearsLakes(campaign.id, frame, path, lakePositions, 38)) { responseRejected.lake++; return false; }
      const fireSafe = sampleRoad(path, 10).every(point => distance(point, fire) >= mission.fire.radius + 24);
      if (!fireSafe) { responseRejected.fire++; return false; }
      const crossingSafe = !hasShallowRoadCrossing(path, roads, { roadId: sectorAccess.id, point: sector.position });
      if (!crossingSafe) responseRejected.crossing++;
      return crossingSafe;
    });
    if (!chosen) throw new Error(`Could not route ${mission.id} response access without a shallow or unsafe crossing ${JSON.stringify(responseRejected)}`);
    const road: CampaignRoad = {
      id: `response-access-${mission.id.toLowerCase()}`,
      kind: 'track', frontage: 'none', points: chosen,
    };
    responseAccessRoads.push(road);
    roads.push(road);
  }

  const suitableRoadIds = jp
    ? ['main-paved', 'village-link', 'village-side-street', 'hamlet-link', 'farm-one-link', 'farm-two-link', 'japan-coastal-collector']
    : ['main-paved', 'village-link', 'village-side-street', 'hamlet-link', 'farm-one-link', 'farm-two-link'];
  if (sites.coastal) {
    const entrance = sites.coastal.entrance;
    let junction: LocalPoint;
    let accessPoints: LocalPoint[];
    if (jp) {
      junction = japanCoastalCollectorJunction!;
      accessPoints = [junction, entrance];
    } else {
      const options: Array<{ station: LocalPoint; path: LocalPoint[]; length: number }> = [];
      for (let s = lakeCenter.s + 1350; s >= lakeCenter.s - 1350; s -= 50) {
        const station = spineAt(s);
        const elbows = [
          { t: entrance.t, s: station.s },
          { t: entrance.t + 110, s: station.s },
          { t: entrance.t - 110, s: station.s },
        ];
        for (const elbow of elbows) {
          const path = [station, elbow, entrance];
          if (!pathIsOnLand(path, frame, 65) || !pathClearsLakes(campaign.id, frame, path, lakePositions, 42)) continue;
          const clearOfFires = sampleRoad(path, 12).every(point => campaign.missions.every(mission =>
            distance(point, frame.toLocal(mission.fire)) >= mission.fire.radius + 50));
          if (!clearOfFires || hasShallowRoadCrossing(path, roads, { roadId: spineRoad.id, point: station })) continue;
          const length = path.slice(1).reduce((total, point, index) => total + distance(point, path[index]), 0);
          options.push({ station, path, length });
        }
      }
      options.sort((a, b) => a.length - b.length);
      const selected = options[0];
      if (!selected) throw new Error(`Could not connect SG coastal yard to the inland spine with safe junction geometry`);
      const mutableSpinePoints = spineRoad.points as LocalPoint[];
      if (!mutableSpinePoints.some(point => distance(point, selected.station) < 1e-4)) {
        let insertAt = mutableSpinePoints.findIndex((point, index) => index > 0
          && point.s < selected.station.s && mutableSpinePoints[index - 1].s > selected.station.s);
        if (insertAt < 0) insertAt = mutableSpinePoints.length - 1;
        mutableSpinePoints.splice(insertAt, 0, { ...selected.station });
      }
      junction = selected.station;
      accessPoints = selected.path;
    }
    const destinationId = 'coastal-yard';
    ensureNode(destinationId, entrance, 'coastal');
    destinations.push({ id: destinationId, kind: 'coastal', position: entrance });
    addRoad('coastal-yard-access', 'gravel', accessPoints, 'rural');
  }
  for (const field of sites.fields) {
    let junction: LocalPoint;
    let fieldRoadPoints: LocalPoint[];
    const fieldAnchor = field.id === 'farm-two-paddy' ? farmTwo : undefined;
    if (fieldAnchor) {
      const outward = unitDirection(field.center, field.entrance);
      const outer = { t: field.entrance.t + outward.t * 38, s: field.entrance.s + outward.s * 38 };
      const straight = { t: outer.t - fieldAnchor.t, s: outer.s - fieldAnchor.s };
      const straightLength = Math.hypot(straight.t, straight.s);
      const normal = { t: -straight.s / straightLength, s: straight.t / straightLength };
      const candidatePaths: LocalPoint[][] = [[fieldAnchor, outer, field.entrance]];
      for (const side of [-1, 1]) for (const offset of [80, 160, 260, 400]) {
        const waypoint = {
          t: (fieldAnchor.t + outer.t) * .5 + normal.t * side * offset,
          s: (fieldAnchor.s + outer.s) * .5 + normal.s * side * offset,
        };
        candidatePaths.push([fieldAnchor, waypoint, outer, field.entrance]);
      }
      const outsideParcel = (path: readonly LocalPoint[]) => sampleRoad(path, 3).every(point => {
        const dt = point.t - field.center.t, ds = point.s - field.center.s;
        const along = dt * Math.cos(field.angle) + ds * Math.sin(field.angle);
        const across = -dt * Math.sin(field.angle) + ds * Math.cos(field.angle);
        return Math.abs(along) > field.length / 2 + 11 || Math.abs(across) > field.width / 2 + 11;
      });
      const anchorRoadId = 'farm-two-link';
      const chosen = candidatePaths.find(path => pathIsOnLand(path, frame, 65)
        && pathClearsLakes(campaign.id, frame, path, lakePositions, 42)
        && outsideParcel(path)
        && sampleRoad(path, 12).every(point => campaign.missions.every(mission =>
          distance(point, frame.toLocal(mission.fire)) >= mission.fire.radius + 48))
        && !hasShallowRoadCrossing(path, roads, { roadId: anchorRoadId, point: fieldAnchor }));
      if (!chosen) throw new Error(`Could not route ${field.id} from its roadside end without clipping a plot or shallow junction`);
      junction = fieldAnchor;
      fieldRoadPoints = chosen;
    } else if (field.id === 'village-west-paddy') {
      const outward = unitDirection(field.center, field.entrance);
      const outer = { t: field.entrance.t + outward.t * 38, s: field.entrance.s + outward.s * 38 };
      // Join at the village's main junction so this field spur does not cross
      // the inland hamlet link on its way south-west to the parcel.
      junction = mainVillageJunction;
      fieldRoadPoints = [junction, outer, field.entrance];
    } else {
      junction = attachRoad(`field-access-${field.id}`, field.entrance, suitableRoadIds, 100, 5000, 48);
      fieldRoadPoints = [junction, field.entrance];
    }
    ensureNode(field.id, field.entrance, 'field');
    destinations.push({ id: field.id, kind: 'field', position: field.entrance });
    addRoad(`field-access-${field.id}`, 'track', fieldRoadPoints, 'rural');
  }

  // Shared at-grade intersections become graph nodes and split every affected
  // centerline. This keeps render, route reachability, and road junction arms in sync.
  const noded = nodeRoadIntersections(roads, nodes);
  for (const road of noded.roads) {
    const margin = road.id.startsWith('japan-airbase-seaward-') || road.id === 'japan-coastal-collector'
      || road.id === 'coastal-yard-access' || (jp && road.id === 'main-paved') ? 65 : 145;
    if (!pathIsOnLand(road.points, frame, margin) || !pathClearsLakes(campaign.id, frame, road.points, lakePositions, 42)) {
      throw new Error(`Road ${road.id} leaves dry land or crosses a lake in ${campaign.id}`);
    }
  }
  const smoothRoads = noded.roads.map(road => ({
    ...road,
    points: smoothRoadPath(road.points, noded.nodes.map(node => node.position), road.kind === 'paved' ? 72 : 48),
  }));
  const crossings = findUnmodeledRoadCrossings(smoothRoads);
  if (crossings.length) throw new Error(`Unmodeled road crossing in ${campaign.id}: ${crossings[0]}`);
  const graph = buildRoadGraph(smoothRoads, noded.nodes);
  return { settlements, sectors, roads: smoothRoads, ...graph, destinations };
}
