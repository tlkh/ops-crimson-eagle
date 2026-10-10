import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, qualityProfile, RenderCadence, scenePixelRatio } from './quality';

describe('mobile render budgets', () => {
  it('reduces extra passes before scene pixels and leaves high mode stable', () => {
    expect(qualityProfile('auto', true, 0).targetFps).toBe(30);
    expect(qualityProfile('auto', false, 0).targetFps).toBe(60);
    expect(qualityProfile('auto', true, 1).renderScale).toBe(1);
    expect(qualityProfile('auto', true, 3).reflections).toBe(false);
    expect(qualityProfile('high', true, 3)).toEqual(qualityProfile('high', true, 0));
    expect(qualityProfile('battery', false).targetFps).toBe(30);
  });
  it('caps high-DPI and large displays while retaining native CSS coordinates', () => {
    expect(scenePixelRatio(390, 844, 3, 1)).toBe(1.5);
    expect(scenePixelRatio(1920, 1080, 2, 1)).toBe(.75);
    expect(scenePixelRatio(390, 844, 3, .7)).toBeCloseTo(1.05);
  });
  it('ignores warm-up and isolated stalls but reacts to sustained overload', () => {
    const adaptive = new AdaptiveQuality();
    for (let i = 0; i < 40; i++) adaptive.observe(50, 35, null, 30);
    expect(adaptive.level).toBe(0);
    adaptive.observe(1000, 800, null, 30);
    for (let i = 0; i < 70; i++) adaptive.observe(1000 / 30, 4, null, 30);
    adaptive.observe(100, 50, null, 30);
    for (let i = 0; i < 100; i++) adaptive.observe(1000 / 30, 4, null, 30);
    expect(adaptive.level).toBe(0);
    for (let i = 0; i < 130; i++) adaptive.observe(50, 35, null, 30);
    expect(adaptive.level).toBeGreaterThan(0);
  });
  it('keeps 30Hz cadence on 60, 90 and 120Hz displays', () => {
    for (const refresh of [60, 90, 120]) {
      const cadence = new RenderCadence();
      let rendered = 0;
      for (let tick = 0; tick < refresh * 10; tick++) if (cadence.take(tick * 1000 / refresh, 30) !== null) rendered++;
      expect(rendered).toBe(300);
    }
  });
  it('does not mistake 90Hz display quantization for sustained 60fps overload', () => {
    const cadence = new RenderCadence();
    const adaptive = new AdaptiveQuality();
    for (let tick = 0; tick < 90 * 40; tick++) {
      const delta = cadence.take(tick * 1000 / 90, 60);
      if (delta !== null) adaptive.observe(delta * 1000, 3, 7, 60);
    }
    expect(adaptive.level).toBe(0);
  });
  it('resets a slow paused deadline for immediate resume', () => {
    const cadence = new RenderCadence();
    cadence.take(1000, 2);
    expect(cadence.take(1100, 60)).toBeNull();
    cadence.reset();
    expect(cadence.take(1100, 60)).not.toBeNull();
  });
  it('recovers one level only after a long stable period', () => {
    const adaptive = new AdaptiveQuality(); adaptive.level = 2;
    for (let i = 0; i < 600; i++) adaptive.observe(1000 / 30, 3, 8, 30);
    expect(adaptive.level).toBe(2);
    for (let i = 0; i < 400; i++) adaptive.observe(1000 / 30, 3, 8, 30);
    expect(adaptive.level).toBe(1);
  });
});
