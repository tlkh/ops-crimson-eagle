import * as THREE from 'three';
import type { LocalPoint, RoadKind } from '../content/geography';

export type JunctionArm = { roadId: string; kind: RoadKind; direction: LocalPoint };
export type JunctionDefinition = { id?: string; position: LocalPoint; arms: readonly JunctionArm[] };

export type JunctionMeshPair = {
  surface: THREE.BufferGeometry;
  shoulder: THREE.BufferGeometry;
  outline: LocalPoint[];
};

const roadWidths: Record<RoadKind, { surface: number; shoulder: number }> = {
  paved: { surface: 6, shoulder: 10 },
  gravel: { surface: 4.5, shoulder: 7.2 },
  track: { surface: 2.8, shoulder: 5.2 },
};

/** Keep rendered junctions aligned with terrain without per-frame sampling cost. */
const maxTerrainSampleSpacing = 2.5;

const cross = (a: LocalPoint, b: LocalPoint, c: LocalPoint) =>
  (b.t - a.t) * (c.s - a.s) - (b.s - a.s) * (c.t - a.t);

/** A stable convex outline around the approach cross-sections of a junction. */
export function junctionOutline(
  arms: readonly JunctionArm[],
  halfWidth: (kind: RoadKind) => number = kind => roadWidths[kind].surface * .5,
  reach = 12,
): LocalPoint[] {
  if (!Number.isFinite(reach) || reach <= 0) throw new RangeError('Junction reach must be positive');
  const points: LocalPoint[] = [];
  const unique = new Set<string>();
  for (const arm of arms) {
    const length = Math.hypot(arm.direction.t, arm.direction.s);
    if (length < 1e-5) continue;
    const dt = arm.direction.t / length, ds = arm.direction.s / length;
    const sideT = -ds, sideS = dt;
    const half = Math.max(.5, halfWidth(arm.kind));
    for (const sign of [-1, 1]) {
      const point = { t: dt * reach + sideT * half * sign, s: ds * reach + sideS * half * sign };
      const key = `${point.t.toFixed(5)}:${point.s.toFixed(5)}`;
      if (!unique.has(key)) { unique.add(key); points.push(point); }
    }
  }
  if (points.length < 3) return [];
  points.sort((a, b) => a.t - b.t || a.s - b.s);
  const lower: LocalPoint[] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-5) lower.pop();
    lower.push(point);
  }
  const upper: LocalPoint[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-5) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return [...lower, ...upper];
}

