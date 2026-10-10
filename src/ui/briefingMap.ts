import type { Campaign, Mission } from '../types';
import { terrainHeight } from '../sim/collision';

export const BRIEFING_MAP_WIDTH = 480;
export const BRIEFING_MAP_HEIGHT = 600;

type WorldPoint = { x: number; z: number };
export type BriefingMapPoint = { x: number; y: number };
export type BriefingMapRect = { x: number; y: number; width: number; height: number };
export type BriefingMapLabel = { text: string; x: number; y: number; width: number; height: number; marker: 'ship' | 'shore' | 'lake' | 'fire' };
export type BriefingMapTerrain = { bounds: { minCross: number; maxCross: number; minAlong: number; maxAlong: number }; columns: number; rows: number; land: readonly boolean[] };

export type BriefingMapModel = {
  width: number;
  height: number;
  scale: number;
  basis: { inlandX: number; inlandZ: number; lateralX: number; lateralZ: number };
  origin: BriefingMapPoint;
  ship: BriefingMapPoint;
  shore: BriefingMapPoint | null;
  lake: BriefingMapPoint & { radius: number };
  fire: BriefingMapPoint & { radius: number };
  route: BriefingMapPoint[];
  terrain: BriefingMapTerrain;
  terrainRects: BriefingMapRect[];
  labels: BriefingMapLabel[];
};

type LocalPoint = { cross: number; along: number };
type MarkerLayout = { key: BriefingMapLabel['marker']; text: string; point: BriefingMapPoint; radius: number };
type TerrainBounds = BriefingMapTerrain['bounds'];

const terrainByMission = new WeakMap<Mission, BriefingMapTerrain>();
const MAP_X_PADDING = 50;
const MAP_TOP_PADDING = 58;
const MAP_BOTTOM_PADDING = 38;
const LABEL_MARGIN = 10;
const LABEL_GAP = 6;

function localPoint(point: WorldPoint, mission: Mission, basis: BriefingMapModel['basis']): LocalPoint {
  const dx = point.x - mission.ship.x;
  const dz = point.z - mission.ship.z;
  return {
    cross: dx * basis.lateralX + dz * basis.lateralZ,
    along: dx * basis.inlandX + dz * basis.inlandZ,
  };
}

/** Project a local gameplay coordinate into the fixed, uniformly scaled map viewBox. */
export function projectBriefingMapCoordinate(model: BriefingMapModel, mission: Mission, point: WorldPoint): BriefingMapPoint {
  const local = localPoint(point, mission, model.basis);
  return { x: model.origin.x + local.cross * model.scale, y: model.origin.y - local.along * model.scale };
}

function createTerrainGrid(campaign: Campaign, mission: Mission, basis: BriefingMapModel['basis'], bounds: TerrainBounds): BriefingMapTerrain {
  const cached = terrainByMission.get(mission);
  if (cached) return cached;

  const width = Math.max(1, bounds.maxCross - bounds.minCross);
  const height = Math.max(1, bounds.maxAlong - bounds.minAlong);
  const columns = Math.max(16, Math.min(64, Math.round(64 * width / height)));
  const rows = 80;
  const land: boolean[] = [];
  const columnStep = width / columns;
  const rowStep = height / rows;

  for (let row = 0; row < rows; row++) {
    const along = bounds.minAlong + (row + 0.5) * rowStep;
    for (let column = 0; column < columns; column++) {
      const cross = bounds.minCross + (column + 0.5) * columnStep;
      const worldX = mission.ship.x + basis.lateralX * cross + basis.inlandX * along;
      const worldZ = mission.ship.z + basis.lateralZ * cross + basis.inlandZ * along;
      land.push(terrainHeight(campaign, mission, worldX, worldZ) !== null);
    }
  }

  const grid: BriefingMapTerrain = { bounds: { ...bounds }, columns, rows, land };
  terrainByMission.set(mission, grid);
  return grid;
}

function rectsFromTerrain(grid: BriefingMapTerrain, model: Pick<BriefingMapModel, 'scale' | 'origin'>): BriefingMapRect[] {
  const { bounds, columns, rows, land } = grid;
  const crossStep = (bounds.maxCross - bounds.minCross) / columns;
  const alongStep = (bounds.maxAlong - bounds.minAlong) / rows;
  const rects: BriefingMapRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!land[row * columns + column]) continue;
      const cross = bounds.minCross + column * crossStep;
      const along = bounds.minAlong + (row + 1) * alongStep;
      rects.push({
        x: model.origin.x + cross * model.scale,
        y: model.origin.y - along * model.scale,
        width: crossStep * model.scale + 0.35,
        height: alongStep * model.scale + 0.35,
      });
    }
  }
  return rects;
}

