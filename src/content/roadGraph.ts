import type { CampaignRoad, LocalPoint, RoadGraphEdge, RoadGraphNode, RoadJunction } from './geography';

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a.t - b.t, a.s - b.s);

/** Round a non-junction corner with a short quadratic curve while retaining exact anchors. */
export function smoothRoadPath(
  points: readonly LocalPoint[],
  preserved: readonly LocalPoint[] = [],
  radius = 54,
  curveSteps = 4,
): LocalPoint[] {
  if (points.length < 3) return points.map(point => ({ ...point }));
  if (!(radius > 0) || !Number.isFinite(radius)) throw new RangeError('Road smoothing radius must be positive');
  if (!Number.isInteger(curveSteps) || curveSteps < 2) throw new RangeError('Road curves need at least two samples');
  const isPreserved = (point: LocalPoint) => preserved.some(anchor => distance(point, anchor) < 1e-5);
  const corners = points.slice(1, -1).map((point, index) => {
    const previous = points[index], next = points[index + 2];
    const incoming = distance(previous, point), outgoing = distance(point, next);
    if (incoming < 1e-5 || outgoing < 1e-5 || isPreserved(point)) return null;
    const incomingVector = { t: (point.t - previous.t) / incoming, s: (point.s - previous.s) / incoming };
    const outgoingVector = { t: (next.t - point.t) / outgoing, s: (next.s - point.s) / outgoing };
    const turn = Math.acos(Math.max(-1, Math.min(1, incomingVector.t * outgoingVector.t + incomingVector.s * outgoingVector.s)));
    if (turn < Math.PI / 12 || turn > Math.PI * 11 / 12) return null;
    const cut = Math.min(radius * Math.tan(turn * .5), incoming * .24, outgoing * .24);
    return {
      before: { t: point.t - incomingVector.t * cut, s: point.s - incomingVector.s * cut },
      after: { t: point.t + outgoingVector.t * cut, s: point.s + outgoingVector.s * cut },
      corner: point,
    };
  });
  const result: LocalPoint[] = [{ ...points[0] }];
  for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
    const curve = corners[cornerIndex];
    if (!curve) {
      result.push({ ...points[cornerIndex + 1] });
      continue;
    }
    if (distance(result.at(-1)!, curve.before) > 1e-5) result.push(curve.before);
    for (let step = 1; step <= curveSteps; step++) {
      const fraction = step / curveSteps;
      const inverse = 1 - fraction;
      result.push({
        t: inverse * inverse * curve.before.t + 2 * inverse * fraction * curve.corner.t + fraction * fraction * curve.after.t,
        s: inverse * inverse * curve.before.s + 2 * inverse * fraction * curve.corner.s + fraction * fraction * curve.after.s,
      });
    }
  }
  const end = points.at(-1)!;
  if (distance(result.at(-1)!, end) > 1e-5) result.push({ ...end });
  return result;
}

function unit(from: LocalPoint, to: LocalPoint): LocalPoint {
  const length = distance(from, to);
  if (length < 1e-6) throw new Error('Road graph contains a zero-length arm');
  return { t: (to.t - from.t) / length, s: (to.s - from.s) / length };
}

