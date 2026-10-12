import { describe, expect, it } from 'vitest';
import { isResumableCheckpoint, type CheckpointSelection } from './checkpointSelection';

const active: CheckpointSelection = {
  campaignId: 'sg_fictional_2026_10', missionId: 'sg-1', phase: 'transit', outcome: 'none', timeSec: 74,
};

describe('checkpoint selection', () => {
  it('resumes only a matching active sortie', () => {
    expect(isResumableCheckpoint(active, active.campaignId, active.missionId)).toBe(true);
    expect(isResumableCheckpoint(active, 'jp_ketapang_2026_09', active.missionId)).toBe(false);
    expect(isResumableCheckpoint(active, active.campaignId, 'sg-2')).toBe(false);
  });

  it('starts fresh for terminal, malformed, or invalid-time snapshots', () => {
    for (const patch of [
      { phase: 'debrief' }, { phase: 'failed' }, { phase: 'unknown' },
      { outcome: 'success' }, { outcome: 'failed' },
      { timeSec: -1 }, { timeSec: Number.NaN }, { timeSec: Infinity },
    ]) {
      expect(isResumableCheckpoint({ ...active, ...patch } as CheckpointSelection, active.campaignId, active.missionId)).toBe(false);
    }
    expect(isResumableCheckpoint(null, active.campaignId, active.missionId)).toBe(false);
  });
});