function conformingFan(
  center: LocalPoint,
  outline: readonly LocalPoint[],
  fromLocal: (t: number, s: number) => { x: number; z: number },
  groundAt: (x: number, z: number) => number,
  lift: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  const appendVertex = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, wa: number, wb: number, wc: number) => {
    const x = a.x * wa + b.x * wb + c.x * wc;
    const z = a.z * wa + b.z * wb + c.z * wc;
    const index = positions.length / 3;
    positions.push(x, groundAt(x, z) + lift, z);
    return index;
  };
  const appendTriangle = (a: number, b: number, c: number) => {
    const ax = positions[a * 3], az = positions[a * 3 + 2];
    const bx = positions[b * 3], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cz = positions[c * 3 + 2];
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(up) < 1e-5) return;
    indices.push(a, ...(up > 0 ? [b, c] : [c, b]));
  };

  const centerWorld = fromLocal(center.t, center.s);
  const worldOutline = outline.map(point => fromLocal(point.t, point.s));
  for (let sector = 0; sector < worldOutline.length; sector++) {
    const a = centerWorld;
    const b = worldOutline[sector];
    const c = worldOutline[(sector + 1) % worldOutline.length];
    const maxEdge = Math.max(
      Math.hypot(a.x - b.x, a.z - b.z),
      Math.hypot(b.x - c.x, b.z - c.z),
      Math.hypot(c.x - a.x, c.z - a.z),
    );
    const divisions = Math.max(1, Math.ceil(maxEdge / maxTerrainSampleSpacing));
    const rows: number[][] = [];
    for (let i = 0; i <= divisions; i++) {
      const row: number[] = [];
      for (let j = 0; j <= divisions - i; j++) {
        row.push(appendVertex(a, b, c, (divisions - i - j) / divisions, i / divisions, j / divisions));
      }
      rows.push(row);
    }
    for (let i = 0; i < divisions; i++) {
      for (let j = 0; j < divisions - i; j++) {
        appendTriangle(rows[i][j], rows[i + 1][j], rows[i][j + 1]);
        if (j < divisions - i - 1) {
          appendTriangle(rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Build one road-surface apron and one wider shoulder apron for an authored node. */
export function createJunctionMeshPair(
  junction: JunctionDefinition,
  fromLocal: (t: number, s: number) => { x: number; z: number },
  groundAt: (x: number, z: number) => number,
  reach = 12,
): JunctionMeshPair | null {
  if (junction.arms.length < 2) return null;
  const surfaceOutline = junctionOutline(junction.arms, kind => roadWidths[kind].surface * .5, reach);
  const shoulderOutline = junctionOutline(junction.arms, kind => roadWidths[kind].shoulder * .5, reach);
  if (surfaceOutline.length < 3 || shoulderOutline.length < 3) return null;
  const center = junction.position;
  const toWorldOutline = (outline: readonly LocalPoint[]) => outline.map(point => ({
    t: point.t + center.t,
    s: point.s + center.s,
  }));
  const surfaceWorldOutline = toWorldOutline(surfaceOutline);
  const shoulderWorldOutline = toWorldOutline(shoulderOutline);
  return {
    surface: conformingFan(center, surfaceWorldOutline, fromLocal, groundAt, .22),
    shoulder: conformingFan(center, shoulderWorldOutline, fromLocal, groundAt, .12),
    outline: shoulderWorldOutline,
  };
}

/** Distance from an incident road node along its centerline for strip trimming. */
export function junctionTrimIntervals(
  points: readonly LocalPoint[],
  junctions: readonly JunctionDefinition[],
  roadId: string,
  reach = 12,
): Array<readonly [number, number]> {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].t - points[i - 1].t, points[i].s - points[i - 1].s));
  const intervals: Array<readonly [number, number]> = [];
  for (const junction of junctions) {
    if (!junction.arms.some(arm => arm.roadId === roadId)) continue;
    let nearest = Infinity, at = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dt = b.t - a.t, ds = b.s - a.s;
      const span = dt * dt + ds * ds;
      const u = span ? THREE.MathUtils.clamp(((junction.position.t - a.t) * dt + (junction.position.s - a.s) * ds) / span, 0, 1) : 0;
      const projected = { t: a.t + dt * u, s: a.s + ds * u };
      const d = Math.hypot(junction.position.t - projected.t, junction.position.s - projected.s);
      if (d < nearest) { nearest = d; at = cumulative[i - 1] + Math.sqrt(span) * u; }
    }
    if (nearest <= 1.5) intervals.push([Math.max(0, at - reach), Math.min(cumulative[cumulative.length - 1] ?? 0, at + reach)]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<readonly [number, number]> = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1] + 1e-3) merged[merged.length - 1] = [last[0], Math.max(last[1], interval[1])];
    else merged.push(interval);
  }
  return merged;
}

/** Remove the centerline spans covered by junction aprons from a road strip. */
export function trimRoadForJunctions(
  points: readonly LocalPoint[],
  intervals: readonly (readonly [number, number])[],
): LocalPoint[][] {
  if (points.length < 2) return [];
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].t - points[i - 1].t, points[i].s - points[i - 1].s));
  const total = cumulative[cumulative.length - 1];
  const pointAt = (d: number): LocalPoint => {
    const bounded = THREE.MathUtils.clamp(d, 0, total);
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < bounded) i++;
    const span = cumulative[i] - cumulative[i - 1];
    const u = span ? (bounded - cumulative[i - 1]) / span : 0;
    return { t: THREE.MathUtils.lerp(points[i - 1].t, points[i].t, u), s: THREE.MathUtils.lerp(points[i - 1].s, points[i].s, u) };
  };
  const cuts: number[] = [0];
  for (const [start, end] of intervals) cuts.push(THREE.MathUtils.clamp(start, 0, total), THREE.MathUtils.clamp(end, 0, total));
  cuts.push(total);
  cuts.sort((a, b) => a - b);
  const chunks: LocalPoint[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i], end = cuts[i + 1];
    const mid = (start + end) * .5;
    if (end - start < .05 || intervals.some(([a, b]) => mid > a && mid < b)) continue;
    const chunk = [pointAt(start)];
    for (let vertex = 1; vertex < points.length - 1; vertex++) {
      if (cumulative[vertex] > start + .01 && cumulative[vertex] < end - .01) chunk.push(points[vertex]);
    }
    chunk.push(pointAt(end));
    if (chunk.length > 1) chunks.push(chunk);
  }
  return chunks;
}
