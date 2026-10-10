import type { Campaign, Mission } from '../types';

type MissionProgress = { outcome?: unknown };

/** Returns whether a mission can be launched using campaign progress data. */
export function isMissionUnlocked(campaign: Campaign, missionId: string, progress: unknown): boolean {
  const index = campaign.missions.findIndex(mission => mission.id === missionId);
  if (index < 0) return false;

  const mission = campaign.missions[index];
  if (/training|practice/i.test(mission.title) || index === 0) return true;

  const previous = campaign.missions[index - 1];
  if (!isRecord(progress) || !Object.prototype.hasOwnProperty.call(progress, previous.id)) return false;

  try {
    const previousProgress = progress[previous.id];
    return isRecord(previousProgress) && (previousProgress as MissionProgress).outcome === 'success';
  } catch {
    return false;
  }
}

/** Chooses a valid unlocked preference, falling back to the first unlocked mission. */
export function selectInitialMission(campaign: Campaign, progress: unknown, preferredId?: string): Mission {
  if (preferredId && isMissionUnlocked(campaign, preferredId, progress)) {
    return campaign.missions.find(mission => mission.id === preferredId)!;
  }
  return campaign.missions.find(mission => isMissionUnlocked(campaign, mission.id, progress))!;
}

/** Prevents concurrent launches and releases the guard after either outcome. */
export function createLaunchGuard(): {
  run(action: () => Promise<void>): Promise<boolean>;
  readonly pending: boolean;
} {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    async run(action) {
      if (pending) return false;
      pending = true;
      try {
        await action();
        return true;
      } finally {
        pending = false;
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
