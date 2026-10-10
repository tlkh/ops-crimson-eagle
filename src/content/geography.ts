import type { Campaign, Mission } from '../types';
import { campaignTerrainFrame } from './terrainFrame';
import { isWithinLakeOutline, lakeRadiusBounds } from '../sim/lakeShape';

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
}

interface LocalFrame {
  toLocal(point: { x: number; z: number }): LocalPoint;
  fromLocal(point: LocalPoint): { x: number; z: number };
  coastAt(s: number): number;
}

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

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

function pathIsOnLand(path: readonly LocalPoint[], frame: LocalFrame): boolean {
  for (const point of sampleRoad(path, 20)) {
    // Rural routes continue into the outer map margins beyond the mission sectors.
    if (point.t < frame.coastAt(point.s) + 160 || point.t > 6400 || Math.abs(point.s) > 4550) return false;
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

/** Build deterministic authored settlements, sector access landmarks, and connected roads. */
export function getCampaignGeography(campaign: Campaign): CampaignGeography {
  const referenceMission = campaign.missions[0];
  if (!referenceMission) throw new Error(`Campaign ${campaign.id} has no missions for geography`);
  const frame = makeLocalFrame(campaign, referenceMission);
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

  const mainRoad: LocalPoint[] = [
    { t: village.t + 95, s: village.s + 48 },
    { t: village.t + 360, s: village.s + 245 },
    { t: 2360, s: 1320 },
    { t: 2850, s: 1500 },
    { t: 3380, s: 1300 },
    { t: 3900, s: 640 },
    { t: 4380, s: -430 },
    { t: 4790, s: -1500 },
    { t: 5310, s: -2110 },
    { t: 5900, s: -2570 },
    { t: 6380, s: -3260 },
  ];
  const roads: CampaignRoad[] = [
    { id: 'main-paved', kind: 'paved', points: mainRoad },
    {
      id: 'village-link', kind: 'gravel',
      points: [village, { t: village.t + 10, s: village.s + 5 }, mainRoad[0]],
    },
    {
      id: 'hamlet-link', kind: 'gravel',
      points: [mainRoad[3], { t: 2820, s: 1620 }, { t: 2740, s: 1640 }, hamlet],
    },
    {
      id: 'farm-one-link', kind: 'track',
      points: [mainRoad[4], { t: 3430, s: 1260 }, { t: farmOne.t - 20, s: farmOne.s + 90 }, farmOne],
    },
    {
      id: 'farm-two-link', kind: 'track',
      points: [mainRoad[6], { t: farmTwo.t + 10, s: farmTwo.s + 20 }, farmTwo],
    },
    {
      id: 'farm-two-field-track', kind: 'track',
      points: [farmTwo, { t: farmTwo.t + 30, s: farmTwo.s - 55 }, { t: farmTwo.t + 60, s: farmTwo.s - 120 }],
    },
    {
      id: 'outer-county-road', kind: 'gravel',
      points: [
        mainRoad[4], { t: 4050, s: 1370 }, { t: 4470, s: 1750 },
        { t: 4850, s: 2350 }, { t: 5200, s: 2140 },
        { t: 5460, s: 3160 }, { t: 5950, s: 3580 }, { t: 6380, s: 4110 },
      ],
    },
    {
      id: 'outer-cross-country-track', kind: 'track',
      points: [
        { t: 4850, s: 2350 }, { t: 4670, s: 1640 },
        { t: 5160, s: 1320 }, { t: 5640, s: 780 }, { t: 6200, s: 420 },
        { t: 6380, s: 80 },
      ],
    },
  ];

  if (referenceMission.shore) {
    const shore = frame.toLocal(referenceMission.shore);
    roads.push({
      id: 'shore-support-perimeter', kind: 'track',
      points: [
        { t: shore.t + 930, s: 1060 },
        { t: shore.t + 1180, s: 1190 },
        { t: 2010, s: 1220 },
        mainRoad[2],
      ],
    });
  }

  const accessCenter = lakePositions[0].center;
  const accessRadius = Math.max(...lakePositions.map(lake => lake.outerRadius)) + 105;
  // An open, irregular feeder follows the operational sectors, then bends
  // out through the settlement edge instead of tracing a uniform lake ring.
  const accessWaypointSpecs: Array<[number, number]> = campaign.id === 'jp_ketapang_2026_09'
    ? [[-82, 1.28], [-88, 1.62], [-61, 1.08], [-34, 1.52], [-4, 1.10],
      [25, 1.72], [55, 1.16], [84, 1.55], [114, 1.06], [143, 1.40]]
    : [
    [-112, 1.28], [-88, 1.62], [-61, 1.08], [-34, 1.52], [-4, 1.10],
    [25, 1.72], [55, 1.16], [84, 1.55], [114, 1.06], [143, 1.40],
  ];
  const accessWaypoints = accessWaypointSpecs.map(([degrees, radiusScale]) => {
    const angle = degrees * Math.PI / 180;
    const radius = accessRadius * radiusScale;
    return {
      t: accessCenter.t + Math.cos(angle) * radius,
      s: accessCenter.s + Math.sin(angle) * radius,
    };
  });
  if (campaign.id === 'jp_ketapang_2026_09') {
    // Keep the northern feeder outside the shore-support exclusion by sweeping
    // around the lake's west side before ending at a rural service cluster.
    accessWaypoints.push(...[
      [127, 1.58], [108, 1.72], [90, 1.8],
    ].map(([degrees, radiusScale]) => {
      const angle = degrees * Math.PI / 180;
      const radius = accessRadius * radiusScale;
      return {
        t: accessCenter.t + Math.cos(angle) * radius,
        s: accessCenter.s + Math.sin(angle) * radius,
      };
    }));
  }
  if (!pathClearsLakes(campaign.id, frame, accessWaypoints, lakePositions, 50) || !pathIsOnLand(accessWaypoints, frame)) {
    throw new Error(`Could not place the irregular sector access route for ${campaign.id}`);
  }
  const accessSpinePoints = sampleRoad(accessWaypoints, 20);
  const spineLinkJunction = accessSpinePoints
    .map(point => ({ point, path: [mainRoad[0], point] }))
    .filter(candidate => pathClearsLakes(campaign.id, frame, candidate.path, lakePositions, 50) && pathIsOnLand(candidate.path, frame))
    .sort((a, b) => distance(a.point, mainRoad[0]) - distance(b.point, mainRoad[0]))[0];
  if (!spineLinkJunction) throw new Error(`Could not connect the main road to ${campaign.id} sector spine`);
  const accessSpine = accessSpinePoints;
  roads.push(
    { id: 'sector-access-spine', kind: 'track', points: accessSpine },
    { id: 'sector-spine-link', kind: 'track', points: [mainRoad[0], spineLinkJunction.point] },
  );

  const sectorLabels = campaign.id === 'sg_fictional_2026_10'
    ? ['Practice clearing', 'Lakeside settlement', 'Peat access road', 'Working waterfront', 'Jetty access corridor', 'Forest boundary']
    : ['Practice shore sector', 'Ketapang settlement fringe', 'Smoke-lane access', 'Drainage-line sector', 'Community access road', 'Settlement boundary'];
  const sectors: CampaignSector[] = campaign.missions.map(mission => {
    const fire = frame.toLocal(mission.fire);
    const lake = frame.toLocal(mission.lake);
    const awayT = fire.t - lake.t;
    const awayS = fire.s - lake.s;
    const separation = Math.max(1, Math.hypot(awayT, awayS));
    // End sector spurs at a safe roadside staging cluster beyond the fire
    // approach corridor instead of stopping beside the active objective.
    const terminalOffset = Math.max(340, mission.fire.radius + 260);
    const position = { t: fire.t + awayT / separation * terminalOffset, s: fire.s + awayS / separation * terminalOffset };
    const junction = accessSpinePoints
      .map((point, index) => ({ point, index, path: [point, position] }))
      .filter(candidate => pathClearsLakes(campaign.id, frame, candidate.path, lakePositions, 50) && pathIsOnLand(candidate.path, frame))
      .sort((a, b) => distance(a.point, position) - distance(b.point, position))[0];
    if (!junction) throw new Error(`Could not connect ${mission.id} sector access to the shared spine`);
    roads.push({
      id: `sector-access-${mission.id.toLowerCase()}`,
      kind: 'track',
      points: [junction.point, position],
    });
    return {
      id: `sector-${mission.id.toLowerCase()}`,
      missionId: mission.id,
      label: sectorLabels[campaign.missions.indexOf(mission)] ?? `${mission.id} access sector`,
      position,
      settlementId: nearestSettlement(position, settlements),
    };
  });

  return { settlements, sectors, roads };
}
