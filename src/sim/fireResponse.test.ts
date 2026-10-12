import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { getCampaignGeography, sampleRoad } from '../content/geography';
import { checkpointIntersectsWorld, createSim } from './index';
import { fireResponseEngineColliders, getFireResponseExclusionZones, sampleFireResponse } from './fireResponse';

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const campaignCases = campaigns.flatMap(campaign => campaign.missions.map(mission => ({ campaign, mission })));

describe('ambient fire response sampler', () => {
  it('places six people and two engines beside each active fire edge with short controlled spray streams', () => {
    for (const { campaign, mission } of campaignCases) {
      const frame = sampleFireResponse(campaign, mission, 42);
      expect(frame.people).toHaveLength(6);
      expect(frame.engines).toHaveLength(2);
      expect(frame.hoses.filter(hose => hose.kind === 'hose')).toHaveLength(2);
      expect(frame.hoses.filter(hose => hose.kind === 'spray')).toHaveLength(2);
      for (const worker of frame.people) {
        expect(distance(worker.position, mission.fire)).toBeGreaterThan(mission.fire.radius + 10);
      }
      for (const spray of frame.hoses.filter(hose => hose.kind === 'spray')) {
        const end = spray.points[spray.points.length - 1];
        expect(Math.abs(distance(end, mission.fire) - mission.fire.radius)).toBeLessThan(14);
      }
      expect(frame.people.filter(person => person.activity === 'walk')).toHaveLength(2);
    }
  });

  it('repeats poses at the same simulation time and keeps actors continuous through turnarounds and loop wrap', () => {
    for (const { campaign, mission } of campaignCases) {
      const atPause = sampleFireResponse(campaign, mission, 71.25);
      expect(sampleFireResponse(campaign, mission, 71.25)).toEqual(atPause);

      const mainRoad = getCampaignGeography(campaign).roads.find(road => road.id === 'main-paved')!;
      const points = sampleRoad(mainRoad.points, 8);
      const roadLength = points.slice(1).reduce((total, point, index) => total + Math.hypot(point.t - points[index].t, point.s - points[index].s), 0);
      const outboundEnd = roadLength / 5;
      const cycle = outboundEnd * 2 + 4.8;
      const patrolAt = (time: number) => sampleFireResponse(campaign, mission, time).engines.find(engine => engine.id === 'patrol')!;
      for (const turnaround of [outboundEnd, outboundEnd + 2.4, cycle - 2.4, cycle]) {
        const before = patrolAt(turnaround - .1).position;
        const after = patrolAt(turnaround + .1).position;
        expect(distance(before, after)).toBeLessThan(1.1);
      }
      const patrol = patrolAt(15);
      expect(patrol.speed).toBeCloseTo(5, 4);
    }
  });

  it('stops hose work after securing the fire while walkers keep a matching gait inside their clear paths', () => {
    for (const { campaign, mission } of campaignCases) {
      const frame = sampleFireResponse(campaign, mission, 91, true);
      const hoseCrew = frame.people.filter(person => person.id.startsWith('firefighter-'));
      expect(hoseCrew.every(person => person.activity === 'standby' && person.motion <= .05)).toBe(true);
      expect(frame.hoses.some(hose => hose.kind === 'spray')).toBe(false);
      const workingFrame = sampleFireResponse(campaign, mission, 91);
      expect(frame.people.filter(person => person.id.startsWith('roadside-walker')))
        .toEqual(workingFrame.people.filter(person => person.id.startsWith('roadside-walker')));
      const zones = getFireResponseExclusionZones(campaign, mission);
      for (const time of [0, 13, 27, 42, 66, 92]) {
        for (const walker of sampleFireResponse(campaign, mission, time).people.filter(person => person.id.startsWith('roadside-walker'))) {
          expect(zones.some(zone => distance(zone.center, walker.position) <= zone.radius)).toBe(true);
        }
      }
    }
  });

  it('uses the renderer poses as headless collision bounds without changing scoring or objective state', () => {
    for (const { campaign, mission } of campaignCases) {
      const timeSec = 67.5;
      const frame = sampleFireResponse(campaign, mission, timeSec);
      const bounds = fireResponseEngineColliders(campaign, mission, timeSec);
      for (const engine of frame.engines) {
        const collider = bounds.find(item => item.id === engine.id)!;
        expect(collider.x).toBeCloseTo(engine.position.x, 5);
        expect(collider.y).toBeCloseTo(engine.position.y, 5);
        expect(collider.z).toBeCloseTo(engine.position.z, 5);
        expect(collider.heading).toBeCloseTo(engine.heading, 5);
      }

      const state = createSim(campaign, mission);
      const initial = { score: state.score, fireState: state.fireState, objectiveSaved: state.objectiveSaved, dropsCompleted: state.dropsCompleted };
      const staged = bounds.find(item => item.id === 'staged')!;
      state.position = { x: staged.x, y: staged.top + 1.3, z: staged.z };
      state.heading = staged.heading;
      state.timeSec = timeSec;
      expect(checkpointIntersectsWorld(state, campaign, mission)).toBe(true);
      expect({ score: state.score, fireState: state.fireState, objectiveSaved: state.objectiveSaved, dropsCompleted: state.dropsCompleted }).toEqual(initial);
    }
  });

  it('keeps collision queries inert for an unprepared custom mission and projects perpendicular aircraft bounds', () => {
    const { campaign, mission } = campaignCases[0];
    const customMission = { ...mission, id: 'training-fixture' };
    expect(fireResponseEngineColliders(campaign, customMission, 0)).toEqual([]);

    const authoredBounds = getFireResponseExclusionZones(campaign, mission);
    expect(authoredBounds.length).toBeGreaterThan(0);
    const staged = fireResponseEngineColliders(campaign, mission, 0).find(engine => engine.id === 'staged')!;
    const state = createSim(campaign, mission);
    state.heading = staged.heading + Math.PI / 2;
    state.position = {
      x: staged.x + Math.cos(staged.heading) * 9.8,
      y: staged.top + 1.2,
      z: staged.z - Math.sin(staged.heading) * 9.8,
    };
    expect(checkpointIntersectsWorld(state, campaign, mission)).toBe(true);
  });
});
