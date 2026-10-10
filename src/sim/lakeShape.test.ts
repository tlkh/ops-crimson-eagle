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
      expect(bounds.max).toBeLessThan(lake.radius * 1.28);
      expect(bounds.max).toBeGreaterThan(lake.radius * 1.25);
      const outline = lakeOutlinePoints(campaign.id, lake, 360);
      const radii = Array.from({ length: 360 }, (_, index) => lakeRadiusAtAngle(campaign.id, lake.radius, index * Math.PI / 180));
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(lake.radius * .17);
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
