import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import {
  BRIEFING_MAP_HEIGHT,
  BRIEFING_MAP_WIDTH,
  buildBriefingMapModel,
  projectBriefingMapCoordinate,
  renderBriefingMap,
  type BriefingMapRect,
} from './briefingMap';

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boxesOverlap(a: BriefingMapRect, b: BriefingMapRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('briefing map model', () => {
  it('projects gameplay metres with one uniform scale and points inland upward', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const model = buildBriefingMapModel(campaign, mission);
      const fromShipX = projectBriefingMapCoordinate(model, mission, { x: mission.ship.x + 125, z: mission.ship.z });
      const fromShipZ = projectBriefingMapCoordinate(model, mission, { x: mission.ship.x, z: mission.ship.z + 125 });
      expect(distance(model.ship, fromShipX)).toBeCloseTo(125 * model.scale, 6);
      expect(distance(model.ship, fromShipZ)).toBeCloseTo(125 * model.scale, 6);
      const inland = mission.shore ?? mission.lake;
      expect(projectBriefingMapCoordinate(model, mission, inland).y).toBeLessThan(model.ship.y);
      expect(model.ship.y).toBeGreaterThan(BRIEFING_MAP_HEIGHT * 0.82);
    }
  });

  it('draws ship-to-objective routes in the authored shore-handling order', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const model = buildBriefingMapModel(campaign, mission);
      const routeWorld = [
        mission.ship,
        ...(mission.shore ? [mission.shore] : []),
        mission.lake,
        mission.fire,
        ...(mission.shore ? [mission.shore] : []),
        mission.ship,
      ];
      expect(model.route).toHaveLength(mission.shore ? 6 : 4);
      for (let i = 0; i < routeWorld.length; i++) {
        expect(model.route[i].x).toBeCloseTo(projectBriefingMapCoordinate(model, mission, routeWorld[i]).x, 7);
        expect(model.route[i].y).toBeCloseTo(projectBriefingMapCoordinate(model, mission, routeWorld[i]).y, 7);
      }
      expect(model.shore === null).toBe(!mission.shore);
    }
  });

  it('keeps geometry finite, labels separated, and lake-radius circles inside the viewBox', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const model = buildBriefingMapModel(campaign, mission);
      const points = [model.ship, ...(model.shore ? [model.shore] : []), model.lake, model.fire, ...model.route];
      for (const point of points) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(BRIEFING_MAP_WIDTH);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(BRIEFING_MAP_HEIGHT);
      }
      expect(model.lake.radius).toBeCloseTo(mission.lake.radius * model.scale, 7);
      expect(model.lake.x - model.lake.radius).toBeGreaterThanOrEqual(0);
      expect(model.lake.x + model.lake.radius).toBeLessThanOrEqual(BRIEFING_MAP_WIDTH);
      expect(model.lake.y - model.lake.radius).toBeGreaterThanOrEqual(0);
      expect(model.lake.y + model.lake.radius).toBeLessThanOrEqual(BRIEFING_MAP_HEIGHT);
      expect(model.lakeOutline.length).toBeGreaterThanOrEqual(90);
      for (const point of model.lakeOutline) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(BRIEFING_MAP_WIDTH);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(BRIEFING_MAP_HEIGHT);
      }

      for (const rect of model.terrainRects) {
        expect([rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)).toBe(true);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(BRIEFING_MAP_WIDTH + 1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(BRIEFING_MAP_HEIGHT + 1);
      }
      for (const label of model.labels) {
        expect(label.x).toBeGreaterThanOrEqual(0);
        expect(label.y).toBeGreaterThanOrEqual(0);
        expect(label.x + label.width).toBeLessThanOrEqual(BRIEFING_MAP_WIDTH);
        expect(label.y + label.height).toBeLessThanOrEqual(BRIEFING_MAP_HEIGHT);
      }
      for (let i = 0; i < model.labels.length; i++) for (let j = i + 1; j < model.labels.length; j++) {
        expect(boxesOverlap(model.labels[i], model.labels[j])).toBe(false);
      }
    }
  });

  it('samples a bounded terrain grid and reuses the per-mission cache', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const first = buildBriefingMapModel(campaign, mission);
      const second = buildBriefingMapModel(campaign, mission);
      expect(first.terrain).toBe(second.terrain);
      expect(first.terrain.columns).toBeLessThanOrEqual(64);
      expect(first.terrain.rows).toBeLessThanOrEqual(80);
      expect(first.terrain.land).toHaveLength(first.terrain.columns * first.terrain.rows);
      expect(first.terrain.land.some(Boolean)).toBe(true);
    }
  });

  it('renders accessible self-contained SVG with mission-specific title and description', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const markup = renderBriefingMap(campaign, mission);
      expect(markup).toContain('class="cm-map-svg"');
      expect(markup).toContain('role="img"');
      expect(markup).toContain(`briefing-map-${mission.id}-title`);
      expect(markup).toContain(`briefing-map-${mission.id}-description`);
      expect(markup).toContain(`${mission.id} mission map:`);
      expect(markup).toContain('class="cm-map-route"');
      expect(markup).toContain('class="cm-map-lake-shore"');
      expect(markup).toContain('class="cm-map-water"');
      expect(markup).toContain('class="cm-map-land"');
      expect(markup).not.toMatch(/NaN|Infinity/);
    }
  });
  it('uses the captured gameplay terrain beneath the same route and label projection', () => {
    const campaign = campaigns[0], mission = campaign.missions[0];
    const image = 'data:image/png;base64,dGVzdA==';
    const markup = renderBriefingMap(campaign, mission, image);
    expect(markup).toContain(`href="${image}"`);
    expect(markup).toContain('Top-down render of the actual gameplay terrain');
    expect(markup).not.toContain('class="cm-map-land"');
    expect(markup).toContain('class="cm-map-leader"');
    for (const label of buildBriefingMapModel(campaign, mission).labels) {
      expect(markup).toContain(`>${label.text}</text>`);
    }
  });

});
