import type { Campaign } from '../types';
import type { LocalPoint } from './geography';
import { campaignTerrainFrame } from './terrainFrame';
import { isWithinLakeOutline } from '../sim/lakeShape';

export type CampaignFieldCrop = 'paddy' | 'dry' | 'orchard';

export interface CampaignFieldSite {
  readonly id: string;
  readonly center: LocalPoint;
  readonly length: number;
  readonly width: number;
  readonly angle: number;
  readonly crop: CampaignFieldCrop;
  /** Road connection just beyond a field edge, in the campaign terrain frame. */
  readonly entrance: LocalPoint;
}

export interface CampaignSites {
  readonly coastal?: {
    readonly hut: LocalPoint;
    readonly yard: LocalPoint;
    readonly entrance: LocalPoint;
  };
  readonly fields: readonly CampaignFieldSite[];
  readonly airbaseGates: readonly { readonly id: string; readonly position: LocalPoint }[];
}

type WorldPoint = { x: number; z: number };
type Leg = readonly [WorldPoint, WorldPoint];

const distance = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.z - b.z);

function distanceToLeg(point: WorldPoint, [a, b]: Leg): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - a.x - fraction * dx, point.z - a.z - fraction * dz);
}

function interpolate(a: LocalPoint, b: LocalPoint, step: number): LocalPoint {
  return { t: a.t + (b.t - a.t) * step, s: a.s + (b.s - a.s) * step };
}

function fieldEntrance(center: LocalPoint, length: number, angle: number, side: 1 | -1): LocalPoint {
  // The entrance is beyond the long end of the plot. It stays outside the crop
  // footprint while leaving the road graph free to choose a proper approach.
  const along = side * (length / 2 + 14);
  return {
    t: center.t + Math.cos(angle) * along,
    s: center.s + Math.sin(angle) * along,
  };
}

/**
 * Stable shared destinations for roads and the coastal/field renderers.
 * All points use the fixed campaign terrain frame, so moving mission ships do
 * not move villages, fields, shoreline assets, or Japan's airbase gates.
 */
