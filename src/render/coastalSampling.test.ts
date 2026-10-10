import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { createCoastalSampler, SEA_SURFACE_Y, type CoastalSampleBuffer } from './coastalSampling';

describe('coastal surface sampler', () => {
  const campaign = campaigns[0];
  const mission = campaign.missions[0];

  it('round-trips local coast coordinates and follows the collision coastline', () => {
    const sampler = createCoastalSampler(campaign, mission);
    const point = sampler.fromLocal(0, 725);
    const local = sampler.toLocal(point.x, point.z);
    expect(local.x).toBeCloseTo(0, 8);
    expect(local.z).toBeCloseTo(725, 8);

    const shore = sampler.fromLocal(sampler.coastAt(725) - 50, 725);
    const sample = sampler.sample(shore.x, shore.z);
    expect(sample.shoreDistance).toBeCloseTo(-50, 6);
    expect(sample.terrainHeight).toBeNull();
    expect(sample.surfaceHeight).toBe(SEA_SURFACE_Y);
    expect(sample.isShallow).toBe(true);
  });

  it('reuses the caller buffer for allocation-free frame sampling', () => {
    const sampler = createCoastalSampler(campaign, mission);
    const point = sampler.fromLocal(sampler.coastAt(-440) + 160, -440);
    const out: CoastalSampleBuffer = { t: 0, s: 0, shoreDistance: 0, terrainHeight: null, surfaceHeight: 0, isLand: false, isShallow: false };
    expect(sampler.sampleInto(point.x, point.z, out)).toBe(out);
    expect(out.shoreDistance).toBeCloseTo(160, 6);
    expect(out.isLand).toBe(true);
    expect(out.isShallow).toBe(false);
  });
});
