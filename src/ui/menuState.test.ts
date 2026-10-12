import { describe, expect, it } from 'vitest';
import type { Campaign, Mission } from '../types';
import { WORLD_REVISION } from '../worldRevision';
import { createLaunchGuard, isMissionUnlocked, selectInitialMission, summarizeCheckpoint } from './menuState';

const mission = (id: string, title = `Mission ${id}`): Mission => ({ id, title } as Mission);

const campaign = (...missions: Mission[]): Campaign => ({ missions } as Campaign);

describe('mission menu selection', () => {
  const missions = [mission('one'), mission('two'), mission('practice', 'Night Practice'), mission('four')];
  const testCampaign = campaign(...missions);

  it('unlocks the first mission and training titles without progress', () => {
    expect(isMissionUnlocked(testCampaign, 'one', null)).toBe(true);
    expect(isMissionUnlocked(testCampaign, 'practice', undefined)).toBe(true);
    expect(isMissionUnlocked(campaign(mission('practice', 'Practice sortie')), 'practice', {})).toBe(true);
  });

  it('requires the previous mission to have succeeded, not merely ended', () => {
    expect(isMissionUnlocked(testCampaign, 'two', { one: { outcome: 'success' } })).toBe(true);
    expect(isMissionUnlocked(testCampaign, 'two', { one: { outcome: 'partial' } })).toBe(false);
    expect(isMissionUnlocked(testCampaign, 'two', { one: { outcome: 'failed' } })).toBe(false);
  });

  it('handles malformed progress safely and rejects unknown mission ids', () => {
    for (const malformed of [undefined, null, false, 12, 'saved progress', [], { one: null }, { one: 'success' }, { one: { outcome: 'SUCCESS' } }]) {
      expect(isMissionUnlocked(testCampaign, 'two', malformed)).toBe(false);
    }
    expect(isMissionUnlocked(testCampaign, 'missing', { one: { outcome: 'success' } })).toBe(false);
  });

  it('uses a preferred mission only when it exists and is unlocked', () => {
    expect(selectInitialMission(testCampaign, {}, 'one')).toBe(missions[0]);
    expect(selectInitialMission(testCampaign, {}, 'two')).toBe(missions[0]);
    expect(selectInitialMission(testCampaign, {}, 'missing')).toBe(missions[0]);
    expect(selectInitialMission(testCampaign, { one: { outcome: 'success' } }, 'two')).toBe(missions[1]);
  });
});

describe('checkpoint briefing summary', () => {
  const active = (overrides: Record<string, unknown> = {}) => ({
    campaignId: 'sg_fictional_2026_10',
    missionId: 'mission-1',
    phase: 'transit',
    outcome: 'none',
    timeSec: 136,
    worldRevision: 0,
    ...overrides,
  } as Parameters<typeof summarizeCheckpoint>[0]);

  it('summarizes a matching active checkpoint with phase and elapsed time', () => {
    expect(summarizeCheckpoint(active(), 'sg_fictional_2026_10', 'mission-1')).toEqual({
      phase: 'In transit',
      elapsed: '2m 16s',
      subtitle: 'In transit · 2m 16s elapsed · Saved position will be checked at launch',
    });
  });

  it('ignores checkpoints for another campaign or mission', () => {
    expect(summarizeCheckpoint(active(), 'jp_ketapang_2026_09', 'mission-1')).toBeNull();
    expect(summarizeCheckpoint(active(), 'sg_fictional_2026_10', 'mission-2')).toBeNull();
  });

  it('does not offer terminal, invalid, or malformed checkpoints', () => {
    for (const checkpoint of [
      null,
      active({ phase: 'debrief' }),
      active({ phase: 'failed' }),
      active({ outcome: 'success' }),
      active({ outcome: 'failed' }),
      active({ phase: 'unknown' }),
      active({ timeSec: Number.NaN }),
      active({ timeSec: -1 }),
    ]) {
      expect(summarizeCheckpoint(checkpoint, 'sg_fictional_2026_10', 'mission-1')).toBeNull();
    }
  });

  it('formats long missions without losing the hour count', () => {
    expect(summarizeCheckpoint(active({ timeSec: 3725 }), 'sg_fictional_2026_10', 'mission-1')?.elapsed).toBe('1h 2m');
  });

  it('omits the revision caveat when the saved world is current', () => {
    expect(summarizeCheckpoint(active({ worldRevision: WORLD_REVISION, phase: 'work' }), 'sg_fictional_2026_10', 'mission-1')?.subtitle)
      .toBe('Working the fire · 2m 16s elapsed');
  });
});

describe('launch guard', () => {
  it('blocks a second launch while the first action is pending', async () => {
    const guard = createLaunchGuard();
    let resolveAction!: () => void;
    let launches = 0;
    const first = guard.run(() => {
      launches += 1;
      return new Promise<void>(resolve => { resolveAction = resolve; });
    });

    expect(guard.pending).toBe(true);
    await expect(guard.run(async () => { launches += 1; })).resolves.toBe(false);
    expect(launches).toBe(1);

    resolveAction();
    await expect(first).resolves.toBe(true);
    expect(guard.pending).toBe(false);
  });

  it('clears pending after success and propagates failures while allowing a retry', async () => {
    const guard = createLaunchGuard();
    const failure = new Error('launch failed');

    await expect(guard.run(async () => { throw failure; })).rejects.toBe(failure);
    expect(guard.pending).toBe(false);
    await expect(guard.run(async () => {})).resolves.toBe(true);
    expect(guard.pending).toBe(false);
  });
});
