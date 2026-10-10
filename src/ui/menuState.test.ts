import { describe, expect, it } from 'vitest';
import type { Campaign, Mission } from '../types';
import { createLaunchGuard, isMissionUnlocked, selectInitialMission } from './menuState';

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