function rectOverlaps(a: BriefingMapRect, b: BriefingMapRect): boolean {
  return a.x < b.x + b.width + LABEL_GAP && a.x + a.width + LABEL_GAP > b.x
    && a.y < b.y + b.height + LABEL_GAP && a.y + a.height + LABEL_GAP > b.y;
}

function rectTouchesMarker(rect: BriefingMapRect, point: BriefingMapPoint, radius: number): boolean {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy < (radius + 3) * (radius + 3);
}

function labelCandidates(marker: MarkerLayout, width: number, height: number): BriefingMapRect[] {
  const { point, radius } = marker;
  const outside = radius + 7;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    { x: point.x + outside, y: point.y - halfHeight, width, height },
    { x: point.x - outside - width, y: point.y - halfHeight, width, height },
    { x: point.x - halfWidth, y: point.y - outside - height, width, height },
    { x: point.x - halfWidth, y: point.y + outside, width, height },
    { x: point.x + outside, y: point.y - outside - height, width, height },
    { x: point.x - outside - width, y: point.y - outside - height, width, height },
    { x: point.x + outside, y: point.y + outside, width, height },
    { x: point.x - outside - width, y: point.y + outside, width, height },
  ];
}

function placeLabels(markers: MarkerLayout[]): BriefingMapLabel[] {
  const priority: Record<BriefingMapLabel['marker'], number> = { shore: 0, fire: 1, lake: 2, ship: 3 };
  const ordered = [...markers].sort((a, b) => priority[a.key] - priority[b.key]);
  const placed: BriefingMapLabel[] = [];

  for (const marker of ordered) {
    const width = Math.max(70, marker.text.length * 13 + 18);
    const height = 38;
    const others = markers.filter((candidate) => candidate !== marker);
    const candidates = labelCandidates(marker, width, height);
    // If a tight mission cluster uses every cardinal slot, try progressively farther offsets.
    for (let distance = marker.radius + 14; distance <= marker.radius + 150; distance += 12) {
      candidates.push(
        { x: marker.point.x + distance, y: marker.point.y - height / 2, width, height },
        { x: marker.point.x - distance - width, y: marker.point.y - height / 2, width, height },
        { x: marker.point.x - width / 2, y: marker.point.y - distance - height, width, height },
        { x: marker.point.x - width / 2, y: marker.point.y + distance, width, height },
      );
    }
    const acceptable = (rect: BriefingMapRect) => rect.x >= LABEL_MARGIN && rect.y >= LABEL_MARGIN
      && rect.x + rect.width <= BRIEFING_MAP_WIDTH - LABEL_MARGIN
      && rect.y + rect.height <= BRIEFING_MAP_HEIGHT - LABEL_MARGIN
      && !placed.some((label) => rectOverlaps(rect, label))
      && !others.some((other) => rectTouchesMarker(rect, other.point, other.radius));
    let chosen = candidates.find(acceptable);

    // Map padding should make this unreachable for authored content. Keep labels in bounds if a future
    // scenario crowds the route by choosing the closest safe edge of the map.
    if (!chosen) {
      const x = Math.max(LABEL_MARGIN, Math.min(BRIEFING_MAP_WIDTH - LABEL_MARGIN - width, marker.point.x - width / 2));
      const y = Math.max(LABEL_MARGIN, Math.min(BRIEFING_MAP_HEIGHT - LABEL_MARGIN - height, marker.point.y - height / 2));
      chosen = { x, y, width, height };
    }
    placed.push({ text: marker.text, marker: marker.key, ...chosen });
  }
  return placed;
}

