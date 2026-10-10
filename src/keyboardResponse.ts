import type { FlightCommand } from './types';

export type KeyboardFlightAxes = Pick<FlightCommand, 'yaw' | 'climb' | 'cyclicX' | 'cyclicY'>;

const START_MAGNITUDE = 0.16;
const RAMP_SECONDS = 0.75;
const MAX_DT = 0.1;

type AxisState = { key: string | null; elapsed: number };
type AxisDefinition = {
  positiveKey: string;
  negativeKey: string;
  limit: number;
};

const axisDefinitions: Record<keyof KeyboardFlightAxes, AxisDefinition> = {
  yaw: { positiveKey: 'a', negativeKey: 'd', limit: 0.65 },
  climb: { positiveKey: 'w', negativeKey: 's', limit: 0.8 },
  cyclicX: { positiveKey: 'arrowright', negativeKey: 'arrowleft', limit: 0.8 },
  cyclicY: { positiveKey: 'arrowup', negativeKey: 'arrowdown', limit: 0.8 },
};

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function safeDt(dt: number): number {
  return Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
}

/**
 * Add a short, gentle ramp to held keyboard flight controls. Each axis keeps
 * its own hold time, so starting or releasing one control does not affect the
 * others.
 */
export function createKeyboardResponse(): {
  sample(keys: ReadonlySet<string>, dt: number): KeyboardFlightAxes;
  reset(): void;
  releaseKey(key: string): void;
} {
  const states: Record<keyof KeyboardFlightAxes, AxisState> = {
    yaw: { key: null, elapsed: 0 },
    climb: { key: null, elapsed: 0 },
    cyclicX: { key: null, elapsed: 0 },
    cyclicY: { key: null, elapsed: 0 },
  };

  function resetAxis(axis: keyof KeyboardFlightAxes) {
    states[axis].key = null;
    states[axis].elapsed = 0;
  }

  function sampleAxis(axis: keyof KeyboardFlightAxes, keys: ReadonlySet<string>, elapsedDt: number): number {
    const definition = axisDefinitions[axis];
    const positive = keys.has(definition.positiveKey);
    const negative = keys.has(definition.negativeKey);
    if (positive === negative) {
      resetAxis(axis);
      return 0;
    }

    const key = positive ? definition.positiveKey : definition.negativeKey;
    const state = states[axis];
    if (state.key !== key) {
      state.key = key;
      state.elapsed = 0;
    }

    // Return the response at the start of this tick, then advance hold time.
    // This makes the first tick exactly START_MAGNITUDE and bounds long frame
    // stalls through safeDt().
    const direction = key === definition.positiveKey ? 1 : -1;
    const magnitude = START_MAGNITUDE + (definition.limit - START_MAGNITUDE) * smoothstep(state.elapsed / RAMP_SECONDS);
    state.elapsed += elapsedDt;
    return direction * magnitude;
  }

  return {
    sample(keys, dt) {
      const elapsedDt = safeDt(dt);
      return {
        yaw: sampleAxis('yaw', keys, elapsedDt),
        climb: sampleAxis('climb', keys, elapsedDt),
        cyclicX: sampleAxis('cyclicX', keys, elapsedDt),
        cyclicY: sampleAxis('cyclicY', keys, elapsedDt),
      };
    },
    reset() {
      for (const axis of Object.keys(states) as (keyof KeyboardFlightAxes)[]) resetAxis(axis);
    },
    releaseKey(key) {
      for (const [axis, definition] of Object.entries(axisDefinitions) as [keyof KeyboardFlightAxes, AxisDefinition][]) {
        if (key === definition.positiveKey || key === definition.negativeKey) resetAxis(axis);
      }
    },
  };
}
