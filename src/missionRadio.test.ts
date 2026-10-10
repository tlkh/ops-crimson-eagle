import { describe, expect, it } from 'vitest';
import { campaigns } from './content';
import { createSim } from './sim';
import { shipLandingPoint } from './sim/shipLanding';
import type { ExtendedSimState } from './sim/types';
import { guidanceVoiceCue, MissionRadioDirector, type RadioTransmission } from './missionRadio';

const singapore = campaigns[0];
const japan = campaigns[1];

describe('mission radio guidance', () => {
  it('opens each campaign with its appropriate first instruction', () => {
    expect(guidanceVoiceCue(createSim(singapore, singapore.missions[0]), singapore, singapore.missions[0])).toBe('sg_attach_deck');
    expect(guidanceVoiceCue(createSim(japan, japan.missions[0]), japan, japan.missions[0])).toBe('jp_go_shore');
  });

  it('matches lake and fire approach advice to the visible guidance conditions', () => {
    const mission = singapore.missions[0];
    const state = createSim(singapore, mission) as ExtendedSimState;
    state.phase = 'work';
    state.bucketAttached = true;
    state.guidance = { label: 'Freshwater lake', target: { x: 0, y: 0, z: 0 }, distanceM: 50 };
    state.position.y = 40;
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('lake_descend');
    state.position.y = 20;
    state.velocity.x = 15;
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('lake_slow');
    state.velocity.x = 0;
    state.position.y = 25;
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('lake_align');
    state.guidance.label = 'Active fire';
    state.waterLitres = 5000;
    state.position.y = 90;
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('fire_altitude');
    state.position.y = 55;
    state.velocity.x = 15;
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('fire_slow');
  });

  it('announces key events once, and does not repeat the same instruction each frame', () => {
    const mission = singapore.missions[0];
    const state = createSim(singapore, mission) as ExtendedSimState;
    const heard: RadioTransmission[] = [];
    const director = new MissionRadioDirector(cue => heard.push(cue));
    director.reset(state, singapore, mission);
    expect(heard.map(cue => cue.id)).toEqual(['sg_attach_deck']);
    state.tick++;
    state.timeSec += 1;
    director.update(state, singapore, mission);
    expect(heard).toHaveLength(1);

    state.bucketAttached = true;
    state.phase = 'depart';
    state.tick++;
    state.timeSec += 1;
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('sg_bucket_rigged');

    state.phase = 'work';
    state.waterLitres = 5000;
    state.tick++;
    state.timeSec += 1;
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('bucket_full');

    state.tick++;
    state.timeSec += 1;
    director.update(state, singapore, mission);
    expect(heard).toHaveLength(3);
  });

  it('gives early numeric hover guidance, repeats it, and spaces changing hints', () => {
    const mission = singapore.missions[0];
    const state = createSim(singapore, mission) as ExtendedSimState;
    state.phase = 'work';
    state.bucketAttached = true;
    state.position = { x: mission.lake.x, y: 45, z: mission.lake.z - 180 };
    state.guidance = { label: 'Freshwater lake', target: { ...mission.lake, y: 25 }, distanceM: 180 };
    const heard: RadioTransmission[] = [];
    const director = new MissionRadioDirector(cue => heard.push(cue));
    director.reset(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('lake_descend');
    const updateAt = (time: number) => {
      state.tick++;
      state.timeSec = time;
      director.update(state, singapore, mission);
    };
    updateAt(23);
    expect(heard).toHaveLength(1);
    updateAt(24);
    expect(heard.at(-1)).toEqual({ id: 'lake_descend', priority: 'hint' });
    expect(heard).toHaveLength(2);
    state.position.y = 25;
    updateAt(25);
    expect(heard).toHaveLength(2);
    updateAt(32);
    expect(heard.at(-1)?.id).toBe('lake_align');
    expect(heard).toHaveLength(3);
    director.update(state, singapore, mission);
    expect(heard).toHaveLength(3);
  });

  it('interrupts routine guidance for a terminal failure', () => {
    const mission = japan.missions[0];
    const state = createSim(japan, mission) as ExtendedSimState;
    const heard: RadioTransmission[] = [];
    const director = new MissionRadioDirector(cue => heard.push(cue));
    director.reset(state, japan, mission);
    state.tick++;
    state.phase = 'failed';
    state.outcome = 'failed';
    state.damage = 100;
    state.failureCause = 'collision';
    director.update(state, japan, mission);
    expect(heard.at(-1)).toEqual({ id: 'aircraft_lost', priority: 'urgent' });
  });

  it('speaks fire cooling once per drop and waits for impact before requesting another load', () => {
    const mission = singapore.missions[1];
    const state = createSim(singapore, mission) as ExtendedSimState;
    const heard: RadioTransmission[] = [];
    const director = new MissionRadioDirector(cue => heard.push(cue));
    state.phase = 'work';
    state.bucketAttached = true;
    state.waterLitres = 5000;
    director.reset(state, singapore, mission);

    state.tick++;
    state.timeSec += 1;
    state.dropId = 1;
    state.dumping = true;
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('water_released');

    state.tick++;
    state.timeSec += 1;
    state.airborneLitres = 1000;
    state.usefulLitres = 100;
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('fire_cooling');

    const count = heard.length;
    state.tick++;
    state.timeSec += 1;
    state.usefulLitres = 200;
    director.update(state, singapore, mission);
    expect(heard).toHaveLength(count);

    state.tick++;
    state.timeSec += 1;
    state.dumping = false;
    state.waterLitres = 0;
    state.airborneLitres = 0;
    state.dropsCompleted = 1;
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('another_load');
  });

  it('keeps the final suppression on the fire and requests water when non-peat heat is still above its finish threshold', () => {
    const mission = singapore.missions[1];
    const state = createSim(singapore, mission) as ExtendedSimState;
    state.phase = 'work';
    state.bucketAttached = true;
    state.dropsCompleted = mission.requiredDrops;
    state.fireHeat = 8;
    state.airborneLitres = 100;
    state.waterPackets.push({ litres: 100, position: { x: mission.fire.x, y: 10, z: mission.fire.z },
      velocity: { x: 0, y: -1, z: 0 }, dropId: 1 });
    expect(guidanceVoiceCue(state, singapore, mission)).toBe('fire_cooling');

    const heard: RadioTransmission[] = [];
    const director = new MissionRadioDirector(cue => heard.push(cue));
    director.reset(state, singapore, mission);
    state.tick++;
    state.timeSec += 1;
    state.airborneLitres = 0;
    state.waterPackets = [];
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('fire_cooling');
    expect(heard.some(cue => cue.id === 'another_load')).toBe(false);

    state.fireHeat = 8.01;
    state.airborneLitres = 100;
    state.waterPackets.push({ litres: 100, position: { x: mission.fire.x, y: 10, z: mission.fire.z },
      velocity: { x: 0, y: -1, z: 0 }, dropId: 2 });
    director.reset(state, singapore, mission);
    state.tick++;
    state.timeSec += 1;
    state.airborneLitres = 0;
    state.waterPackets = [];
    director.update(state, singapore, mission);
    expect(heard.at(-1)?.id).toBe('another_load');
  });
});

it('does not announce descent until the Singapore load and aircraft are over the landing spot', () => {
  const mission = singapore.missions[0];
  const state = createSim(singapore, mission) as ExtendedSimState;
  state.phase = 'return';
  state.bucketAttached = true;
  state.position = { ...shipLandingPoint(singapore, mission), y: 40 };
  state.guidance = { label: singapore.shipName, target: { ...state.position, y: 0 }, distanceM: 0 };
  state.bucket = { x: mission.ship.x + singapore.shipWidth, y: -7.52, z: state.position.z };
  expect(guidanceVoiceCue(state, singapore, mission)).toBe('sg_return_ship');
  state.bucket = { ...state.position, y: 16 };
  expect(guidanceVoiceCue(state, singapore, mission)).toBe('landing_descend');
  state.guidance.distanceM = 20;
  expect(guidanceVoiceCue(state, singapore, mission)).toBe('sg_return_ship');
});
