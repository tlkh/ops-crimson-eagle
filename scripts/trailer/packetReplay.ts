import type { WaterPacket } from '../../src/sim/types';

/** Assigns a stable playback key to each packet while the live simulation owns it. */
export class WaterPacketIdentityRecorder {
  private readonly ids = new WeakMap<WaterPacket, number>();
  private nextId = 1;

  idsFor(packets: readonly WaterPacket[]): number[] {
    return packets.map(packet => {
      let id = this.ids.get(packet);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(packet, id);
      }
      return id;
    });
  }
}

/** Reuses packet objects across cloned frames so renderer identity tracks impacts correctly. */
export class WaterPacketReplay {
  private readonly packets = new Map<number, WaterPacket>();

  apply<T extends { waterPackets: WaterPacket[] }>(snapshot: T, packetIds: readonly number[]): T {
    if (snapshot.waterPackets.length !== packetIds.length) {
      throw new Error(`Water packet replay mismatch: ${snapshot.waterPackets.length} packets, ${packetIds.length} IDs`);
    }

    const waterPackets = snapshot.waterPackets.map((saved, index) => {
      const id = packetIds[index];
      if (id === undefined) throw new Error(`Missing water packet replay ID at index ${index}`);
      let packet = this.packets.get(id);
      if (!packet) {
        packet = {
          litres: saved.litres,
          position: { ...saved.position },
          velocity: { ...saved.velocity },
          dropId: saved.dropId,
        };
        this.packets.set(id, packet);
      } else {
        packet.litres = saved.litres;
        packet.position.x = saved.position.x;
        packet.position.y = saved.position.y;
        packet.position.z = saved.position.z;
        packet.velocity.x = saved.velocity.x;
        packet.velocity.y = saved.velocity.y;
        packet.velocity.z = saved.velocity.z;
        packet.dropId = saved.dropId;
      }
      return packet;
    });

    // Keep the archived snapshot and its cloned packets immutable during replay.
    return { ...snapshot, waterPackets };
  }

  reset(): void {
    this.packets.clear();
  }
}
