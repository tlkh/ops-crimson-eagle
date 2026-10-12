import { describe, expect, it } from 'vitest';
import type { WaterPacket } from '../../src/sim/types';
import { WaterPacketIdentityRecorder, WaterPacketReplay } from './packetReplay';

const packet = (x: number): WaterPacket => ({
  litres: 180,
  position: { x, y: 42, z: 9 },
  velocity: { x: 1, y: -4, z: 0 },
  dropId: 2,
});

describe('trailer water packet replay', () => {
  it('preserves packet identity while packets move and disappear, without mutating snapshots', () => {
    const livePacket = packet(10);
    const recorder = new WaterPacketIdentityRecorder();
    const replay = new WaterPacketReplay();
    const firstSnapshot = structuredClone({ waterPackets: [livePacket] });
    const firstIds = recorder.idsFor([livePacket]);
    const first = replay.apply(firstSnapshot, firstIds);

    livePacket.position.x = 12;
    const secondSnapshot = structuredClone({ waterPackets: [livePacket] });
    const secondIds = recorder.idsFor([livePacket]);
    const second = replay.apply(secondSnapshot, secondIds);

    expect(second.waterPackets[0]).toBe(first.waterPackets[0]);
    expect(second.waterPackets[0].position.x).toBe(12);
    expect(new Set(second.waterPackets).has(first.waterPackets[0])).toBe(true);
    expect(firstSnapshot.waterPackets[0].position.x).toBe(10);
    expect(secondSnapshot.waterPackets[0].position.x).toBe(12);

    const afterImpact = replay.apply({ waterPackets: [] }, []);
    expect(new Set(afterImpact.waterPackets).has(first.waterPackets[0])).toBe(false);
  });

  it('recreates canonical identities after a replay reset', () => {
    const source = packet(4);
    const ids = new WaterPacketIdentityRecorder().idsFor([source]);
    const snapshot = structuredClone({ waterPackets: [source] });
    const replay = new WaterPacketReplay();
    const first = replay.apply(snapshot, ids).waterPackets[0];
    replay.reset();
    const afterReset = replay.apply(snapshot, ids).waterPackets[0];
    expect(afterReset).not.toBe(first);
    expect(afterReset).toEqual(first);
  });
});
