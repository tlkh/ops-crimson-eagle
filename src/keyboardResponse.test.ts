import { describe, expect, it } from 'vitest';
import { createKeyboardResponse } from './keyboardResponse';

const tick = 1 / 60;

describe('keyboard flight response', () => {
  it('keeps short taps gentle compared with raw full input', () => {
    const response = createKeyboardResponse();
    let integratedYaw = 0;
    for (let frame = 0; frame < 4; frame += 1) {
      integratedYaw += response.sample(new Set(['a']), tick).yaw * tick;
    }

    expect(integratedYaw).toBeGreaterThan(0);
    expect(integratedYaw).toBeLessThan(4 * tick * 0.2);
    expect(integratedYaw).toBeLessThan(4 * tick);
    expect(response.sample(new Set(), tick).yaw).toBe(0);
  });

  it('uses lowercase browser key names and smoothly reaches each axis cap after 0.75 seconds', () => {
    const response = createKeyboardResponse();
    const keys = new Set(['a', 'w', 'arrowright', 'arrowup']);
    const first = response.sample(keys, tick);
    expect(first).toEqual({ yaw: 0.16, climb: 0.16, cyclicX: 0.16, cyclicY: 0.16 });

    let previous = first;
    for (let frame = 1; frame <= 45; frame += 1) {
      const current = response.sample(keys, tick);
      expect(current.yaw).toBeGreaterThanOrEqual(previous.yaw);
      expect(current.climb).toBeGreaterThanOrEqual(previous.climb);
      expect(current.cyclicX).toBeGreaterThanOrEqual(previous.cyclicX);
      expect(current.cyclicY).toBeGreaterThanOrEqual(previous.cyclicY);
      previous = current;
    }

    expect(previous).toEqual({ yaw: 0.65, climb: 0.8, cyclicX: 0.8, cyclicY: 0.8 });
    const negative = response.sample(new Set(['d', 's', 'arrowleft', 'arrowdown']), 0);
    expect(negative).toEqual({ yaw: -0.16, climb: -0.16, cyclicX: -0.16, cyclicY: -0.16 });
  });

  it('ramps axes independently and resets only the released axis', () => {
    const response = createKeyboardResponse();
    const both = new Set(['a', 'w']);
    response.sample(both, 0.1);
    const beforeRelease = response.sample(both, 0);

    response.releaseKey('a');
    const afterRelease = response.sample(new Set(['w']), 0);
    expect(afterRelease.yaw).toBe(0);
    expect(afterRelease.climb).toBe(beforeRelease.climb);

    const repress = response.sample(both, 0);
    expect(repress.yaw).toBe(0.16);
    expect(repress.climb).toBe(beforeRelease.climb);
  });

  it('restarts from the gentle magnitude when direction reverses', () => {
    const response = createKeyboardResponse();
    for (let frame = 0; frame < 6; frame += 1) response.sample(new Set(['a']), 0.1);
    expect(response.sample(new Set(['a']), 0).yaw).toBeGreaterThan(0.5);
    expect(response.sample(new Set(['d']), 0).yaw).toBe(-0.16);
  });

  it('neutralizes opposing keys and starts fresh once one direction remains', () => {
    const response = createKeyboardResponse();
    for (let frame = 0; frame < 5; frame += 1) response.sample(new Set(['a']), 0.1);
    expect(response.sample(new Set(['a', 'd']), tick).yaw).toBe(0);
    expect(response.sample(new Set(['a']), 0).yaw).toBe(0.16);
  });

  it('clears all axis ramps on reset, including when used for pause/resume', () => {
    const response = createKeyboardResponse();
    for (let frame = 0; frame < 5; frame += 1) response.sample(new Set(['a', 'arrowup']), 0.1);
    expect(response.sample(new Set(['a', 'arrowup']), 0).yaw).toBeGreaterThan(0.16);

    response.reset();
    expect(response.sample(new Set(['a', 'arrowup']), 0).yaw).toBe(0.16);
    expect(response.sample(new Set(['a', 'arrowup']), 0).cyclicY).toBe(0.16);
  });

  it('keeps the response equivalent for different frame splits over the same hold time', () => {
    function integratedYaw(dt: number, count: number): number {
      const response = createKeyboardResponse();
      let sum = 0;
      for (let frame = 0; frame < count; frame += 1) {
        sum += response.sample(new Set(['a']), dt).yaw * dt;
      }
      return sum;
    }

    const coarse = integratedYaw(0.05, 10);
    const fine = integratedYaw(1 / 60, 30);
    expect(Math.abs(coarse - fine)).toBeLessThan(0.01);

    function sampledAtSameHoldTime(dt: number, count: number): number {
      const response = createKeyboardResponse();
      for (let frame = 0; frame < count; frame += 1) response.sample(new Set(['a']), dt);
      return response.sample(new Set(['a']), 0).yaw;
    }
    expect(sampledAtSameHoldTime(0.05, 10)).toBeCloseTo(sampledAtSameHoldTime(1 / 60, 30), 10);
  });

  it('ignores invalid time and bounds an unusually large frame delta', () => {
    const response = createKeyboardResponse();
    expect(response.sample(new Set(['a']), Number.NaN).yaw).toBe(0.16);
    expect(response.sample(new Set(['a']), Number.POSITIVE_INFINITY).yaw).toBe(0.16);

    response.reset();
    response.sample(new Set(['a']), 100);
    const afterLargeDelta = response.sample(new Set(['a']), 0).yaw;
    expect(afterLargeDelta).toBeLessThan(0.3);
    expect(afterLargeDelta).toBeGreaterThan(0.16);
  });
});
