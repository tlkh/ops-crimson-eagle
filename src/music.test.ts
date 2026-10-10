import { describe, expect, it } from 'vitest';
import { campaigns } from './content';
import { musicLevelFor, musicTracks } from './music';
import { createSim } from './sim';

describe('mission soundtrack', () => {
  it('has one distinct, bundled recording for the menu and every mission', () => {
    const expected = ['menu', ...campaigns.flatMap(campaign => campaign.missions.map(mission => mission.id))];
    expect(Object.keys(musicTracks).sort()).toEqual(expected.sort());
    const tracks = Object.values(musicTracks);
    expect(new Set(tracks.map(track => track.file)).size).toBe(expected.length);
    expect(new Set(tracks.map(track => track.downloadUrl)).size).toBe(expected.length);
    for (const track of tracks) {
      expect(track.file).toMatch(/^[a-z0-9-]+\.mp3$/);
      expect(track.sourceUrl).toMatch(/^https:\/\//);
      expect(track.licenseUrl).toMatch(/^https:\/\//);
    }
  });

  it('builds toward a loaded fire attack and eases back for the return', () => {
    const campaign = campaigns[0];
    const mission = campaign.missions[0];
    const state = createSim(campaign, mission);
    const rigging = musicLevelFor(state, mission);

    state.phase = 'transit';
    const transit = musicLevelFor(state, mission);
    state.phase = 'work';
    state.waterLitres = 5000;
    state.position.x = mission.lake.x;
    state.position.z = mission.lake.z;
    const refill = musicLevelFor(state, mission);
    state.position.x = mission.fire.x;
    state.position.z = mission.fire.z;
    const attack = musicLevelFor(state, mission);
    state.waterLitres = 0;
    const emptyBucket = musicLevelFor(state, mission);
    state.phase = 'return';
    const returning = musicLevelFor(state, mission);

    expect(rigging).toBeLessThan(transit);
    expect(transit).toBeLessThan(refill);
    expect(refill).toBeLessThan(attack);
    expect(emptyBucket).toBeLessThan(attack);
    expect(returning).toBeLessThan(refill);
    expect(attack).toBeLessThanOrEqual(1);
  });
});