/** Build the renderer-independent geometry and sampled terrain for a briefing map. */
export function buildBriefingMapModel(campaign: Campaign, mission: Mission): BriefingMapModel {
  const inlandPoint = mission.shore ?? mission.lake;
  const dx = inlandPoint.x - mission.ship.x;
  const dz = inlandPoint.z - mission.ship.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const inlandX = dx / length;
  const inlandZ = dz / length;
  const basis = { inlandX, inlandZ, lateralX: -inlandZ, lateralZ: inlandX };
  const definitions: { key: BriefingMapLabel['marker']; text: string; world: WorldPoint; worldRadius: number }[] = [
    { key: 'ship', text: 'SHIP', world: mission.ship, worldRadius: 18 },
    ...(mission.shore ? [{ key: 'shore' as const, text: 'SHORE PAD', world: mission.shore, worldRadius: 18 }] : []),
    { key: 'lake', text: 'LAKE', world: mission.lake, worldRadius: mission.lake.radius },
    { key: 'fire', text: 'FIRE', world: mission.fire, worldRadius: mission.fire.radius },
  ];
  const local = definitions.map((item) => ({ ...item, point: localPoint(item.world, mission, basis) }));
  const minCross = Math.min(...local.map(({ point, worldRadius }) => point.cross - worldRadius));
  const maxCross = Math.max(...local.map(({ point, worldRadius }) => point.cross + worldRadius));
  const minAlong = Math.min(...local.map(({ point, worldRadius }) => point.along - worldRadius));
  const maxAlong = Math.max(...local.map(({ point, worldRadius }) => point.along + worldRadius));
  const bleed = Math.max(75, Math.min(180, (maxAlong - minAlong) * 0.07));
  const terrainBounds = {
    minCross: minCross - bleed,
    maxCross: maxCross + bleed,
    minAlong: minAlong - bleed,
    maxAlong: maxAlong + bleed,
  };
  const rangeX = terrainBounds.maxCross - terrainBounds.minCross;
  const rangeY = terrainBounds.maxAlong - terrainBounds.minAlong;
  const scale = Math.min(
    (BRIEFING_MAP_WIDTH - MAP_X_PADDING * 2) / rangeX,
    (BRIEFING_MAP_HEIGHT - MAP_TOP_PADDING - MAP_BOTTOM_PADDING) / rangeY,
  );
  const origin = {
    x: BRIEFING_MAP_WIDTH / 2 - (terrainBounds.minCross + terrainBounds.maxCross) * 0.5 * scale,
    // The ship is the visual anchor at the bottom; the inland axis always rises from it.
    y: BRIEFING_MAP_HEIGHT - MAP_BOTTOM_PADDING,
  };
  const projected = (point: WorldPoint): BriefingMapPoint => {
    const pointLocal = localPoint(point, mission, basis);
    return { x: origin.x + pointLocal.cross * scale, y: origin.y - pointLocal.along * scale };
  };
  const ship = projected(mission.ship);
  const shore = mission.shore ? projected(mission.shore) : null;
  const lakePoint = projected(mission.lake);
  const firePoint = projected(mission.fire);
  const radiusScale = scale;
  const route = [
    mission.ship,
    ...(mission.shore ? [mission.shore] : []),
    mission.lake,
    mission.fire,
    ...(mission.shore ? [mission.shore] : []),
    mission.ship,
  ].map(projected);
  const markers: MarkerLayout[] = [
    { key: 'ship', text: 'SHIP', point: ship, radius: 10 },
    ...(shore ? [{ key: 'shore' as const, text: 'SHORE PAD', point: shore, radius: 9 }] : []),
    { key: 'lake', text: 'LAKE', point: lakePoint, radius: mission.lake.radius * radiusScale },
    { key: 'fire', text: 'FIRE', point: firePoint, radius: mission.fire.radius * radiusScale },
  ];
  const terrain = createTerrainGrid(campaign, mission, basis, terrainBounds);
  const modelBase = { width: BRIEFING_MAP_WIDTH, height: BRIEFING_MAP_HEIGHT, scale, basis, origin };
  return {
    ...modelBase,
    ship,
    shore,
    lake: { ...lakePoint, radius: mission.lake.radius * radiusScale },
    fire: { ...firePoint, radius: mission.fire.radius * radiusScale },
    route,
    terrain,
    terrainRects: rectsFromTerrain(terrain, modelBase),
    labels: placeLabels(markers),
  };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0';
}

function terrainPath(rects: BriefingMapRect[]): string {
  return rects.map(({ x, y, width, height }) => `M${num(x)} ${num(y)}h${num(width)}v${num(height)}h-${num(width)}Z`).join('');
}

function markerLabel(label: BriefingMapLabel): string {
  return `<g class="cm-map-label cm-map-label-${label.marker}" aria-hidden="true"><rect x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="5" fill="#1e302d" fill-opacity="0.94" stroke="#a9b7a4" stroke-opacity="0.52"/><text x="${num(label.x + label.width / 2)}" y="${num(label.y + label.height / 2 + 7)}" text-anchor="middle" fill="#f3ecd9" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" font-weight="700" letter-spacing="0.45">${escapeXml(label.text)}</text></g>`;
}