/** Split authored roads at every named node so graph edges and rendered roads share geometry. */
export function buildRoadGraph(roads: readonly CampaignRoad[], inputNodes: readonly RoadGraphNode[]): {
  nodes: RoadGraphNode[];
  edges: RoadGraphEdge[];
  junctions: RoadJunction[];
} {
  const nodes = inputNodes.map(node => ({ ...node, position: { ...node.position } }));
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) throw new Error(`Road graph has a missing or duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!Number.isFinite(node.position.t) || !Number.isFinite(node.position.s)) throw new Error(`Road graph node ${node.id} is not finite`);
  }
  const roadIds = new Set<string>();
  const edges: RoadGraphEdge[] = [];
  const incident = new Map<string, Array<{ roadId: string; kind: CampaignRoad['kind']; direction: LocalPoint }>>();
  for (const road of roads) {
    if (roadIds.has(road.id)) throw new Error(`Road graph has duplicate road id ${road.id}`);
    roadIds.add(road.id);
    if (road.points.length < 2) throw new Error(`Road ${road.id} needs at least two points`);
    const stops: Array<{ index: number; node: RoadGraphNode }> = [];
    for (const node of nodes) {
      const index = road.points.findIndex(point => distance(point, node.position) < 1e-4);
      if (index >= 0) stops.push({ index, node });
    }
    stops.sort((a, b) => a.index - b.index);
    if (stops[0]?.index !== 0 || stops.at(-1)?.index !== road.points.length - 1) {
      throw new Error(`Road ${road.id} must begin and end at named graph nodes`);
    }
    for (let stopIndex = 1; stopIndex < stops.length; stopIndex++) {
      const start = stops[stopIndex - 1], end = stops[stopIndex];
      if (end.index <= start.index) throw new Error(`Road ${road.id} has duplicate node positions`);
      const points = road.points.slice(start.index, end.index + 1).map(point => ({ ...point }));
      const id = `${road.id}:${start.node.id}->${end.node.id}`;
      edges.push({ id, roadId: road.id, from: start.node.id, to: end.node.id, kind: road.kind, points });
      const startArms = incident.get(start.node.id) ?? [];
      startArms.push({ roadId: road.id, kind: road.kind, direction: unit(points[0], points[1]) });
      incident.set(start.node.id, startArms);
      const endArms = incident.get(end.node.id) ?? [];
      endArms.push({ roadId: road.id, kind: road.kind, direction: unit(points.at(-1)!, points.at(-2)!) });
      incident.set(end.node.id, endArms);
    }
  }
  const junctions = nodes.flatMap(node => {
    const arms = incident.get(node.id) ?? [];
    return arms.length >= 3 ? [{ id: node.id, position: { ...node.position }, arms }] : [];
  });
  return { nodes, edges, junctions };
}

function cross(a: LocalPoint, b: LocalPoint): number { return a.t * b.s - a.s * b.t; }

/** Detect unmodeled crossings, retracing, and duplicated centerline overlaps. */
export function findUnmodeledRoadCrossings(roads: readonly CampaignRoad[], tolerance = .2): string[] {
  const issues: string[] = [];
  for (let firstRoad = 0; firstRoad < roads.length; firstRoad++) {
    const first = roads[firstRoad];
    for (let secondRoad = firstRoad; secondRoad < roads.length; secondRoad++) {
      const second = roads[secondRoad];
      const sameRoad = firstRoad === secondRoad;
      for (let i = 1; i < first.points.length; i++) for (let j = sameRoad ? i + 1 : 1; j < second.points.length; j++) {
        const a = first.points[i - 1], b = first.points[i], c = second.points[j - 1], d = second.points[j];
        const ab = { t: b.t - a.t, s: b.s - a.s }, cd = { t: d.t - c.t, s: d.s - c.s };
        const firstLength = Math.hypot(ab.t, ab.s), secondLength = Math.hypot(cd.t, cd.s);
        if (firstLength < 1e-8 || secondLength < 1e-8) continue;
        const determinant = cross(ab, cd);
        const ac = { t: c.t - a.t, s: c.s - a.s };
        if (Math.abs(determinant) <= firstLength * secondLength * 1e-10) {
          const distanceToLine = Math.abs(cross(ab, ac)) / firstLength;
          if (distanceToLine > tolerance) continue;
          const ux = ab.t / firstLength, uy = ab.s / firstLength;
          const cProjection = ac.t * ux + ac.s * uy;
          const dProjection = (d.t - a.t) * ux + (d.s - a.s) * uy;
          const overlap = Math.min(firstLength, Math.max(cProjection, dProjection))
            - Math.max(0, Math.min(cProjection, dProjection));
          if (overlap > tolerance) issues.push(`${first.id}${sameRoad ? '' : ` and ${second.id}`} retraces an overlapping road segment`);
          continue;
        }
        const firstFraction = cross(ac, cd) / determinant;
        const secondFraction = cross(ac, ab) / determinant;
        if (firstFraction < -1e-8 || firstFraction > 1 + 1e-8 || secondFraction < -1e-8 || secondFraction > 1 + 1e-8) continue;
        const point = { t: a.t + ab.t * firstFraction, s: a.s + ab.s * firstFraction };
        if (sameRoad) {
          if (j === i + 1 && distance(point, b) <= tolerance && distance(point, c) <= tolerance) continue;
          issues.push(`${first.id} crosses itself at (${point.t.toFixed(1)}, ${point.s.toFixed(1)})`);
          continue;
        }
        const endpointA = firstFraction <= 1e-8 ? a : firstFraction >= 1 - 1e-8 ? b : null;
        const endpointB = secondFraction <= 1e-8 ? c : secondFraction >= 1 - 1e-8 ? d : null;
        const sharedNode = endpointA !== null && endpointB !== null && distance(endpointA, endpointB) <= tolerance;
        if (!sharedNode) issues.push(`${first.id} crosses ${second.id} at (${point.t.toFixed(1)}, ${point.s.toFixed(1)})`);
      }
    }
  }
  return [...new Set(issues)];
}
