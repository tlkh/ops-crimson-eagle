import { describe, expect, it } from 'vitest';
import type { LocalPoint } from '../content/geography';
import { createJunctionMeshPair, junctionOutline, junctionTrimIntervals, trimRoadForJunctions, type JunctionArm } from './roadJunctions';

const arm = (roadId: string, degrees: number, kind: JunctionArm['kind'] = 'gravel'): JunctionArm => {
  const angle = degrees * Math.PI / 180;
  return { roadId, kind, direction: { t: Math.cos(angle), s: Math.sin(angle) } };
};

describe('road junction geometry', () => {
  const cases: Array<[string, JunctionArm[]]> = [
    ['same-kind T', [arm('north', 90), arm('east', 0), arm('west', 180)]],
    ['mixed-kind Y', [arm('north-east', 42, 'paved'), arm('south-east', -42, 'gravel'), arm('west', 180, 'track')]],
    ['same-kind four-way', [arm('north', 90), arm('east', 0), arm('south', -90), arm('west', 180)]],
  ];

  for (const [name, arms] of cases) it(`builds a closed, non-degenerate conforming apron for a ${name}`, () => {
    const pair = createJunctionMeshPair({ position: { t: 300, s: -120 }, arms }, (t, s) => ({ x: t, z: s }), (x, z) => .0003 * x + .0002 * z);
    expect(pair).not.toBeNull();
    expect(pair!.outline.length).toBeGreaterThanOrEqual(5);
    for (const geometry of [pair!.surface, pair!.shoulder]) {
      const positions = geometry.getAttribute('position');
      const indices = geometry.index!;
      expect(indices.count).toBeGreaterThan(0);
      for (let i = 0; i < indices.count; i += 3) {
        const ai = indices.getX(i), bi = indices.getX(i + 1), ci = indices.getX(i + 2);
        const a = { x: positions.getX(ai), z: positions.getZ(ai) };
        const b = { x: positions.getX(bi), z: positions.getZ(bi) };
        const c = { x: positions.getX(ci), z: positions.getZ(ci) };
        expect(Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))).toBeGreaterThan(1e-5);
      }
      const normals = geometry.getAttribute('normal');
      for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(.5);
    }
    expect(pair!.surface.getAttribute('position').getY(0)).toBeCloseTo(.22 + .0003 * 300 - .0002 * 120, 5);
    expect(pair!.shoulder.getAttribute('position').getY(0)).toBeCloseTo(.12 + .0003 * 300 - .0002 * 120, 5);
    pair!.surface.dispose(); pair!.shoulder.dispose();
  });

  it('trims only the incident road arms so centerline strips meet the apron cleanly', () => {
    const points: LocalPoint[] = [{ t: -100, s: 0 }, { t: 0, s: 0 }, { t: 0, s: 100 }];
    const junction = { id: 'village-cross', position: { t: 0, s: 0 }, arms: [arm('main', 180), arm('main', 90), arm('link', 0)] };
    const intervals = junctionTrimIntervals(points, [junction], 'main', 12);
    expect(intervals).toEqual([[88, 112]]);
    const trimmed = trimRoadForJunctions(points, intervals);
    expect(trimmed).toHaveLength(2);
    expect(trimmed[0].at(-1)).toEqual({ t: -12, s: 0 });
    expect(trimmed[1][0]).toEqual({ t: 0, s: 12 });
    expect(trimRoadForJunctions(points, junctionTrimIntervals(points, [junction], 'other', 12))).toEqual([points]);
  });

  it('tessellates aprons against varying terrain at a bounded spacing', () => {
    const groundAt = (x: number, z: number) => .8 * Math.sin(x * .55) * Math.cos(z * .47) + .001 * x;
    const pair = createJunctionMeshPair(
      { position: { t: 18, s: -11 }, arms: [arm('north', 90), arm('east', 0), arm('south', -90), arm('west', 180)] },
      (t, s) => ({ x: t, z: s }),
      groundAt,
    );
    expect(pair).not.toBeNull();

    for (const [geometry, lift] of [[pair!.surface, .22], [pair!.shoulder, .12]] as const) {
      const positions = geometry.getAttribute('position');
      const indices = geometry.index!;
      expect(positions.count).toBeGreaterThan(100);
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        expect(y).toBeCloseTo(groundAt(x, z) + lift, 4);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      expect(maxY - minY).toBeGreaterThan(.2);
      for (let i = 0; i < indices.count; i += 3) {
        const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
        for (let edge = 0; edge < 3; edge++) {
          const a = ids[edge], b = ids[(edge + 1) % 3];
          const distance = Math.hypot(positions.getX(a) - positions.getX(b), positions.getZ(a) - positions.getZ(b));
          expect(distance).toBeLessThanOrEqual(2.5001);
        }
      }
      geometry.dispose();
    }
  });

  it('deduplicates parallel arm endpoints and rejects malformed isolated nodes', () => {
    expect(junctionOutline([arm('a', 0), arm('b', 0)])).toEqual([]);
    expect(createJunctionMeshPair({ position: { t: 0, s: 0 }, arms: [arm('only', 90)] }, (t, s) => ({ x: t, z: s }), () => 0)).toBeNull();
  });
});
