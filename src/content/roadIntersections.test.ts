import { describe, expect, it } from 'vitest';
import type { CampaignRoad, RoadGraphNode } from './geography';
import { buildRoadGraph } from './roadGraph';
import { nodeRoadIntersections } from './roadIntersections';

const road = (id: string, coordinates: Array<[number, number]>): CampaignRoad => ({
  id, kind: 'gravel', points: coordinates.map(([t, s]) => ({ t, s })),
});
const endNodes = (roads: CampaignRoad[]): RoadGraphNode[] => roads.flatMap(item => [
  { id: `${item.id}-start`, kind: 'worksite' as const, position: item.points[0] },
  { id: `${item.id}-end`, kind: 'worksite' as const, position: item.points.at(-1)! },
]);

describe('at-grade road intersections', () => {
  it('nodes a same-kind cross and preserves all four connected approaches', () => {
    const roads = [road('collector', [[-40, 0], [40, 0]]), road('branch', [[0, -30], [0, 30]])];
    const initial = JSON.stringify(roads);
    const noded = nodeRoadIntersections(roads, endNodes(roads));
    const graph = buildRoadGraph(noded.roads, noded.nodes);
    expect(graph.junctions).toHaveLength(1);
    expect(graph.junctions[0].arms).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(noded.roads.every(item => item.points.some(point => point.t === 0 && point.s === 0))).toBe(true);
    expect(JSON.stringify(roads)).toBe(initial);
    expect(nodeRoadIntersections(roads, endNodes(roads))).toEqual(noded);
  });

  it('reuses an existing destination anchor for a T junction in the middle of a road', () => {
    const roads = [road('collector', [[-40, 0], [40, 0]]), road('farm-access', [[0, -30], [0, 0]])];
    const noded = nodeRoadIntersections(roads, endNodes(roads));
    const graph = buildRoadGraph(noded.roads, noded.nodes);
    expect(graph.junctions).toHaveLength(1);
    expect(graph.junctions[0].id).toBe('farm-access-end');
    expect(graph.junctions[0].arms).toHaveLength(3);
    expect(noded.nodes.filter(node => node.position.t === 0 && node.position.s === 0)).toHaveLength(1);
  });

  it('does not invent a junction for roads that nearly meet', () => {
    const roads = [road('collector', [[-40, 0], [40, 0]]), road('branch', [[0, -30], [0, -2]])];
    const noded = nodeRoadIntersections(roads, endNodes(roads));
    expect(noded.roads).toEqual(roads);
    expect(buildRoadGraph(noded.roads, noded.nodes).junctions).toHaveLength(0);
  });

  it('rejects duplicated stems and self-crossing routes instead of creating false joins', () => {
    const overlap = [road('one', [[-40, 0], [40, 0]]), road('two', [[0, 0], [70, 0]])];
    expect(() => nodeRoadIntersections(overlap, endNodes(overlap))).toThrow('overlaps');
    const loop = [road('loop', [[0, 0], [20, 20], [0, 20], [20, 0]])];
    expect(() => nodeRoadIntersections(loop, endNodes(loop))).toThrow('crosses itself');
    const retraced = [road('retraced', [[0, 0], [20, 0], [5, 0]])];
    expect(() => nodeRoadIntersections(retraced, endNodes(retraced))).toThrow('overlaps');
  });
});
