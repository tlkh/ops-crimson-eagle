import type { Campaign } from '../types';

/** Photo-estimated solid fittings shared by the model and headless collision. */
export function shipRadomePlacements(campaign: Pick<Campaign, 'id' | 'shipLength' | 'shipWidth'>) {
  if (campaign.id !== 'jp_ketapang_2026_09') return [];
  const bridgeX = campaign.shipWidth * .27;
  const bridgeZ = 40 - campaign.shipLength + campaign.shipLength * .392;
  return [
    { x: bridgeX - 2.7, y: 8.60, z: bridgeZ + 2.1, radius: 1.25 },
    { x: bridgeX + 2.7, y: 8.32, z: bridgeZ - 2.3, radius: .92 },
  ];
}