export function getCampaignSites(campaign: Campaign): CampaignSites {
  const referenceMission = campaign.missions[0];
  if (!referenceMission) throw new Error(`Campaign ${campaign.id} has no missions for geography sites`);

  const frame = campaignTerrainFrame(campaign, referenceMission);
  const toLocal = (point: WorldPoint): LocalPoint => {
    const dx = point.x - frame.origin.x, dz = point.z - frame.origin.z;
    return { t: dx * frame.ux + dz * frame.uz, s: dx * frame.sx + dz * frame.sz };
  };
  const fromLocal = (point: LocalPoint): WorldPoint => ({
    x: frame.origin.x + point.t * frame.ux + point.s * frame.sx,
    z: frame.origin.z + point.t * frame.uz + point.s * frame.sz,
  });
  const coastAt = (s: number) => frame.length * .42 + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);
  const legs: Leg[] = campaign.missions.flatMap(mission => {
    const first = mission.shore ?? mission.lake;
    return [[mission.ship, first], [first, mission.lake], [mission.lake, mission.fire]] as Leg[];
  });
  const pointIsSafe = (point: LocalPoint, routeMargin: number) => {
    const world = fromLocal(point);
    if (Math.min(...legs.map(leg => distanceToLeg(world, leg))) <= routeMargin) return false;
    return campaign.missions.every(mission =>
      !isWithinLakeOutline(campaign.id, mission.lake, world, 150)
      && distance(world, mission.fire) > mission.fire.radius + 150
      && (!mission.shore || distance(world, mission.shore) > 1_050)
      && distance(world, mission.ship) > 480,
    );
  };

  const lake = toLocal(referenceMission.lake);
  const villageS = lake.s + Math.max(520, referenceMission.lake.radius * 1.25 + 100);
  const villageT = Math.max(
    lake.t + 300,
    referenceMission.shore ? toLocal(referenceMission.shore).t + 1_050 : -Infinity,
    coastAt(villageS) + 620,
  );
  const hamlet = { t: 2_700, s: 1_550 };
  const farmOne = { t: 3_520, s: 1_120 };
  const farmTwo = { t: 4_770, s: -1_520 };
  const fields: CampaignFieldSite[] = ([
    { id: 'village-west-paddy', center: { t: villageT + 280, s: villageS - 260 }, length: 118, width: 78, angle: .12, crop: 'paddy', entrance: { t: 0, s: 0 } },
    { id: 'hamlet-north-paddy', center: { t: hamlet.t + 160, s: hamlet.s + 670 }, length: 138, width: 84, angle: -.1, crop: 'paddy', entrance: { t: 0, s: 0 } },
    { id: 'hamlet-south-dry', center: { t: hamlet.t + 320, s: hamlet.s - 680 }, length: 114, width: 68, angle: .22, crop: 'dry', entrance: { t: 0, s: 0 } },
    { id: 'farm-one-orchard', center: { t: farmOne.t + 10, s: farmOne.s + 810 }, length: 142, width: 86, angle: .06, crop: 'orchard', entrance: { t: 0, s: 0 } },
    { id: 'farm-one-dry', center: { t: farmOne.t - 190, s: farmOne.s - 690 }, length: 108, width: 70, angle: -.18, crop: 'dry', entrance: { t: 0, s: 0 } },
    { id: 'farm-two-paddy', center: { t: farmTwo.t - 230, s: farmTwo.s - 740 }, length: 148, width: 92, angle: .08, crop: 'paddy', entrance: { t: 0, s: 0 } },
    { id: 'farm-two-orchard', center: { t: farmTwo.t + 250, s: farmTwo.s + 410 }, length: 126, width: 82, angle: -.16, crop: 'orchard', entrance: { t: 0, s: 0 } },
  ] satisfies CampaignFieldSite[]).map((field, index) => ({
    ...field,
    // Put the access on the end facing the nearby rural collector, so the
    // approach reaches the field edge without cutting through its crop rows.
    entrance: fieldEntrance(field.center, field.length, field.angle,
      field.id === 'farm-two-paddy' ? 1
        : field.id === 'village-west-paddy' || field.id === 'farm-two-orchard' ? -1
          : index % 2 === 0 ? 1 : -1),
  }));

  let coastal: CampaignSites['coastal'];
  const candidateS = [-520, 620, -1_150, 1_350, -1_750, 1_950, -2_350, 2_650, -3_050, 3_350, -3_650, 3_950, -4_300, 4_300]
    .filter(s => Math.abs(s + 850) > 240);
  const yardCandidates: ReadonlyArray<readonly [number, number]> = [[-35, 58], [36, 66], [-42, 104], [43, 112], [-18, 128]];
  candidateLoop: for (const s of candidateS) {
    const hut = { t: coastAt(s) + 47, s };
    if (!pointIsSafe(hut, 420)) continue;
    yardLoop: for (const [yardX, yardZ] of yardCandidates) {
      const yard = { t: hut.t + yardZ, s: s - yardX };
      const entrance = { t: yard.t + 34, s: yard.s };
      const yardCorners = [-20, 20].flatMap(x => [-22, 22].map(z => ({
        t: yard.t + z,
        s: yard.s - x,
      })));
      const entranceCorners = [-4, 4].flatMap(x => [-4, 4].map(z => ({
        t: entrance.t + z,
        s: entrance.s - x,
      })));
      if (!pointIsSafe(yard, 470) || !yardCorners.every(point => pointIsSafe(point, 470))
        || !pointIsSafe(entrance, 470) || !entranceCorners.every(point => pointIsSafe(point, 470))) continue;
      let pathSafe = true;
      for (const [start, end] of [[hut, yard], [yard, entrance]] as const) {
        const pathLength = Math.hypot(end.t - start.t, end.s - start.s);
        const segments = Math.ceil(pathLength / 8);
        for (let index = 0; index <= segments; index++) {
          if (!pointIsSafe(interpolate(start, end, index / segments), 390)) { pathSafe = false; break; }
        }
        if (!pathSafe) break;
      }
      if (!pathSafe) continue yardLoop;
      coastal = { hut, yard, entrance };
      break candidateLoop;
    }
  }

  const airbaseGates: CampaignSites['airbaseGates'][number][] = [];
  if (campaign.id === 'jp_ketapang_2026_09' && referenceMission.shore) {
    const shore = referenceMission.shore;
    const axisHeading = Math.atan2(frame.ux, frame.uz);
    const heading = axisHeading - Math.PI / 2;
    const cosine = Math.cos(heading), sine = Math.sin(heading);
    for (const gate of [
      { id: 'japan-airbase-seaward-main-gate', x: -110, z: 378 },
      { id: 'japan-airbase-seaward-service-gate', x: -110, z: 652 },
      // Keep the north checkpoint and its access east of the widened runway
      // approach, with the opening following the sloping perimeter fence.
      { id: 'japan-airbase-north-service-gate', x: 373, z: 928.5 },
    ]) {
      const world = {
        x: shore.x + cosine * gate.x + sine * gate.z,
        z: shore.z - sine * gate.x + cosine * gate.z,
      };
      airbaseGates.push({ id: gate.id, position: toLocal(world) });
    }
  }

  return { ...(coastal ? { coastal } : {}), fields, airbaseGates };
}
