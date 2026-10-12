import { isResumableCheckpoint } from '../checkpointSelection';
import { WORLD_REVISION } from '../worldRevision';
import type { Campaign, CampaignId, Mission, Phase, SimState } from '../types';

type MissionProgress = { outcome?: unknown };

export type CheckpointSnapshot = Pick<SimState, 'campaignId' | 'missionId' | 'phase' | 'outcome' | 'timeSec' | 'worldRevision'>;
export type CheckpointSummary = { phase: string; elapsed: string; subtitle: string };

const checkpointPhases: Partial<Record<Phase, string>> = {
  prepare: 'preparing on deck',
  depart: 'departing',
  shore_rig: 'rigging at shore',
  transit: 'in transit',
  work: 'working the fire',
  return: 'returning to base',
  shore_unrig: 'unrigging at shore',
  deck_rig: 'rigging on deck',
  land: 'deck recovery',
};

/** Describes a checkpoint only when the selected mission can resume it. */
export function summarizeCheckpoint(
  checkpoint: CheckpointSnapshot | null | undefined,
  campaignId: CampaignId,
  missionId: string,
): CheckpointSummary | null {
  if (!isResumableCheckpoint(checkpoint, campaignId, missionId)) return null;

  const phase = checkpointPhases[checkpoint.phase];
  if (!phase) return null;
  const seconds = Math.floor(checkpoint.timeSec);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${remainder}s`;
  const displayPhase = `${phase[0].toUpperCase()}${phase.slice(1)}`;
  const revisionNote = checkpoint.worldRevision === WORLD_REVISION ? '' : ' · Saved position will be checked at launch';
  return { phase: displayPhase, elapsed, subtitle: `${displayPhase} · ${elapsed} elapsed${revisionNote}` };
}

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
