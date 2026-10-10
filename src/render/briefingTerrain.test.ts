import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { buildBriefingMapModel, projectBriefingMapCoordinate } from '../ui/briefingMap';
import { briefingTerrainCameraProjection } from './briefingTerrain';

describe('briefing terrain camera projection', () => {
  it('matches the map model at 2× raster resolution for every mission', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const model = buildBriefingMapModel(campaign, mission);
      const camera = briefingTerrainCameraProjection(mission, model);
      expect(camera.width).toBe(960);
      expect(camera.height).toBe(1200);
      expect(camera.rightX).toBeCloseTo(model.basis.lateralX, 12);
      expect(camera.rightZ).toBeCloseTo(model.basis.lateralZ, 12);

      const points = [
        mission.ship,
        ...(mission.shore ? [mission.shore] : []),
        mission.lake,
        mission.fire,
        {
          x: mission.ship.x + model.basis.lateralX * 215,
          z: mission.ship.z + model.basis.lateralZ * 215,
        },
        {
          x: mission.ship.x + model.basis.inlandX * 315,
          z: mission.ship.z + model.basis.inlandZ * 315,
        },
      ];

      for (const point of points) {
        const screenX = camera.width / 2 + (
          (point.x - camera.centerX) * camera.rightX + (point.z - camera.centerZ) * camera.rightZ
        ) * camera.scale;
        const screenY = camera.height / 2 - (
          (point.x - camera.centerX) * model.basis.inlandX + (point.z - camera.centerZ) * model.basis.inlandZ
        ) * camera.scale;
        const expected = projectBriefingMapCoordinate(model, mission, point);
        expect(screenX).toBeCloseTo(expected.x * 2, 8);
        expect(screenY).toBeCloseTo(expected.y * 2, 8);
      }
    }
  });
});
