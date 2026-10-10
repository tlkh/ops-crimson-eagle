import { describe, expect, it } from 'vitest';
import { environmentPaletteWeights } from './environmentLighting';
import { evaluateTimeOfDay } from './timeOfDay';
import type { Mission } from '../types';

const atMinute = (minute: number) => evaluateTimeOfDay({
  durationTargetSec: 300, timeOfDay: { startMinutes: minute, endMinutes: minute },
} as Mission, 0);

describe('environment palette transitions', () => {
  it('conserves reflected energy with nonnegative weights throughout a full day', () => {
    for (let minute = 0; minute <= 1440; minute++) {
      const weights = environmentPaletteWeights(atMinute(minute));
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
      expect(weights.every(weight => weight >= 0 && weight <= 1)).toBe(true);
    }
  });
  it('has no palette discontinuity at dawn, noon, dusk or midnight', () => {
    let previous = environmentPaletteWeights(atMinute(0));
    for (let minute = .1; minute <= 1440; minute += .1) {
      const current = environmentPaletteWeights(atMinute(minute));
      expect(Math.max(...current.map((weight, index) => Math.abs(weight - previous[index])))).toBeLessThan(.003);
      previous = current;
    }
    expect(environmentPaletteWeights(atMinute(0))).toEqual(environmentPaletteWeights(atMinute(1440)));
  });
  it('reaches night/day and uses the appropriate twilight palette', () => {
    expect(environmentPaletteWeights(atMinute(0))).toEqual([1, 0, 0, 0]);
    expect(environmentPaletteWeights(atMinute(720))).toEqual([0, 0, 1, 0]);
    expect(environmentPaletteWeights(atMinute(360))[1]).toBeGreaterThan(.5);
    expect(environmentPaletteWeights(atMinute(1080))[3]).toBeGreaterThan(.5);
  });
});
