import { describe, expect, it } from 'vitest';
import { getCinematicEffectStrengths, type CinematicEffectOptions } from './cinematicEffects';

function options(overrides: Partial<CinematicEffectOptions> = {}): CinematicEffectOptions {
  return {
    enabled: true,
    reducedMotion: false,
    paused: false,
    nightStrength: 0,
    isPhone: false,
    aircraftPosition: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe('cinematic effect strengths', () => {
  it('uses the specified day/night vignette and device edge blur limits', () => {
    expect(getCinematicEffectStrengths(options()).vignette).toBeCloseTo(.08);
    expect(getCinematicEffectStrengths(options({ nightStrength: 1, isPhone: true }))).toMatchObject({
      vignette: .05,
      edgeBlurCssPixels: .75,
    });
    expect(getCinematicEffectStrengths(options()).edgeBlurCssPixels).toBe(1.25);
  });

  it('ramps motion blur from 40 to 100 km/h and observes desktop/phone caps', () => {
    const at40 = getCinematicEffectStrengths(options({ velocity: { x: 40 / 3.6, y: 0, z: 0 } }));
    const at70Phone = getCinematicEffectStrengths(options({
      isPhone: true,
      velocity: { x: 70 / 3.6, y: 0, z: 0 },
    }));
    const at100 = getCinematicEffectStrengths(options({ velocity: { x: 100 / 3.6, y: 0, z: 0 } }));
    expect(at40.motionBlurCssPixels).toBe(0);
    expect(at70Phone.motionBlurCssPixels).toBeCloseTo(.375);
    expect(at100.motionBlurCssPixels).toBe(1.5);
    expect(at100.motionBlend).toBeLessThan(.08);
  });

  it('keeps still-image softness during pause and reduced motion while suppressing motion blur', () => {
    const fastVelocity = { x: 100 / 3.6, y: 0, z: 0 };
    const reduced = getCinematicEffectStrengths(options({ reducedMotion: true, velocity: fastVelocity }));
    const paused = getCinematicEffectStrengths(options({ paused: true, velocity: fastVelocity }));
    expect(reduced).toMatchObject({ vignette: .08, edgeBlurCssPixels: 1.25, motionBlurCssPixels: 0, motionBlend: 0 });
    expect(paused.motionBlurCssPixels).toBe(0);
    expect(paused.edgeBlurCssPixels).toBe(1.25);
  });

  it('zeros all effects when disabled', () => {
    expect(getCinematicEffectStrengths(options({ enabled: false, velocity: { x: 50, y: 0, z: 0 } }))).toEqual({
      vignette: 0,
      edgeBlurCssPixels: 0,
      motionBlurCssPixels: 0,
      motionBlend: 0,
    });
  });
});
