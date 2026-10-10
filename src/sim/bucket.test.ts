import { describe, expect, it } from 'vitest';
import { campaigns } from '../content';
import { createSim } from './index';
import { BUCKET_BODY_HEIGHT_M, bucketCrossesShipSide, bucketReadyForDeckRecovery, isBucketFootprintOverDeck, SHIP_DECK_SURFACE_M } from './bucket';
import { shipLandingPoint } from './shipLanding';

describe('bucket deck recovery readiness', () => {
  it('requires the whole attached bucket to be over the deck and clear of its surface', () => {
    for (const campaign of campaigns) for (const mission of campaign.missions) {
      const state = createSim(campaign, mission);
      state.bucketAttached = true;
      const landing = shipLandingPoint(campaign, mission);
      state.bucket = {
        x: landing.x,
        y: SHIP_DECK_SURFACE_M + BUCKET_BODY_HEIGHT_M,
        z: landing.z,
      };
      expect(isBucketFootprintOverDeck(state, campaign, mission), `${campaign.id}/${mission.id} on deck`).toBe(true);
      expect(bucketReadyForDeckRecovery(state, campaign, mission), `${campaign.id}/${mission.id} ready`).toBe(true);

      state.bucket.x = mission.ship.x + campaign.shipWidth / 2;
      expect(isBucketFootprintOverDeck(state, campaign, mission), `${campaign.id}/${mission.id} footprint outside`).toBe(false);
      expect(bucketReadyForDeckRecovery(state, campaign, mission), `${campaign.id}/${mission.id} outside`).toBe(false);

      state.bucket.x = landing.x;
      state.bucket.y = SHIP_DECK_SURFACE_M + BUCKET_BODY_HEIGHT_M - 0.2;
      expect(bucketReadyForDeckRecovery(state, campaign, mission), `${campaign.id}/${mission.id} below deck`).toBe(false);
    }
  });

  it('allows deck landing when no bucket is attached', () => {
    const campaign = campaigns[0];
    const mission = campaign.missions[0];
    const state = createSim(campaign, mission);
    state.bucketAttached = false;
    expect(bucketReadyForDeckRecovery(state, campaign, mission)).toBe(true);
  });
});


it('blocks a swept sea-level load at every hull side while allowing a clear overhead approach', () => {
  const campaign = campaigns[0], mission = campaign.missions[0];
  const landing = shipLandingPoint(campaign, mission);
  for (const side of [-1, 1]) {
    const from = { x: mission.ship.x + side * (campaign.shipWidth / 2 + 5), y: -7.52, z: landing.z };
    const to = { x: landing.x, y: -7.52, z: landing.z };
    expect(bucketCrossesShipSide(from, to, campaign, mission)).toBe(true);
    expect(bucketCrossesShipSide({ ...from, y: 10 }, { ...to, y: 10 }, campaign, mission)).toBe(false);
  }
  expect(bucketCrossesShipSide({ ...landing, y: 10 }, { ...landing, y: 0 }, campaign, mission)).toBe(false);
});
