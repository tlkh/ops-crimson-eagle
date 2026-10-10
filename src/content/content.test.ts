import { describe, expect, it } from 'vitest';
import { campaigns, getCampaign, getMission, validateContent } from './index';
import { assetProvenance, scenarioPackages, sourceRegister } from './provenance';
import { lakeRadiusBounds } from '../sim/lakeShape';

describe('campaign content', () => {
  it('validates the two complete compact campaign packages', () => {
    expect(validateContent()).toEqual([]);
    expect(campaigns.map(({ id }) => id)).toEqual(['sg_fictional_2026_10', 'jp_ketapang_2026_09']);
    expect(campaigns.map(({ missions }) => missions.length)).toEqual([6, 6]);
    expect(campaigns[0].missions.map(({ id }) => id)).toEqual(['SG-01', 'SG-02', 'SG-03', 'SG-04', 'SG-05', 'SG-06']);
    expect(campaigns[1].missions.map(({ id }) => id)).toEqual(['JP-01', 'JP-02', 'JP-03', 'JP-04', 'JP-05', 'JP-06']);
  });

  it('keeps each campaign on one local map and distinguishes every fire target', () => {
    for (const campaign of campaigns) {
      const [first, ...rest] = campaign.missions;
      const poses = new Set(campaign.missions.map(mission => `${mission.ship.x},${mission.ship.z},${mission.shipHeading}`));
      expect(poses.size).toBe(campaign.missions.length);
      expect(campaign.missions.every(mission => Math.hypot(mission.ship.x, mission.ship.z) <= 30)).toBe(true);
      for (const mission of rest) {
        expect(mission.lake).toMatchObject({ x: first.lake.x, z: first.lake.z });
        expect(mission.fire).not.toMatchObject({ x: first.fire.x, z: first.fire.z });
        if (campaign.id === 'jp_ketapang_2026_09') expect(mission.shore).toMatchObject({ x: first.shore?.x, z: first.shore?.z });
      }
    }

    const singapore = campaigns[0];
    expect(Math.hypot(singapore.missions[0].lake.x, singapore.missions[0].lake.z)).toBeGreaterThanOrEqual(1400);
    expect(Math.hypot(singapore.missions[0].lake.x, singapore.missions[0].lake.z)).toBeLessThanOrEqual(1600);
    const japan = campaigns[1].missions[0];
    expect(Math.hypot(japan.shore!.x, japan.shore!.z)).toBeGreaterThanOrEqual(350);
    expect(Math.hypot(japan.lake.x - japan.shore!.x, japan.lake.z - japan.shore!.z)).toBeGreaterThanOrEqual(1000);
    expect(Math.hypot(japan.lake.x - japan.shore!.x, japan.lake.z - japan.shore!.z)).toBeLessThanOrEqual(1100);
  });

  it('keeps every fire patch clear of the freshwater shore', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const separation = Math.hypot(mission.fire.x - mission.lake.x, mission.fire.z - mission.lake.z);
      expect(separation).toBeGreaterThan(lakeRadiusBounds(campaign.id, mission.lake.radius).max + mission.fire.radius + 20);
    }
  });

  it('provides safe lookups without inventing a fallback campaign or mission', () => {
    expect(getCampaign('sg_fictional_2026_10')?.missions[0].id).toBe('SG-01');
    expect(getCampaign('jp_ketapang_2026_09')?.missions[0].id).toBe('JP-01');
    expect(getMission('sg_fictional_2026_10', 'SG-06')?.requiredDrops).toBeGreaterThan(1);
    expect(getMission('jp_ketapang_2026_09', 'missing')).toBeUndefined();
  });

  it('keeps scenario and asset citations resolvable and labels geometry provenance', () => {
    const registered = new Set(sourceRegister.map(({ id }) => id));
    expect(registered.size).toBe(sourceRegister.length);
    for (const item of assetProvenance) for (const sourceId of item.sourceIds) expect(registered.has(sourceId)).toBe(true);
    for (const item of scenarioPackages) for (const sourceId of item.evidenceReferences) expect(registered.has(sourceId)).toBe(true);
    expect(scenarioPackages).toHaveLength(2);
    expect(scenarioPackages[1].freshwaterPolygons[0].provenance).toBe('fictional_gameplay');
    expect(scenarioPackages[1].authoredFirePatches.every((patch) => patch.provenance === 'fictional_gameplay')).toBe(true);
  });
});