/** Accessible labels and route overlay, with a gameplay render or a loading/failure schematic. */
export function renderBriefingMap(campaign: Campaign, mission: Mission, terrainImage?: string): string {
  const model = buildBriefingMapModel(campaign, mission);
  const missionId = escapeXml(mission.id);
  const safeId = mission.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const titleId = `briefing-map-${safeId}-title`;
  const descriptionId = `briefing-map-${safeId}-description`;
  const points = model.route.map(({ x, y }) => `${num(x)},${num(y)}`).join(' ');
  const land = terrainPath(model.terrainRects);
  const shoreDescription = mission.shore ? 'shore handling pad, ' : '';
  const background = terrainImage
    ? `<image class="cm-map-terrain" href="${escapeXml(terrainImage)}" x="0" y="0" width="${BRIEFING_MAP_WIDTH}" height="${BRIEFING_MAP_HEIGHT}" preserveAspectRatio="none"/>`
    : `<rect class="cm-map-water" x="0" y="0" width="${BRIEFING_MAP_WIDTH}" height="${BRIEFING_MAP_HEIGHT}" fill="#356f73"/><path class="cm-map-land" d="${land}" fill="#718365" fill-opacity="0.9"/>`;
  const leaders = model.labels.map(label => {
    const point = model[label.marker];
    if (!point) return '';
    const endX = Math.max(label.x, Math.min(label.x + label.width, point.x));
    const endY = Math.max(label.y, Math.min(label.y + label.height, point.y));
    return `<path class="cm-map-leader" d="M${num(point.x)} ${num(point.y)}L${num(endX)} ${num(endY)}"/>`;
  }).join('');

  return `<svg class="cm-map-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BRIEFING_MAP_WIDTH} ${BRIEFING_MAP_HEIGHT}" width="100%" height="100%" role="img" aria-labelledby="${titleId} ${descriptionId}" preserveAspectRatio="xMidYMid meet"><title id="${titleId}">${missionId} mission map: ${escapeXml(mission.title)}</title><desc id="${descriptionId}">${terrainImage ? 'Top-down render of the actual gameplay terrain' : 'Schematic local gameplay map'} for ${missionId}, showing the ship, ${shoreDescription}freshwater lake refill zone at its authored radius, fictional fire target and planned route. Inland is oriented upward; the drawing uses local gameplay metres.</desc>${background}<polyline class="cm-map-route" points="${points}" fill="none" stroke="#f1e8d1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><circle class="cm-map-lake-zone" cx="${num(model.lake.x)}" cy="${num(model.lake.y)}" r="${num(model.lake.radius)}" fill="#a8d8cb" fill-opacity="0.035" stroke="#d0e8d7" stroke-opacity="0.88" stroke-width="1.5"/><circle class="cm-map-fire-zone" cx="${num(model.fire.x)}" cy="${num(model.fire.y)}" r="${num(model.fire.radius)}" fill="#e5845d" fill-opacity="0.08" stroke="#f3aa83" stroke-opacity="0.9" stroke-width="1.5"/><g class="cm-map-marker cm-map-marker-ship" aria-hidden="true" fill="#eee5ce" stroke="#263832" stroke-width="2"><circle cx="${num(model.ship.x)}" cy="${num(model.ship.y)}" r="10"/><path d="M${num(model.ship.x - 5)} ${num(model.ship.y)}h10M${num(model.ship.x)} ${num(model.ship.y - 5)}v10"/></g>${model.shore ? `<g class="cm-map-marker cm-map-marker-shore" aria-hidden="true" fill="#f2e8d0" stroke="#263832" stroke-width="2"><rect x="${num(model.shore.x - 6)}" y="${num(model.shore.y - 6)}" width="12" height="12" rx="2"/><path d="M${num(model.shore.x - 3)} ${num(model.shore.y)}h6M${num(model.shore.x)} ${num(model.shore.y - 3)}v6"/></g>` : ''}<g class="cm-map-marker cm-map-marker-lake" aria-hidden="true" fill="#d9eee0" stroke="#275d5b" stroke-width="1.5"><circle cx="${num(model.lake.x)}" cy="${num(model.lake.y)}" r="5"/></g><g class="cm-map-marker cm-map-marker-fire" aria-hidden="true" fill="#ffe4c3" stroke="#9f4939" stroke-width="1.5"><circle cx="${num(model.fire.x)}" cy="${num(model.fire.y)}" r="5"/><path d="M${num(model.fire.x)} ${num(model.fire.y - 3)}v6M${num(model.fire.x - 3)} ${num(model.fire.y)}h6"/></g>${leaders}${model.labels.map(markerLabel).join('')}</svg>`;
}
