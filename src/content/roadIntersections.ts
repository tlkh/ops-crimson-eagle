import type { CampaignRoad, LocalPoint, RoadGraphNode } from './geography';

const EPSILON = 1e-5;
const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);
const cross = (a: LocalPoint, b: LocalPoint) => a.t * b.s - a.s * b.t;
type Cut = { fraction: number; point: LocalPoint };

/** Split real at-grade crossings into shared vertices without moving route or destination anchors. */
export function nodeRoadIntersections(
  inputRoads: readonly CampaignRoad[],
  inputNodes: readonly RoadGraphNode[],
): { roads: CampaignRoad[]; nodes: RoadGraphNode[] } {
  const nodes = inputNodes.map(node => ({ ...node, position: { ...node.position } }));
  const cuts: Cut[][][] = inputRoads.map(road => road.points.slice(1).map((end, index) => [
    { fraction: 0, point: road.points[index] }, { fraction: 1, point: end },
  ]));
  const sharedNode = (position: LocalPoint, firstId: string, secondId: string) => {
    const existing = nodes.find(node => distance(node.position, position) <= EPSILON);
    if (existing) return existing.position;
    const baseId = `crossing:${firstId}:${secondId}`;
    let ordinal = 1;
    while (nodes.some(node => node.id === `${baseId}:${ordinal}`)) ordinal++;
    const point = { ...position };
    nodes.push({ id: `${baseId}:${ordinal}`, kind: 'junction', position: point });
    return point;
  };

  for (let firstIndex = 0; firstIndex < inputRoads.length; firstIndex++) {
    const first = inputRoads[firstIndex];
    for (let secondIndex = firstIndex; secondIndex < inputRoads.length; secondIndex++) {
      const second = inputRoads[secondIndex];
      for (let i = 1; i < first.points.length; i++) for (let j = 1; j < second.points.length; j++) {
        if (firstIndex === secondIndex && j <= i) continue;
        const a = first.points[i - 1], b = first.points[i];
        const c = second.points[j - 1], d = second.points[j];
        const ab = { t: b.t - a.t, s: b.s - a.s };
        const cd = { t: d.t - c.t, s: d.s - c.s };
        const firstLength = Math.hypot(ab.t, ab.s), secondLength = Math.hypot(cd.t, cd.s);
        if (firstLength <= EPSILON || secondLength <= EPSILON) continue;
        const ac = { t: c.t - a.t, s: c.s - a.s };
        const determinant = cross(ab, cd);
        if (Math.abs(determinant) <= firstLength * secondLength * 1e-10) {
          if (Math.abs(cross(ab, ac)) / firstLength > EPSILON) continue;
          const projectionC = (ac.t * ab.t + ac.s * ab.s) / firstLength;
          const projectionD = ((d.t - a.t) * ab.t + (d.s - a.s) * ab.s) / firstLength;
          const overlap = Math.min(firstLength, Math.max(projectionC, projectionD))
            - Math.max(0, Math.min(projectionC, projectionD));
          if (overlap > EPSILON) throw new Error(`Road ${first.id} overlaps ${second.id}; shared stems must be authored once`);
          if (firstIndex === secondIndex) {
            if (j !== i + 1 && [a, b].some(point => [c, d].some(other => distance(point, other) <= EPSILON))) {
              throw new Error(`Road ${first.id} crosses itself; simplify its route`);
            }
            continue;
          }
          // Coincident endpoints still need one node, even where road classes change.
          for (const [point, fraction] of [[a, 0], [b, 1]] as const) {
            for (const [other, otherFraction] of [[c, 0], [d, 1]] as const) {
              if (distance(point, other) > EPSILON) continue;
              const nodePoint = sharedNode(point, first.id, second.id);
              cuts[firstIndex][i - 1].push({ fraction, point: nodePoint });
              cuts[secondIndex][j - 1].push({ fraction: otherFraction, point: nodePoint });
            }
          }
          continue;
        }
        const fraction = cross(ac, cd) / determinant;
        const otherFraction = cross(ac, ab) / determinant;
        if (fraction < -1e-9 || fraction > 1 + 1e-9 || otherFraction < -1e-9 || otherFraction > 1 + 1e-9) continue;
        const point = { t: a.t + ab.t * fraction, s: a.s + ab.s * fraction };
        if (firstIndex === secondIndex) {
          if (j === i + 1) continue;
          throw new Error(`Road ${first.id} crosses itself; simplify its route`);
        }
        const nodePoint = sharedNode(point, first.id, second.id);
        cuts[firstIndex][i - 1].push({ fraction: Math.max(0, Math.min(1, fraction)), point: nodePoint });
        cuts[secondIndex][j - 1].push({ fraction: Math.max(0, Math.min(1, otherFraction)), point: nodePoint });
      }
    }
  }

  const roads = inputRoads.map((road, roadIndex) => {
    const points: LocalPoint[] = [];
    for (const segment of cuts[roadIndex]) {
      segment.sort((a, b) => a.fraction - b.fraction);
      for (const cut of segment) {
        if (!points.length || distance(points.at(-1)!, cut.point) > EPSILON) points.push({ ...cut.point });
      }
    }
    return { ...road, points };
  });
  return { roads, nodes };
}
