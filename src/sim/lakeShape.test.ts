import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { isWithinLakeOutline, lakeOutlinePoints, lakeRadiusAtAngle, lakeRadiusBounds, lakeShapeProfile } from './lakeShape';

describe('campaign lake shorelines', () => {
  it('uses distinct, stable outlines while keeping the full refill disc inside each lake', () => {
    const [singapore, japan] = campaigns;
    const singaporeLake = singapore.missions[0].lake;
    const japanLake = japan.missions[0].lake;
    const singaporeOutline = lakeOutlinePoints(singapore.id, singaporeLake);
    const japanOutline = lakeOutlinePoints(japan.id, japanLake);

    expect(lakeOutlinePoints(singapore.id, singaporeLake)).toEqual(singaporeOutline);
    expect(lakeOutlinePoints(japan.id, japanLake)).toEqual(japanOutline);
    expect(singaporeOutline).not.toEqual(japanOutline);
    expect(singaporeOutline[0]).not.toEqual(japanOutline[0]);
    expect(lakeShapeProfile(singapore.id)).not.toEqual(lakeShapeProfile(japan.id));

    for (const campaign of campaigns) {
      const lake = campaign.missions[0].lake;
      const bounds = lakeRadiusBounds(campaign.id, lake.radius);
      expect(bounds.min).toBeGreaterThanOrEqual(lake.radius);
      expect(bounds.max).toBeLessThan(lake.radius * 1.37);
      expect(bounds.max).toBeGreaterThan(lake.radius * 1.35);
      const outline = lakeOutlinePoints(campaign.id, lake, 360);
      const radii = Array.from({ length: 360 }, (_, index) => lakeRadiusAtAngle(campaign.id, lake.radius, index * Math.PI / 180));
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(lake.radius * .17);
      expect(Math.max(...radii) / lake.radius).toBeGreaterThan(1.35);
      expect(Math.max(...radii) / lake.radius).toBeLessThan(1.37);
      const broadLobes = radii.filter((radius, index) => radius > lake.radius * 1.08
        && radius > radii[(index + radii.length - 1) % radii.length]
        && radius > radii[(index + 1) % radii.length]);
      // Count each cove once, including a broad floor at the refill boundary.
      const coves = radii.filter((radius, index) => radius < lake.radius * 1.11
        && radii[(index + radii.length - 1) % radii.length] >= lake.radius * 1.11);
      expect(broadLobes.length).toBeGreaterThanOrEqual(3);
      expect(coves.length).toBeGreaterThanOrEqual(3);
      const turns = outline.map((point, index) => {
        const before = outline[(index + outline.length - 1) % outline.length];
        const after = outline[(index + 1) % outline.length];
        return (point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x);
      });
      // Inlets must actually turn inward, rather than producing a merely oval lake.
      expect(turns.some(turn => turn > .001) && turns.some(turn => turn < -.001)).toBe(true);
      for (let index = 0; index < 360; index++) {
        const angle = index / 360 * Math.PI * 2;
        expect(lakeRadiusAtAngle(campaign.id, lake.radius, angle)).toBeGreaterThanOrEqual(lake.radius);
        const edge = outline[index];
        expect(isWithinLakeOutline(campaign.id, lake, edge)).toBe(true);
        const refillPoint = {
          x: lake.x + Math.cos(angle) * lake.radius,
          z: lake.z - Math.sin(angle) * lake.radius,
        };
        expect(isWithinLakeOutline(campaign.id, lake, refillPoint)).toBe(true);
      }
    }
  });
});
