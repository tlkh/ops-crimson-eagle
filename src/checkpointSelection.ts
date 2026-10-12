import type { CampaignId, Phase, SimState } from './types';

export type CheckpointSelection = Pick<SimState, 'campaignId' | 'missionId' | 'phase' | 'outcome' | 'timeSec'>;

const activePhases: ReadonlySet<Phase> = new Set<Phase>([
  'prepare', 'depart', 'shore_rig', 'transit', 'work', 'return', 'shore_unrig', 'deck_rig', 'land',
]);

/** The menu label and actual launch must agree on whether a save can resume. */
export function isResumableCheckpoint<T extends CheckpointSelection>(
  checkpoint: T | null | undefined,
  campaignId: CampaignId,
  missionId: string,
): checkpoint is T {
  return !!checkpoint
    && checkpoint.campaignId === campaignId
    && checkpoint.missionId === missionId
    && checkpoint.outcome === 'none'
    && activePhases.has(checkpoint.phase)
    && Number.isFinite(checkpoint.timeSec)
    && checkpoint.timeSec >= 0;
}
