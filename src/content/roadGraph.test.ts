import { describe, expect, it } from 'vitest';
import type { CampaignRoad, LocalPoint, RoadGraphNode } from './geography';
import { buildRoadGraph, findUnmodeledRoadCrossings, smoothRoadPath } from './roadGraph';

const point = (t: number, s: number): LocalPoint => ({ t, s });

describe('road graph geometry', () => {
  it('splits roads at named junction nodes and keeps exact polyline geometry', () => {
    const roads: CampaignRoad[] = [
      { id: 'through', kind: 'paved', frontage: 'settlement', points: [point(0, 0), point(10, 0), point(20, 0)] },
      { id: 'branch', kind: 'gravel', frontage: 'rural', points: [point(10, -8), point(10, 0)] },
    ];
    const nodes: RoadGraphNode[] = [
      { id: 'west', kind: 'junction', position: point(0, 0) },
      { id: 'crossroads', kind: 'junction', position: point(10, 0) },
      { id: 'east', kind: 'junction', position: point(20, 0) },
      { id: 'branch-end', kind: 'farm', position: point(10, -8) },
    ];
    const graph = buildRoadGraph(roads, nodes);
    expect(graph.edges).toHaveLength(3);
    expect(graph.junctions).toHaveLength(1);
    expect(graph.junctions[0].id).toBe('crossroads');
    expect(graph.junctions[0].arms).toHaveLength(3);
    expect(graph.edges.every(edge => edge.points.length >= 2)).toBe(true);
  });

  it('smooths ordinary bends while preserving junction vertices exactly', () => {
    const junction = point(10, 0);
    const smoothed = smoothRoadPath([point(0, 0), junction, point(10, 20)], [junction], 4);
    expect(smoothed).toContainEqual(junction);
    expect(smoothed[0]).toEqual(point(0, 0));
    expect(smoothed.at(-1)).toEqual(point(10, 20));
  });

  it('rejects unmodeled crossings, duplicate stems, and one-road self-retrace', () => {
    const crossing: CampaignRoad[] = [
      { id: 'east-west', kind: 'paved', points: [point(-10, 0), point(10, 0)] },
      { id: 'north-south', kind: 'gravel', points: [point(0, -10), point(0, 10)] },
    ];
    expect(findUnmodeledRoadCrossings(crossing)).toHaveLength(1);

    const duplicate: CampaignRoad[] = [
      { id: 'first', kind: 'paved', points: [point(0, 0), point(10, 0)] },
      { id: 'second', kind: 'gravel', points: [point(2, 0), point(8, 0)] },
    ];
    expect(findUnmodeledRoadCrossings(duplicate)[0]).toContain('overlapping');

    const retrace: CampaignRoad[] = [
      { id: 'out-and-back', kind: 'track', points: [point(0, 0), point(10, 0), point(3, 0)] },
    ];
    expect(findUnmodeledRoadCrossings(retrace)[0]).toContain('overlapping');
  });

  it('flags a nonadjacent self-crossing even within a single road', () => {
    const crossing: CampaignRoad[] = [
      { id: 'bow-tie', kind: 'track', points: [point(0, 0), point(10, 10), point(0, 10), point(10, 0)] },
    ];
    expect(findUnmodeledRoadCrossings(crossing)[0]).toContain('crosses itself');
  });
});
