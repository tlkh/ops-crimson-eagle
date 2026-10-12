import type { Campaign } from '../types';

export type ShipLocalPoint = { x: number; y: number; z: number };

export type ShipLightLayout = {
  sternZ: number;
  deckY: number;
  mastBeacon: ShipLocalPoint;
  bridge: {
    center: ShipLocalPoint;
    topY: number;
    wingOffsetX: number;
  };
  deckFlood: {
    position: ShipLocalPoint;
    target: ShipLocalPoint;
    housing: ShipLocalPoint;
  };
  deckEdgeLamps: ShipLocalPoint[];
};

const DECK_Y = -2.525;
const MODEL_DECK_Y = -2.55;

/**
 * Shared local anchors for ship navigation lamps and the single working-deck
 * flood. These are derived from the authored ship geometry and stay independent
 * of a mission's world position and heading.
 */
export function createShipLightLayout(campaign: Campaign): ShipLightLayout {
  const japanese = campaign.id === 'jp_ketapang_2026_09';
  const length = campaign.shipLength;
  const width = campaign.shipWidth;
  const sternZ = japanese ? 40 : 35;
  const station = (fraction: number) => sternZ - length + fraction * length;
  const bridgeX = japanese ? width * 0.27 : 0;
  const bridgeTopY = japanese ? MODEL_DECK_Y + 9.55 : MODEL_DECK_Y + 11.4;
  const bridgeZ = japanese ? station(0.392) : station(0.292);
  const bridgeWingOffsetX = japanese ? width * 0.19 : width * 0.37;
  const bridgeLampY = bridgeTopY - 0.7;

  const mastBeacon = japanese
    ? { x: width * 0.27 - 1, y: MODEL_DECK_Y + 9.7 + 14 + 0.15, z: station(0.445) }
    : { x: 0, y: MODEL_DECK_Y + 10 + 17 + 0.15, z: station(0.395) };

  // Both fixtures sit at the aftmost visible superstructure edge, then aim at
  // the geometric center of the open deck for even working-area coverage.
  const deckFlood = japanese
    ? (() => {
      const islandX = width * 0.27;
      const islandCenterZ = station(0.47);
      const islandAftFaceZ = islandCenterZ + length * 0.245 * 0.5;
      const housing = { x: islandX, y: MODEL_DECK_Y + 4.75, z: islandAftFaceZ + 0.06 };
      return {
        position: { x: islandX, y: housing.y + 0.06, z: housing.z + 0.12 },
        target: { x: 0, y: MODEL_DECK_Y + 0.18, z: (islandAftFaceZ + sternZ) * 0.5 },
        housing,
      };
    })()
    : (() => {
      const hangarAftFaceZ = -40.5 + 12 * 0.5;
      const housing = { x: 0, y: MODEL_DECK_Y + 6.3 + 0.15, z: hangarAftFaceZ + 0.05 };
      return {
        position: { x: 0, y: housing.y + 0.12, z: housing.z + 0.13 },
        target: { x: 0, y: MODEL_DECK_Y + 0.18, z: (hangarAftFaceZ + sternZ) * 0.5 },
        housing,
      };
    })();

  const edgeX = width * 0.5 - 0.9;
  const edgeZ = japanese ? [-13, 2, 17, 31] : [-19, -4, 11, 26];
  const deckEdgeLamps = edgeZ.flatMap(z => [-1, 1].map(side => ({
    x: side * edgeX,
    y: MODEL_DECK_Y + 0.12,
    z,
  })));
  return {
    sternZ,
    deckY: DECK_Y,
    mastBeacon,
    bridge: {
      center: { x: bridgeX, y: bridgeLampY, z: bridgeZ },
      topY: bridgeTopY,
      wingOffsetX: bridgeWingOffsetX,
    },
    deckFlood,
    deckEdgeLamps,
  };
}
