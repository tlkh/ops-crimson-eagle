import type { Campaign, Mission } from '../types';

type Point = { x: number; z: number };
export type TreeCollider = { x: number; z: number; ground: number; height: number; radius: number };
export type StructureCollider = { x: number; z: number; halfWidth: number; halfLength: number; bottom: number; top: number; label: string };

const treesByMission = new WeakMap<Mission, Map<string, TreeCollider[]>>();
const structuresByMission = new WeakMap<Mission, StructureCollider[]>();
const CELL = 64;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function distanceToLeg(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
}

/** Register the exact tree instances produced by the seeded world builder. Rebuilding replaces the old field. */
export function setTreeColliders(mission: Mission, trees: readonly TreeCollider[]): void {
  const cells = new Map<string, TreeCollider[]>();
  for (const tree of trees) {
    const radius = Math.max(1, tree.radius + 11);
    for (let x = Math.floor((tree.x - radius) / CELL); x <= Math.floor((tree.x + radius) / CELL); x++) {
      for (let z = Math.floor((tree.z - radius) / CELL); z <= Math.floor((tree.z + radius) / CELL); z++) {
        const cellKey = `${x},${z}`;
        const cell = cells.get(cellKey) ?? [];
        cell.push(tree);
        cells.set(cellKey, cell);
      }
    }
  }
  treesByMission.set(mission, cells);
}

export function nearbyTrees(mission: Mission, x: number, z: number): readonly TreeCollider[] {
  return treesByMission.get(mission)?.get(key(x, z)) ?? [];
}

/** Optional scene structures (homes, airport buildings) use world-aligned conservative bounds. */
export function setStructureColliders(mission: Mission, structures: readonly StructureCollider[]): void {
  structuresByMission.set(mission, [...structures]);
}

export function structureColliders(mission: Mission): readonly StructureCollider[] {
  return structuresByMission.get(mission) ?? [];
}

/** Matches the height field used by createWorld before its grid is triangulated. */
export function terrainHeight(campaign: Campaign, mission: Mission, x: number, z: number): number | null {
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  const routeLength = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / routeLength, uz = dz / routeLength, sx = -uz, sz = ux;
  const t = (x - mission.ship.x) * ux + (z - mission.ship.z) * uz;
  const s = (x - mission.ship.x) * sx + (z - mission.ship.z) * sz;
  const coast = routeLength * .42;
  const coastAt = coast + 34 * Math.sin(s * .003) + 19 * Math.sin(s * .008 + .5);
  // The visual mesh occupies only this theatre, with ocean outside its coastline.
  if (Math.abs(s) > 4700 || t < coastAt - 1e-6 || t > 6500) return null;
  const inlandHeight = -.48 + .12 * Math.sin(t * .006) * Math.cos(s * .008);
  const legs = campaign.missions.flatMap(m => {
    const first = m.shore ?? m.lake;
    return [[m.ship, first], [first, m.lake], [m.lake, m.fire]] as [Point, Point][];
  });
  const corridor = Math.min(...legs.map(([a, b]) => distanceToLeg({ x, z }, a, b)));
  const protectedDistance = Math.min(
    distance({ x, z }, mission.lake) - mission.lake.radius - 100,
    distance({ x, z }, mission.fire) - mission.fire.radius - 90,
    mission.shore ? distance({ x, z }, mission.shore) - 900 : Infinity,
  );
  const v = Math.max(0, Math.min(1, Math.min(corridor - 160, protectedDistance) / 450));
  const relief = v * v * (3 - 2 * v);
  const undulation = relief * (3 + 5 * Math.sin(t * .0016) * Math.sin(s * .0021) + 5 * Math.pow(Math.max(0, Math.sin(t * .003 + s * .001)), 2));
  return inlandHeight + undulation - 8.6 * Math.pow(Math.max(0, 1 - (t - coastAt) / 72), 2);
}

const COLS = 96;
const ROWS = 112;
const LATERAL = 4700;
const INLAND = 6500;
const meshHeights = new WeakMap<Mission, Float64Array>();

