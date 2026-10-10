import { describe, expect, it } from 'vitest';
import { FLIGHT_STICK_RESPONSE, mapStickResponse, normalizeStickVector } from './stickResponse';

describe('mobile flight stick response', () => {
  it('stays neutral through the radial deadzone and changes continuously just beyond it', () => {
    const deadzone = FLIGHT_STICK_RESPONSE.deadzone;
    expect(mapStickResponse(0, 0, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(mapStickResponse(deadzone, 0, 1, 1)).toEqual({ x: 0, y: 0 });
    expect(mapStickResponse(deadzone + 0.001, 0, 1, 1).x).toBeLessThan(0.001);
    expect(mapStickResponse(0.25, 0, 1, 1).x).toBeLessThan(0.25);
  });

  it('responds monotonically and symmetrically in each direction', () => {
    const levels = [0.1, 0.25, 0.5, 0.75, 1].map(value => mapStickResponse(value, 0, 1, 1).x);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(mapStickResponse(-0.5, 0, 1, 1).x).toBeCloseTo(-mapStickResponse(0.5, 0, 1, 1).x);
    expect(mapStickResponse(0, -0.5, 1, 1).y).toBeCloseTo(-mapStickResponse(0, 0.5, 1, 1).y);
  });

  it('preserves diagonal direction while keeping visual and command vectors bounded', () => {
    const diagonal = normalizeStickVector(1, 1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
    expect(diagonal.x).toBeCloseTo(diagonal.y);

    const response = mapStickResponse(1, 1, 0.72, 0.84);
    expect(Math.hypot(response.x / 0.72, response.y / 0.84)).toBeCloseTo(1);
    expect(Math.abs(response.x)).toBeLessThanOrEqual(0.72);
    expect(Math.abs(response.y)).toBeLessThanOrEqual(0.84);
    expect(normalizeStickVector(0.4, 0.3)).toEqual({ x: 0.4, y: 0.3 });
  });

  it('respects separate yaw, cyclic, and collective peaks', () => {
    expect(mapStickResponse(-1, 0, FLIGHT_STICK_RESPONSE.yawLimit, FLIGHT_STICK_RESPONSE.collectiveLimit).x)
      .toBeCloseTo(-FLIGHT_STICK_RESPONSE.yawLimit);
    expect(mapStickResponse(0, 1, FLIGHT_STICK_RESPONSE.cyclicLimit, FLIGHT_STICK_RESPONSE.cyclicLimit).y)
      .toBeCloseTo(FLIGHT_STICK_RESPONSE.cyclicLimit);
    expect(mapStickResponse(0, -1, FLIGHT_STICK_RESPONSE.yawLimit, FLIGHT_STICK_RESPONSE.collectiveLimit).y)
      .toBeCloseTo(-FLIGHT_STICK_RESPONSE.collectiveLimit);
  });
});
