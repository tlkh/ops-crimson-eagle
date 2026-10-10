import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { evaluateTimeOfDay } from './timeOfDay';

function mission(id: string) {
  const result = campaigns.flatMap((campaign) => campaign.missions).find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing mission ${id}`);
  return result;
}

function expectTupleClose(actual: readonly number[], expected: readonly number[], precision = 8) {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], precision));
}

describe('evaluateTimeOfDay', () => {
  it('uses simulation time, clamps before the start, and holds the authored endpoint', () => {
    const sg01 = mission('SG-01');
    expect(evaluateTimeOfDay(sg01, -10)).toEqual(evaluateTimeOfDay(sg01, 0));
    expect(evaluateTimeOfDay(sg01, 301)).toEqual(evaluateTimeOfDay(sg01, 300));
    expect(evaluateTimeOfDay(sg01, 900)).toEqual(evaluateTimeOfDay(sg01, 300));
  });

  it('produces the same sky at the matching time across the midnight wrap', () => {
    const sg01Start = evaluateTimeOfDay(mission('SG-01'), 0);
    const sg06End = evaluateTimeOfDay(mission('SG-06'), 300);
    expectTupleClose(sg06End.sunDirection, sg01Start.sunDirection);
    expectTupleClose(sg06End.skyZenith, sg01Start.skyZenith);
    expectTupleClose(sg06End.skyHorizon, sg01Start.skyHorizon);
    expectTupleClose(sg06End.fogColor, sg01Start.fogColor);
    expect(sg06End.sunIntensity).toBeCloseTo(sg01Start.sunIntensity, 8);
    expect(sg06End.nightStrength).toBeCloseTo(sg01Start.nightStrength, 8);
  });

  it('keeps the sun below the horizon at midnight and above it at midday', () => {
    const night = evaluateTimeOfDay(mission('SG-06'), 0);
    const midday = evaluateTimeOfDay(mission('SG-02'), 300);
    const dawn = evaluateTimeOfDay(mission('SG-01'), 0);
    expect(night.sunDirection[1]).toBeLessThan(0);
    expect(night.sunIntensity).toBe(0);
    expect(night.nightStrength).toBeGreaterThan(0.99);
    expect(night.sunIntensity).toBe(0);
    expect(night.nightStrength).toBeGreaterThan(dawn.nightStrength);
    expect(dawn.skyHorizon[0]).toBeGreaterThan(night.skyHorizon[0]);
    expect(midday.sunDirection[1]).toBeGreaterThan(0.9);
    expect(midday.sunIntensity).toBeGreaterThan(3);
    expect(midday.nightStrength).toBeLessThan(0.01);
    expect(Math.hypot(...midday.sunDirection)).toBeCloseTo(1, 12);
  });

  it('keeps the solar direction unit length through a full day and night', () => {
    const fullDay = {
      ...mission('SG-01'),
      durationTargetSec: 86_400,
      timeOfDay: { startMinutes: 0, endMinutes: 1440 },
    };
    for (let timeSec = 0; timeSec <= fullDay.durationTargetSec; timeSec += 300) {
      const { sunDirection } = evaluateTimeOfDay(fullDay, timeSec);
      expect(Math.hypot(...sunDirection)).toBeCloseTo(1, 12);
    }
  });

  it('keeps adjacent sorties temporally continuous at their shared endpoints', () => {
    const sg02Start = evaluateTimeOfDay(mission('SG-02'), 0);
    const sg01End = evaluateTimeOfDay(mission('SG-01'), 300);
    expectTupleClose(sg02Start.sunDirection, sg01End.sunDirection);
    expectTupleClose(sg02Start.skyZenith, sg01End.skyZenith);
    expectTupleClose(sg02Start.fogColor, sg01End.fogColor);
  });
});
