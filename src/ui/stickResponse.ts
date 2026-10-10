export type StickVector = Readonly<{ x: number; y: number }>;

export const FLIGHT_STICK_RESPONSE = {
  deadzone: 0.065,
  yawLimit: 0.68,
  cyclicLimit: 0.78,
  collectiveLimit: 0.86,
} as const;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Keep a stick vector inside its circular travel while preserving its direction. */
export function normalizeStickVector(x: number, y: number): StickVector {
  const safeX = finiteOrZero(x);
  const safeY = finiteOrZero(y);
  const magnitude = Math.hypot(safeX, safeY);
  if (magnitude <= 1 || magnitude === 0) return { x: safeX, y: safeY };
  return { x: safeX / magnitude, y: safeY / magnitude };
}

/**
 * Convert a radial stick position into flight input. The smoothstep curve keeps
 * small mobile movements gentle, then retains the available authority at the edge.
 */
export function mapStickResponse(
  x: number,
  y: number,
  xLimit: number,
  yLimit: number,
  deadzone = FLIGHT_STICK_RESPONSE.deadzone,
): StickVector {
  const vector = normalizeStickVector(x, y);
  const magnitude = Math.hypot(vector.x, vector.y);
  const safeDeadzone = Math.min(0.95, Math.max(0, finiteOrZero(deadzone)));
  if (magnitude <= safeDeadzone || magnitude === 0) return { x: 0, y: 0 };

  const t = (magnitude - safeDeadzone) / (1 - safeDeadzone);
  const response = t * t * (3 - 2 * t);
  const scale = response / magnitude;
  const safeXLimit = Math.min(1, Math.max(0, finiteOrZero(xLimit)));
  const safeYLimit = Math.min(1, Math.max(0, finiteOrZero(yLimit)));
  return {
    x: vector.x * scale * safeXLimit,
    y: vector.y * scale * safeYLimit,
  };
}
