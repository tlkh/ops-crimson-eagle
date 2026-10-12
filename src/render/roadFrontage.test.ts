import { describe, expect, it } from 'vitest';
import { generateRoadFrontageCandidates, selectSpacedFrontageCandidates, type FrontageRoad } from './roadFrontage';

const roads: FrontageRoad[] = [
  { id: 'main-street', kind: 'paved', frontage: 'settlement', points: [{ t: 0, s: 0 }, { t: 1_200, s: 0 }] },
  { id: 'farm-track', kind: 'track', frontage: 'rural', points: [{ t: 0, s: 220 }, { t: 1_000, s: 220 }] },
  { id: 'fire-access', kind: 'track', frontage: 'none', points: [{ t: 0, s: -220 }, { t: 1_000, s: -220 }] },
];

describe('stable road frontage', () => {
  it('samples eligible roads at 150–220 m spacing on both sides and excludes no-frontage spurs', () => {
    const lots = generateRoadFrontageCandidates(roads, 7291);
    expect(lots.length).toBeGreaterThan(8);
    expect(lots.every(lot => lot.roadId !== 'fire-access')).toBe(true);
    for (const roadId of ['main-street', 'farm-track']) {
      const onRoad = lots.filter(lot => lot.roadId === roadId).sort((a, b) => a.chainage - b.chainage);
      expect(new Set(onRoad.map(lot => lot.side))).toEqual(new Set([-1, 1]));
      for (let i = 1; i < onRoad.length; i++) {
        expect(onRoad[i].chainage - onRoad[i - 1].chainage).toBeGreaterThanOrEqual(150);
        expect(onRoad[i].chainage - onRoad[i - 1].chainage).toBeLessThanOrEqual(220);
      }
      for (const lot of onRoad) {
        expect(Math.hypot(lot.center.t - lot.roadPoint.t, lot.center.s - lot.roadPoint.s)).toBeCloseTo(25, 5);
        expect(Math.abs(lot.tangent.t * lot.tangent.s + lot.tangent.s * -lot.tangent.t)).toBeLessThan(1e-8);
      }
    }
  });

  it('keeps the order and positions stable by road ID, then spaces accepted frontage across connected roads', () => {
    const first = generateRoadFrontageCandidates(roads, 19);
    const second = generateRoadFrontageCandidates([...roads].reverse(), 19);
    expect(second).toEqual(first);
    const selected = selectSpacedFrontageCandidates(first, candidate => candidate.roadId !== 'farm-track', 3, 140);
    expect(selected).toHaveLength(3);
    for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
      expect(Math.hypot(selected[i].center.t - selected[j].center.t, selected[i].center.s - selected[j].center.s)).toBeGreaterThanOrEqual(140);
    }
    expect(selectSpacedFrontageCandidates(first, () => false, 24)).toEqual([]);
  });
});
