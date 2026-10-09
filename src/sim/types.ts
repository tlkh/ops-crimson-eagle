import type { SimState, Vec3 } from '../types';

/** A compact, serialisable packet used by the authoritative water-impact model. */
export type WaterPacket = {
  litres: number;
  position: Vec3;
  velocity: Vec3;
  dropId: number;
};

/**
 * Runtime fields that are part of a save as well as the visible SimState.
 * They live beside the core data types so the game can persist an in-progress
 * dump and its airborne water without relying on non-serialisable closures.
 */
export type ExtendedSimState = SimState & {
  dumping: boolean;
  dropHeld: boolean;
  dropId: number;
  dumpStartedWithLitres: number;
  dropPacketTime: number;
  dropPacketLitres: number;
  waterPackets: WaterPacket[];
  guidance: { target: Vec3; label: string; distanceM: number };
  faceObjectiveActive: boolean;
  precisionAction: 'attach' | 'fetch' | 'release' | 'unrig' | 'deck-rig' | 'deck-recover' | null;
  fetching: boolean;
  failureCause: 'collision' | null;
};
