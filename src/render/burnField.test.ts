import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { createBurnField, isBurnProtectedAirport } from './burnField';
import { selectFireSites } from './fire';

describe('authored burn history', () => {
  it('reconstructs the same persistent history from a mission alone', () => {
    const mission = campaigns[0].missions[0];
    const a = createBurnField(mission), b = createBurnField({ ...mission });
    expect(a.data).toEqual(b.data);
    expect(a.data.byteLength).toBe(256 * 256 * 4);
    expect(a.sample(mission.fire.x, mission.fire.z).severity).toBeGreaterThan(.9);
    expect(a.sample(Infinity, 0)).toEqual({ severity: 0, age: 0, activity: 0 });
  });

  it('places older damage upwind and keeps active fire inside every suppression target', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const field = createBurnField(mission), speed = Math.hypot(mission.wind.x, mission.wind.z);
      const wx = mission.wind.x / speed, wz = mission.wind.z / speed, r = mission.fire.radius;
      const old = field.sample(mission.fire.x - wx * r * 2.2, mission.fire.z - wz * r * 2.2);
      const fresh = field.sample(mission.fire.x, mission.fire.z);
      expect(old.severity).toBeGreaterThan(.6);
      expect(old.age).toBeGreaterThan(fresh.age + .6);
      expect(field.sample(mission.fire.x + wx * r * 1.3, mission.fire.z + wz * r * 1.3).severity).toBe(0);
      for (let i = 0; i < 48; i++) {
        const angle = i / 48 * Math.PI * 2;
        expect(field.sample(mission.fire.x + Math.cos(angle) * r, mission.fire.z + Math.sin(angle) * r).activity).toBe(0);
      }
    }
  });

  it('clips excluded water/protected ground consistently for all consumers', () => {
    const mission = campaigns[0].missions[0];
    const field = createBurnField(mission, { eligible: (x, z) => Math.hypot(x - mission.fire.x, z - mission.fire.z) > 25 });
    expect(field.sample(mission.fire.x, mission.fire.z)).toEqual({ severity: 0, age: 0, activity: 0 });
    expect(field.sample(field.bounds.minX - 1, field.bounds.minZ)).toEqual({ severity: 0, age: 0, activity: 0 });
    const calm = createBurnField({ ...mission, wind: { x: 0, z: 0 } });
    expect(Object.values(calm.bounds).every(Number.isFinite)).toBe(true);
    expect(calm.sample(mission.fire.x, mission.fire.z).severity).toBeGreaterThan(.9);
  });

  it('protects actual airport surfaces without erasing nearby playable fire sectors', () => {
    for (const mission of campaigns[1].missions) {
      const shore = mission.shore!;
      expect(isBurnProtectedAirport(mission, shore.x, shore.z)).toBe(true);
      const length = Math.hypot(shore.x - mission.ship.x, shore.z - mission.ship.z);
      const ux = (shore.x - mission.ship.x) / length, uz = (shore.z - mission.ship.z) / length;
      expect(isBurnProtectedAirport(mission, shore.x + uz * 235 + ux * 380,
        shore.z - ux * 235 + uz * 380)).toBe(true);
      const field = createBurnField(mission, { eligible: (x, z) => !isBurnProtectedAirport(mission, x, z) });
      // JP-05/06 are inside the 900m tree-clearance circle; fire must stay visible.
      const sources = selectFireSites(mission, field, 40);
      expect(sources).toHaveLength(40);
      expect(sources.every(p => !isBurnProtectedAirport(mission, p.x, p.z))).toBe(true);
    }
  });
});
