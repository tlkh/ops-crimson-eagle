import { describe, expect, it } from 'vitest';
import { ExclusionLookup, type CircularExclusionZone } from './exclusionLookup';

function bruteContains(zones: readonly CircularExclusionZone[], x: number, z: number, margin = 0): boolean {
  return zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin);
}

describe('ExclusionLookup', () => {
  it('matches the strict circular test across negative coordinates and varied margins', () => {
    let seed = 0x4c3a2b1;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const zones: CircularExclusionZone[] = Array.from({ length: 600 }, () => ({
      x: (random() - .5) * 2400,
      z: (random() - .5) * 2400,
      radius: random() * 260,
    }));
    const lookup = new ExclusionLookup(zones);
    const margins = [-18, 0, 1, 25, 63, 64, 65, 150, 500];

    for (let sample = 0; sample < 4000; sample++) {
      const x = (random() - .5) * 3600;
      const z = (random() - .5) * 3600;
      const margin = margins[sample % margins.length];
      expect(lookup.contains(x, z, margin)).toBe(bruteContains(zones, x, z, margin));
    }
  });

  it('keeps the boundary strict and includes the requested margin', () => {
    const lookup = new ExclusionLookup([{ x: -64, z: 0, radius: 10 }]);
    expect(lookup.contains(-54, 0)).toBe(false);
    expect(lookup.contains(-54, 0, 1)).toBe(true);
    expect(lookup.contains(-53, 0, 1)).toBe(false);
    expect(lookup.contains(-57, 0, -2)).toBe(true);
    expect(lookup.contains(-56, 0, -2)).toBe(false);
  });

  it('handles large zones, negative radii, and non-finite margins with brute-force semantics', () => {
    const zones = [
      { x: -1000, z: 800, radius: 1_000_000 },
      { x: 4, z: -8, radius: -3 },
      { x: 9, z: 9, radius: Number.POSITIVE_INFINITY },
      { x: 0, z: 0, radius: Number.NaN },
    ];
    const lookup = new ExclusionLookup(zones);
    for (const [x, z, margin] of [
      [-1500, 800, 0], [4, -8, 2], [4, -8, 4], [900, 900, 0],
      [0, 0, Number.POSITIVE_INFINITY], [0, 0, Number.NaN], [0, 0, Number.NEGATIVE_INFINITY],
    ] as const) {
      expect(lookup.contains(x, z, margin)).toBe(bruteContains(zones, x, z, margin));
    }
  });

  it('snapshots zones so caller mutations cannot desynchronize the index', () => {
    const zones = [{ x: 0, z: 0, radius: 2 }];
    const lookup = new ExclusionLookup(zones);
    zones[0].x = 1000;
    expect(lookup.contains(1, 0)).toBe(true);
    expect(lookup.contains(1001, 0)).toBe(false);
  });

  it('rejects invalid cell sizes', () => {
    expect(() => new ExclusionLookup([], 0)).toThrow(RangeError);
    expect(() => new ExclusionLookup([], Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