/** Reuse the exact height samples already generated for the visible terrain. */
export function setRenderedTerrainHeights(mission: Mission, heights: readonly number[]): void {
  meshHeights.set(mission, Float64Array.from(heights));
}

/** Exact triangle-interpolated elevation of the displayed terrain mesh. */
export function renderedTerrainHeight(campaign: Campaign, mission: Mission, x: number, z: number): number | null {
  const target = mission.shore ?? mission.lake;
  const dx = target.x - mission.ship.x, dz = target.z - mission.ship.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const ux = dx / length, uz = dz / length, sx = -uz, sz = ux;
  const t = (x - mission.ship.x) * ux + (z - mission.ship.z) * uz;
  const s = (x - mission.ship.x) * sx + (z - mission.ship.z) * sz;
  if (s < -LATERAL || s > LATERAL || t > INLAND) return null;
  const coast = length * .42;
  const coastAt = (rowS: number) => coast + 34 * Math.sin(rowS * .003) + 19 * Math.sin(rowS * .008 + .5);
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((s + LATERAL) * ROWS / (LATERAL * 2))));
  const s0 = -LATERAL + row / ROWS * LATERAL * 2;
  const s1 = -LATERAL + (row + 1) / ROWS * LATERAL * 2;
  const c0 = coastAt(s0), c1 = coastAt(s1);
  const rowFraction = (s - s0) / (s1 - s0);
  const edge = c0 + (c1 - c0) * rowFraction;
  if (t < edge) return null;

  let heights = meshHeights.get(mission);
  if (!heights) {
    heights = new Float64Array((ROWS + 1) * (COLS + 1));
    for (let j = 0; j <= ROWS; j++) {
      const rowS = -LATERAL + j / ROWS * LATERAL * 2;
      const rowCoast = coastAt(rowS);
      for (let k = 0; k <= COLS; k++) {
        const rowT = rowCoast + k / COLS * (INLAND - rowCoast);
        const worldX = mission.ship.x + rowT * ux + rowS * sx;
        const worldZ = mission.ship.z + rowT * uz + rowS * sz;
        heights[j * (COLS + 1) + k] = terrainHeight(campaign, mission, worldX, worldZ) ?? -9;
      }
    }
    meshHeights.set(mission, heights);
  }

  const fraction = Math.max(0, Math.min(1, (t - edge) / Math.max(1, INLAND - edge)));
  const approximateCol = Math.min(COLS - 1, Math.max(0, Math.floor(fraction * COLS)));
  for (let col = Math.max(0, approximateCol - 1); col <= Math.min(COLS - 1, approximateCol + 1); col++) {
    const aT = c0 + col / COLS * (INLAND - c0);
    const bT = c1 + col / COLS * (INLAND - c1);
    const cT = c0 + (col + 1) / COLS * (INLAND - c0);
    const dT = c1 + (col + 1) / COLS * (INLAND - c1);
    const a = heights[row * (COLS + 1) + col];
    const b = heights[(row + 1) * (COLS + 1) + col];
    const c = heights[row * (COLS + 1) + col + 1];
    const d = heights[(row + 1) * (COLS + 1) + col + 1];
    // The renderer triangulates each quad as A-B-C and B-D-C.
    const firstAcross = (t - (aT + (bT - aT) * rowFraction)) / (cT - aT);
    if (firstAcross >= -1e-6 && firstAcross <= 1 - rowFraction + 1e-6) {
      return a * (1 - rowFraction - firstAcross) + b * rowFraction + c * firstAcross;
    }
    const secondBase = bT + cT * (1 - rowFraction) + dT * (rowFraction - 1);
    const secondAcross = (t - secondBase) / (dT - bT);
    if (secondAcross >= 1 - rowFraction - 1e-6 && secondAcross <= 1 + 1e-6) {
      return d * (rowFraction + secondAcross - 1) + b * (1 - secondAcross) + c * (1 - rowFraction);
    }
  }
  return terrainHeight(campaign, mission, x, z);
}
