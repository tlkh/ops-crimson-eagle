import { describe, expect, it } from 'vitest';
import type { Mission } from '../types';
import { createBurnField, type BurnField } from './burnField';
import { selectFireSites, selectResidualSmokeSites } from './fire';

const mission = {
  seed: 91003,
  wind: { x: 1, z: 0 },
  fire: { x: 0, z: 0, radius: 100 },
} as Mission;

function makeField(sample: BurnField['sample']): BurnField {
  const data = new Uint8Array(96 * 96 * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return {
    bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 },
    size: 96,
    data,
    sample,
  };
}

describe('fire field placement', () => {
  it('selects deterministic active sources along the front and keeps interior hotspots', () => {
    const field = makeField((x, z) => {
      const radial = Math.hypot(x, z) / mission.fire.radius;
      const frontArc = radial >= .56 && radial <= .82 && x / mission.fire.radius > -.2;
      const hotspot = radial <= .42;
      return {
        severity: frontArc ? .9 : hotspot ? .55 : 0,
        age: frontArc ? .12 : hotspot ? .24 : 0,
        activity: frontArc ? .92 : hotspot ? .18 : 0,
      };
    });

    const sites = selectFireSites(mission, field, 40);
    expect(selectFireSites(mission, field, 40)).toEqual(sites);
    expect(sites).toHaveLength(40);
    expect(sites.every(site => Math.hypot(site.x, site.z) <= 94)).toBe(true);
    expect(sites.filter(site => Math.hypot(site.x, site.z) / 100 > .52).length).toBeGreaterThanOrEqual(28);
    expect(sites.filter(site => Math.hypot(site.x, site.z) / 100 <= .52).length).toBeGreaterThanOrEqual(8);
    const lowQuality = sites.slice(0, 20);
    expect(lowQuality.filter(site => Math.hypot(site.x, site.z) / 100 > .52).length).toBe(15);
    expect(lowQuality.filter(site => Math.hypot(site.x, site.z) / 100 <= .52).length).toBe(5);
    expect(sites.reduce((sum, site) => sum + site.x, 0) / sites.length).toBeGreaterThan(0);
  });

  it('uses old inactive burn history only for smoke outside the active suppression radius', () => {
    const field = makeField((x, z) => {
      const radial = Math.hypot(x, z) / mission.fire.radius;
      const oldUpwindTail = radial > 1 && x < -90;
      const activeFront = radial > .56 && radial < .82 && x > 0;
      return {
        severity: oldUpwindTail ? .82 : activeFront ? .9 : 0,
        age: oldUpwindTail ? .91 : activeFront ? .1 : 0,
        activity: activeFront ? .8 : 0,
      };
    });

    const sites = selectResidualSmokeSites(mission, field, 6);
    expect(selectResidualSmokeSites(mission, field, 6)).toEqual(sites);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(site => Math.hypot(site.x, site.z) / 100 > .96)).toBe(true);
    expect(sites.every(site => site.age > .56 && site.activity <= .025)).toBe(true);
  });

  it('returns no active sources for an empty activity field without retry loops', () => {
    const empty = makeField(() => ({ severity: 0, age: 0, activity: 0 }));
    expect(selectFireSites(mission, empty, 50)).toEqual([]);
  });

  it('keeps sources off terrain masked out of the shared burn field', () => {
    const clipped = makeField(() => ({ severity: 1, age: .8, activity: 1 }));
    clipped.data.fill(0);

    expect(selectFireSites(mission, clipped, 20)).toEqual([]);
    expect(selectResidualSmokeSites(mission, clipped, 6)).toEqual([]);
  });

  it('finds both the active front and aged residual tail in the authored field', () => {
    const field = createBurnField(mission);
    const flames = selectFireSites(mission, field, 40);
    const smoke = selectResidualSmokeSites(mission, field, 4);

    expect(flames).toHaveLength(40);
    expect(flames.every(site => Math.hypot(site.x, site.z) <= mission.fire.radius * .94)).toBe(true);
    expect(smoke.length).toBeGreaterThan(0);
    expect(smoke.every(site => Math.hypot(site.x, site.z) > mission.fire.radius * .96 && site.activity <= .025)).toBe(true);
  });
});
