import type { LocalPoint, RoadKind } from '../content/geography';

export type FrontageRoad = {
  id: string;
  kind: RoadKind;
  points: readonly LocalPoint[];
  frontage?: 'settlement' | 'rural' | 'none';
};

export type FrontageCandidate = {
  roadId: string;
  kind: RoadKind;
  chainage: number;
  center: LocalPoint;
  roadPoint: LocalPoint;
  tangent: LocalPoint;
  side: -1 | 1;
  score: number;
};

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

function hash(value: string, seed: number): number {
  let state = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) state = Math.imul(state ^ value.charCodeAt(i), 16777619);
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  return state >>> 0;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function atDistance(points: readonly LocalPoint[], cumulative: readonly number[], value: number) {
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < value) index++;
  const span = cumulative[index] - cumulative[index - 1];
  const fraction = span ? (value - cumulative[index - 1]) / span : 0;
  const a = points[index - 1], b = points[index];
  const tangentLength = Math.hypot(b.t - a.t, b.s - a.s) || 1;
  return {
    point: { t: a.t + (b.t - a.t) * fraction, s: a.s + (b.s - a.s) * fraction },
    tangent: { t: (b.t - a.t) / tangentLength, s: (b.s - a.s) / tangentLength },
  };
}

/**
 * Place stable lot opportunities along settlement and rural frontage. Each
 * road uses its own ID seed, 150–220 m spacing, and alternating road sides.
 * Callers apply world, asset and mission clearance filters before accepting a
 * bounded subset.
 */
export function generateRoadFrontageCandidates(
  roads: readonly FrontageRoad[],
  seed: number,
  options: { setback?: number; minSpacing?: number; maxSpacing?: number; maxCandidates?: number } = {},
): FrontageCandidate[] {
  const setback = options.setback ?? 25;
  const minSpacing = options.minSpacing ?? 150;
  const maxSpacing = options.maxSpacing ?? 220;
  const maxCandidates = options.maxCandidates ?? 512;
  if (!(setback > 0) || !(minSpacing > 0) || maxSpacing < minSpacing || maxCandidates < 0) {
    throw new RangeError('Invalid rural frontage generation limits');
  }
  const candidates: FrontageCandidate[] = [];
  for (const road of roads) {
    if (road.frontage === 'none' || road.points.length < 2) continue;
    const cumulative = [0];
    for (let i = 1; i < road.points.length; i++) cumulative.push(cumulative[i - 1] + distance(road.points[i - 1], road.points[i]));
    const length = cumulative.at(-1) ?? 0;
    if (length < minSpacing + 40) continue;
    const rng = random(hash(road.id, seed));
    let chainage = 42 + rng() * 24;
    let side: -1 | 1 = rng() < .5 ? -1 : 1;
    while (chainage < length - 42 && candidates.length < maxCandidates) {
      const { point, tangent } = atDistance(road.points, cumulative, chainage);
      const normal = { t: -tangent.s, s: tangent.t };
      const center = { t: point.t + normal.t * side * setback, s: point.s + normal.s * side * setback };
      candidates.push({
        roadId: road.id,
        kind: road.kind,
        chainage,
        center,
        roadPoint: point,
        tangent,
        side,
        score: hash(`${road.id}:${Math.round(chainage / 12)}`, seed),
      });
      side = side === 1 ? -1 : 1;
      chainage += minSpacing + rng() * (maxSpacing - minSpacing);
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.roadId.localeCompare(b.roadId) || a.chainage - b.chainage);
}

/** Reject nearby frontage candidates from crossing roads while preserving gaps. */
export function selectSpacedFrontageCandidates(
  candidates: readonly FrontageCandidate[],
  isClear: (candidate: FrontageCandidate) => boolean,
  limit = 24,
  minimumSeparation = 118,
): FrontageCandidate[] {
  const chosen: FrontageCandidate[] = [];
  for (const candidate of candidates) {
    if (!isClear(candidate) || chosen.some(item => distance(item.center, candidate.center) < minimumSeparation)) continue;
    chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen;
}
