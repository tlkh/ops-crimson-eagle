import { describe, expect, it } from 'vitest';
import type { Campaign, FlightCommand, Mission } from '../types';
import { createSim, estimateLandingFuel, getObjectiveAction, grossMass, stepSim } from './index';
import type { ExtendedSimState } from './types';
import { renderedTerrainHeight, setStructureColliders, setTreeColliders, terrainHeight } from './collision';
import { BUCKET_BODY_HEIGHT_M, BUCKET_LIFT_OFFSET_M, SLING_LENGTH_M,
  LAKE_SURFACE_M, bucketMinimumRimHeight, bucketSurfaceHeight, getBucketHook, isBucketTouchingLake } from './bucket';
import { shipLandingPoint } from './shipLanding';

const noInput: FlightCommand = {
  yaw: 0,
  climb: 0,
  cyclicX: 0,
  cyclicY: 0,
  drop: false,
  fetch: false,
  faceObjective: false,
  returnHome: false,
  action: false,
};

function makeFixture(japan = false): { campaign: Campaign; mission: Mission } {
  const mission: Mission = {
    id: 'training',
    title: 'Training',
    date: '2026-10-09',
    description: 'Practice sortie',
    lesson: 'Fly, fill, drop, recover',
    seed: 41,
    ship: { x: 0, z: 0, label: 'Ship' },
    shore: { x: 200, z: 0, label: 'Handling site' },
    lake: { x: 0, z: 200, label: 'Lake', radius: 55 },
    fire: { x: 0, z: 215, label: 'Fire', radius: 60 },
    wind: { x: 0.5, z: 0 },
    requiredDrops: 2,
    peat: true,
    protectedLabel: 'Protected forest',
    durationTargetSec: 300,
    timeOfDay: { startMinutes: 330, endMinutes: 480 },
  };
  const campaign: Campaign = {
    id: japan ? 'jp_ketapang_2026_09' : 'sg_fictional_2026_10',
    name: japan ? 'Japan' : 'Singapore',
    subtitle: 'Training',
    operator: japan ? 'JGSDF' : 'RSAF',
    aircraft: japan ? 'CH-47JA' : 'CH-47F',
    shipName: japan ? 'JS Kunisaki' : 'RSN LST',
    evidenceMode: japan ? 'documented_operation_reconstruction' : 'fictional_inspired',
    context: 'Test fixture',
    missions: [mission],
    mass: {
      baseline: japan ? 11_500 : 11_148,
      crew: 600,
      rig: 250,
      fuel: 3_100,
      maxGross: 22_680,
    },
    color: 0xffffff,
    shipLength: japan ? 178 : 141,
    shipWidth: japan ? 25.8 : 21,
  };
  return { campaign, mission };
}

function advance(
  state: ReturnType<typeof createSim>,
  command: FlightCommand,
  campaign: Campaign,
  mission: Mission,
  seconds: number,
): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    stepSim(state, command, campaign, mission);
  }
}

describe('simulation mass and pickup rules', () => {
  it('detects bucket water contact at the lower rim and rejects a bucket held safely above it', () => {
    const { mission } = makeFixture();
    const touching = { x: mission.lake.x, y: BUCKET_BODY_HEIGHT_M + LAKE_SURFACE_M, z: mission.lake.z };
    const above = { ...touching, y: touching.y + 1 };
    expect(isBucketTouchingLake(touching, mission)).toBe(true);
    expect(isBucketTouchingLake(above, mission)).toBe(false);
    expect(isBucketTouchingLake({ ...touching, x: mission.lake.x + mission.lake.radius + 0.1 }, mission)).toBe(false);
  });

  it('stages the bucket beside the aircraft and lifts it only after the sling becomes taut', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    const landing = shipLandingPoint(campaign, mission);
    expect(mission.ship).toMatchObject({ x: 0, z: 0 });
    expect(landing.z).toBe(mission.ship.z + 17);
    expect(state.position).toEqual(landing);
    expect((state as ExtendedSimState).guidance.target).toEqual(landing);
    expect(state.bucket.x).toBe(mission.ship.x + 6);
    expect(state.bucket.z).toBe(landing.z);
    expect(state.bucket.y - BUCKET_BODY_HEIGHT_M).toBeCloseTo(
      bucketSurfaceHeight(campaign, mission, state.bucket.x, state.bucket.z), 5);
    // The aircraft lands at origin y=0; its visible flight deck is y=-2.525.
    expect(state.bucket.y).toBeCloseTo(BUCKET_BODY_HEIGHT_M - 2.525);
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 6.2);
    const resting = { ...state.bucket };
    expect(state.bucketAttached).toBe(true);
    stepSim(state, { ...noInput, climb: 1 }, campaign, mission);
    expect(state.bucket.y).toBeCloseTo(resting.y, 3);
    advance(state, { ...noInput, climb: 1 }, campaign, mission, 8);
    expect(state.bucket.y).toBeGreaterThan(resting.y + 2);
    const hook = getBucketHook(state);
    const rope = Math.hypot(state.bucket.x - hook.x,
      state.bucket.y + BUCKET_LIFT_OFFSET_M - hook.y, state.bucket.z - hook.z);
    expect(rope).toBeLessThanOrEqual(SLING_LENGTH_M + 0.02);
  });

  it('keeps a suspended bucket behind acceleration with bounded tension and no ground penetration', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'transit';
    state.position = { x: mission.lake.x, y: 55, z: mission.lake.z };
    state.bucket = { x: mission.lake.x, y: 31, z: mission.lake.z };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 180; i += 1) {
      stepSim(state, { ...noInput, cyclicY: 1 }, campaign, mission);
      const hook = getBucketHook(state);
      const rope = Math.hypot(state.bucket.x - hook.x,
        state.bucket.y + BUCKET_LIFT_OFFSET_M - hook.y, state.bucket.z - hook.z);
      expect(rope).toBeLessThanOrEqual(SLING_LENGTH_M + 0.02);
      expect(state.bucket.y).toBeGreaterThanOrEqual(bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z) - 1e-6);
      expect(Number.isFinite(state.bucketVelocity.x + state.bucketVelocity.y + state.bucketVelocity.z)).toBe(true);
    }
    expect(state.bucket.z).toBeLessThan(state.position.z - 1);
  });

  it('damps post-maneuver bucket oscillation while retaining slack and a bounded sling', () => {
    const { campaign, mission } = makeFixture();
    for (const full of [false, true]) {
      const state = createSim(campaign, mission);
      state.bucketAttached = true;
      state.bucketLocation = 'aircraft';
      state.phase = 'transit';
      state.position = { x: 0, y: 80, z: 0 };
      state.bucket = { x: 0, y: 59, z: 0 };
      state.bucketVelocity = { x: 0, y: 0, z: 0 };
      if (full) state.waterLitres = campaign.mass.maxGross - grossMass(state, campaign);

      const horizontalOffset: number[] = [];
      for (let i = 0; i < 2_400; i += 1) {
        const cyclicY = i < 240 ? 1 : i < 600 ? 0 : i < 840 ? -1 : 0;
        stepSim(state, { ...noInput, cyclicY }, campaign, mission);
        const hook = getBucketHook(state);
        const rope = Math.hypot(state.bucket.x - hook.x,
          state.bucket.y + BUCKET_LIFT_OFFSET_M - hook.y, state.bucket.z - hook.z);
        expect(rope).toBeLessThanOrEqual(SLING_LENGTH_M + 0.02);
        expect(state.bucket.y).toBeGreaterThanOrEqual(
          bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z) - 1e-6);
        expect(Number.isFinite(state.bucketVelocity.x + state.bucketVelocity.y + state.bucketVelocity.z)).toBe(true);
        horizontalOffset.push(Math.hypot(state.bucket.x - hook.x, state.bucket.z - hook.z));
      }

      const peakDuringManeuver = Math.max(...horizontalOffset.slice(0, 840));
      const mean = (start: number, end: number) =>
        horizontalOffset.slice(start, end).reduce((sum, value) => sum + value, 0) / (end - start);
      const earlierOscillation = mean(1_440, 1_800);
      const laterOscillation = mean(2_040, 2_400);
      expect(peakDuringManeuver).toBeGreaterThan(5); // The sling still lags the aircraft visibly.
      expect(peakDuringManeuver).toBeLessThan(19); // Avoid a near-horizontal swing at this profile.
      expect(laterOscillation).toBeLessThan(earlierOscillation * 0.4);
    }
  });

  it('keeps the bucket body above both deck and sloping terrain', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.position.y = 18;
    state.bucket = { x: mission.ship.x + 6, y: -4, z: shipLandingPoint(campaign, mission).z };
    stepSim(state, noInput, campaign, mission);
    expect(state.bucket.y - BUCKET_BODY_HEIGHT_M).toBeCloseTo(-2.525, 5);

    state.position = { x: 500, y: 35, z: 350 };
    state.bucket = { x: 500, y: 0, z: 350 };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    stepSim(state, noInput, campaign, mission);
    expect(state.bucket.y).toBeGreaterThanOrEqual(bucketMinimumRimHeight(campaign, mission, 500, 350) - 1e-6);
  });
  it('faces the authored outbound route at launch', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    const startDistance = Math.hypot(state.position.x - mission.lake.x, state.position.z - mission.lake.z);
    advance(state, { ...noInput, cyclicY: 1 }, campaign, mission, 3);
    const movedDistance = Math.hypot(state.position.x - mission.lake.x, state.position.z - mission.lake.z);
    expect(movedDistance).toBeLessThan(startDistance);
  });

  it('faces the next objective without flying or climbing, and manual input cancels the turn', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'transit';
    state.position.y = 35;
    state.heading = 0;
    const before = { ...state.position };
    stepSim(state, { ...noInput, faceObjective: true }, campaign, mission);
    expect(state.faceObjectiveActive).toBe(true);
    advance(state, noInput, campaign, mission, 1);
    expect(state.heading).not.toBe(0);
    expect(state.position).toEqual(before);
    stepSim(state, { ...noInput, cyclicX: 0.5 }, campaign, mission);
    expect(state.faceObjectiveActive).toBe(false);
  });

  it('counts baseline, crew, fuel, rig and water exactly once for both profiles', () => {
    for (const japan of [false, true]) {
      const { campaign, mission } = makeFixture(japan);
      const state = createSim(campaign, mission);
      state.bucketAttached = true;
      state.bucketLocation = 'aircraft';
      state.waterLitres = 5_000;
      expect(grossMass(state, campaign)).toBe(japan ? 20_450 : 20_098);
      state.bucketAttached = false;
      expect(grossMass(state, campaign)).toBe(japan ? 15_200 : 14_848);
    }
  });

  it('fills only when the attached bucket is immersed in the lake and moving slowly', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'work';
    state.position = { x: mission.lake.x, y: 22.2, z: mission.lake.z };
    state.bucket = { x: mission.lake.x, y: 0, z: mission.lake.z };
    advance(state, noInput, campaign, mission, 1);
    expect(state.waterLitres).toBe(0);
    stepSim(state, { ...noInput, fetch: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 1);
    expect(state.waterLitres).toBeGreaterThan(0);

    state.waterLitres = 0;
    state.fetching = false;
    state.precisionAction = null;
    state.position = { x: mission.lake.x + mission.lake.radius + 100, y: 22.2, z: mission.lake.z };
    state.bucket = { x: mission.lake.x + mission.lake.radius + 5, y: 0, z: mission.lake.z };
    advance(state, noInput, campaign, mission, 1);
    expect(state.waterLitres).toBe(0);

    state.position = { x: mission.lake.x, y: 22.2, z: mission.lake.z };
    state.bucket = { x: mission.lake.x, y: 0, z: mission.lake.z };
    state.bucketVelocity = { x: 3, y: 0, z: 0 };
    state.fetching = true;
    stepSim(state, noInput, campaign, mission);
    expect(state.waterLitres).toBe(0);
  });

  it('offers fetch and fills at bucket contact when the aircraft is low and offset from the lake center', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'work';
    state.position = { x: mission.lake.x + 60, y: 8, z: mission.lake.z };
    state.bucket = { x: mission.lake.x + 40, y: BUCKET_BODY_HEIGHT_M + LAKE_SURFACE_M, z: mission.lake.z };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };

    expect(getObjectiveAction(state, campaign, mission)).toBe('fetch');
    stepSim(state, { ...noInput, fetch: true }, campaign, mission);
    expect(state.fetching).toBe(true);
    expect(state.position.y).toBeCloseTo(8, 5);
    advance(state, noInput, campaign, mission, 1);
    expect(state.waterLitres).toBeGreaterThan(0);
    expect(state.position.y).toBeCloseTo(8, 5);
  });

  it('caps filling at the aircraft gross-mass limit', () => {
    const { campaign, mission } = makeFixture();
    campaign.mass.maxGross = 17_000;
    const state = createSim(campaign, mission);
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'work';
    state.fuelKg = 3_100;
    state.position = { x: mission.lake.x, y: 22.2, z: mission.lake.z };
    state.bucket = { x: mission.lake.x, y: 0, z: mission.lake.z };
    stepSim(state, { ...noInput, fetch: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 10);
    expect(grossMass(state, campaign)).toBeLessThanOrEqual(campaign.mass.maxGross + 1e-6);
    expect(state.waterLitres).toBeLessThan(5_000);
  });

  it('gives a full suspended load less horizontal acceleration and clamps the world edge', () => {
    const { campaign, mission } = makeFixture();
    const empty = createSim(campaign, mission);
    const full = createSim(campaign, mission);
    for (const state of [empty, full]) {
      state.bucketAttached = true;
      state.bucketLocation = 'aircraft';
      state.position.y = 40;
    }
    full.waterLitres = 5_000;
    advance(empty, { ...noInput, cyclicY: 1 }, campaign, mission, 1);
    advance(full, { ...noInput, cyclicY: 1 }, campaign, mission, 1);
    expect(Math.hypot(full.velocity.x, full.velocity.z)).toBeLessThan(Math.hypot(empty.velocity.x, empty.velocity.z));

    empty.position.x = 10_000;
    stepSim(empty, noInput, campaign, mission);
    expect(empty.position.x).toBeLessThan(10_000);
    expect(empty.velocity.x).toBe(0);
  });
});

describe('water impact and recovery flow', () => {
  it('shows action cues only on final approach and rejects a distant keyboard drop', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.phase = 'work';
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.waterLitres = 2_000;
    state.position = { x: mission.fire.x + 90, y: 55, z: mission.fire.z };
    expect(getObjectiveAction(state, campaign, mission)).toBeNull();
    stepSim(state, { ...noInput, drop: true }, campaign, mission);
    expect(state.waterLitres).toBe(2_000);
    expect(state.releasedLitres).toBe(0);

    state.position = { x: mission.fire.x + 30, y: 75, z: mission.fire.z };
    expect(getObjectiveAction(state, campaign, mission)).toBe('release');
    stepSim(state, { ...noInput, drop: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 22);
    expect(state.dropsCompleted).toBe(1);
    expect(state.waterLitres).toBe(0);
  });

  it('releases one complete dump and conserves water through impact', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'work';
    state.position = { x: mission.fire.x, y: 48, z: mission.fire.z };
    state.bucket = { x: mission.fire.x, y: 25, z: mission.fire.z };
    state.waterLitres = 2_000;
    advance(state, { ...noInput, drop: true }, campaign, mission, 1 / 60);
    advance(state, noInput, campaign, mission, 6);
    expect(state.waterLitres).toBe(0);
    expect(state.releasedLitres).toBeCloseTo(2_000, 4);
    expect(state.airborneLitres).toBeLessThan(2_000);
    expect(state.usefulLitres + state.wastedLitres + state.airborneLitres).toBeCloseTo(state.releasedLitres, 5);
    expect(state.fireHeat).toBeLessThan(100);
    expect(state.dropsCompleted).toBe(1);
  });

  it('emits falling water from the bucket outlet below its rim', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.phase = 'work';
    state.position = { x: mission.fire.x, y: 48, z: mission.fire.z };
    state.bucket = { x: mission.fire.x, y: 25, z: mission.fire.z };
    state.waterLitres = 2_000;
    stepSim(state, { ...noInput, drop: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 0.1);
    expect(state.waterPackets.length).toBeGreaterThan(0);
    expect(state.waterPackets[0].position.y).toBeCloseTo(state.bucket.y - BUCKET_BODY_HEIGHT_M, 1);
  });

  it('settles water packets on elevated terrain rather than the sea-level plane', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    const x = 1300, z = 1300;
    const surface = bucketSurfaceHeight(campaign, mission, x, z);
    expect(surface).toBeGreaterThan(0);
    state.waterPackets.push({ litres: 100, position: { x, y: surface + 0.1, z },
      velocity: { x: 0, y: -20, z: 0 }, dropId: 1 });
    state.airborneLitres = 100;
    stepSim(state, noInput, campaign, mission);
    expect(state.waterPackets).toHaveLength(0);
    expect(state.wastedLitres).toBe(100);
  });

  it('requires stable ship contact before starting recovery', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.phase = 'return';
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.position = { x: mission.ship.x, y: 6, z: mission.ship.z };
    state.velocity = { x: 7, y: 0, z: 0 };
    advance(state, { ...noInput,  }, campaign, mission, 0.5);
    expect(state.phase).toBe('return');
    state.position = shipLandingPoint(campaign, mission);
    state.velocity = { x: 0, y: 0, z: 0 };
    advance(state, noInput, campaign, mission, 1.5);
    expect(state.phase).toBe('deck_rig');
    expect(state.bucketAttached).toBe(true);
  });

  it('keeps a near-deck recovery tap queued through landing and bucket securing', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'return';
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    const landing = shipLandingPoint(campaign, mission);
    state.position = { x: landing.x + 2, y: 5, z: landing.z };
    expect(getObjectiveAction(state, campaign, mission)).toBe('deck-recover');
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 25);
    expect(state.phase).toBe('debrief');
    expect(state.bucketAttached).toBe(false);
    expect(state.precisionAction).toBeNull();
  });

  it('consumes one calibrated minute of full-load fuel over sixty simulated seconds', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.waterLitres = 5_000;
    state.position.y = 60;
    const departureFuel = state.fuelKg;
    advance(state, noInput, campaign, mission, 60);
    expect(departureFuel - state.fuelKg).toBeCloseTo(460, 5);
  });

  it('reduces predicted landing fuel when return distance or suspended load rises', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    const nearbyClean = estimateLandingFuel(state, campaign, mission);
    state.position = { x: mission.lake.x, y: 30, z: mission.lake.z };
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.waterLitres = 5_000;
    const distantLoaded = estimateLandingFuel(state, campaign, mission);
    expect(distantLoaded).toBeLessThan(nearbyClean);
    expect(distantLoaded).toBeGreaterThan(0);
  });

  it('return selects the destination but does not fly there', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    state.phase = 'return';
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.position = { x: mission.lake.x, y: 45, z: mission.lake.z };
    const before = { ...state.position };
    stepSim(state, { ...noInput, returnHome: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 8);
    expect(state.position).toEqual(before);
    expect((state as ExtendedSimState).guidance.label).toBe(campaign.shipName);
    expect((state as ExtendedSimState).guidance.target).toEqual(shipLandingPoint(campaign, mission));
  });

  it('completes the Singapore deck rig, work, and bucket recovery state path', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission);
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 6.2);
    expect(state.phase).toBe('depart');
    expect(state.bucketAttached).toBe(true);

    state.position.y = 24;
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('transit');
    // Relocate the whole system, without carrying a liftoff impulse through
    // this test-only instantaneous jump from the ship to the lake.
    state.position = { x: mission.lake.x, y: 24.86, z: mission.lake.z };
    state.velocity = { x: 0, y: 0, z: 0 };
    state.bucket = { x: mission.lake.x, y: .25, z: mission.lake.z };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('work');
    stepSim(state, { ...noInput, fetch: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 8.5);
    expect(state.waterLitres).toBeGreaterThan(4_000);

    state.position = { x: mission.fire.x, y: 48, z: mission.fire.z };
    state.bucket = { x: mission.fire.x, y: 25, z: mission.fire.z };
    advance(state, { ...noInput, drop: true }, campaign, mission, 1 / 60);
    advance(state, noInput, campaign, mission, 7);
    expect(state.releasedLitres).toBeGreaterThan(4_000);
    expect(state.usefulLitres).toBeGreaterThan(0);

    state.phase = 'return';
    state.position = shipLandingPoint(campaign, mission);
    state.bucket = { ...state.position, y: BUCKET_BODY_HEIGHT_M - 2.525 };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    state.velocity = { x: 0, y: 0, z: 0 };
    advance(state, noInput, campaign, mission, 1.5);
    expect(state.phase).toBe('deck_rig');
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 6.2);
    expect(state.phase).toBe('debrief');
    expect(state.bucketLocation).toBe('ship');
  });
});

describe('Japan shore handling path', () => {
  it('guides a slightly offset shore approach, then attaches the sling', () => {
    const { campaign, mission } = makeFixture(true);
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'shore_rig';
    state.position = { x: mission.shore!.x + 26, y: 6, z: mission.shore!.z };
    expect(getObjectiveAction(state, campaign, mission)).toBe('attach');
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 24);
    expect(state.bucketAttached).toBe(true);
    expect(state.phase).toBe('transit');
    expect(state.precisionAction).toBeNull();
  });

  it('starts and recovers at Kunisaki’s aft flight-deck guide', () => {
    const { campaign, mission } = makeFixture(true);
    const state = createSim(campaign, mission);
    expect(state.position).toMatchObject({ x: mission.ship.x, y: 0, z: mission.ship.z + 20 });
    expect(state.bucket).toMatchObject({ x: mission.shore!.x + 6, z: mission.shore!.z });
    expect(state.bucket.y - BUCKET_BODY_HEIGHT_M).toBeGreaterThanOrEqual(
      bucketSurfaceHeight(campaign, mission, state.bucket.x, state.bucket.z) - 1e-6);

    state.position.x += 15;
    state.position.y = 8;
    advance(state, noInput, campaign, mission, .1);
    expect(state.bucket).toMatchObject({ x: mission.shore!.x + 6, z: mission.shore!.z });

    state.phase = 'return';
    state.position = { x: mission.ship.x, y: 0, z: mission.ship.z + 20 };
    advance(state, noInput, campaign, mission, 1.2);
    expect(state.phase).toBe('debrief');
  });

  it('updates the return route through shore unrigging and final ship recovery without moving the aircraft', () => {
    const { campaign, mission } = makeFixture(true);
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'work';
    state.bucketAttached = true;
    state.bucketLocation = 'aircraft';
    state.position = { x: mission.fire.x, y: 62, z: mission.fire.z };
    stepSim(state, { ...noInput, returnHome: true }, campaign, mission);

    const before = { ...state.position };
    advance(state, noInput, campaign, mission, 10);
    expect(state.position).toEqual(before);
    expect(state.phase).toBe('return');
    state.position = { x: mission.shore!.x, y: 0, z: mission.shore!.z };
    state.velocity = { x: 0, y: 0, z: 0 };
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('shore_unrig');
    expect(state.guidance.label).toBe('Remove sling at shore site');

    state.waterLitres = 2_500;
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 8.2);
    expect(state.phase).toBe('return');
    expect(state.bucketAttached).toBe(false);
    expect(state.waterLitres).toBe(2_500);
    expect(grossMass(state, campaign)).toBeCloseTo(campaign.mass.baseline + campaign.mass.crew + state.fuelKg, 5);
    expect(state.guidance.label).toBe(campaign.shipName);
    state.position = { x: mission.ship.x, y: 0, z: mission.ship.z + 20 };
    state.velocity = { x: 0, y: 0, z: 0 };
    advance(state, noInput, campaign, mission, 1.2);
    expect(state.phase).toBe('debrief');
  });

  it('requires shore rigging and unrigging before ship recovery', () => {
    const { campaign, mission } = makeFixture(true);
    const state = createSim(campaign, mission);
    state.position = { x: mission.shore!.x, y: 0, z: mission.shore!.z };
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('shore_rig');
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 8.2);
    expect(state.phase).toBe('transit');
    expect(state.bucketAttached).toBe(true);

    state.phase = 'return';
    state.position = { x: mission.shore!.x, y: 0, z: mission.shore!.z };
    state.velocity = { x: 0, y: 0, z: 0 };
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('shore_unrig');
    stepSim(state, { ...noInput, action: true }, campaign, mission);
    advance(state, noInput, campaign, mission, 8.2);
    expect(state.phase).toBe('return');
    expect(state.bucketAttached).toBe(false);

    state.position = { x: mission.ship.x, y: 0, z: mission.ship.z };
    state.velocity = { x: 0, y: 0, z: 0 };
    advance(state, noInput, campaign, mission, 1.5);
    expect(state.phase).toBe('debrief');
    expect(state.outcome).toBe('partial');
  });
});

describe('aircraft collision and ground clearance', () => {
  it('fails a terrain impact and raises the stopped aircraft above the visible ground', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    const ground = terrainHeight(campaign, mission, 500, 350)!;
    state.phase = 'transit';
    state.position = { x: 500, y: ground + 1, z: 350 };
    stepSim(state, noInput, campaign, mission);
    expect(state.phase).toBe('failed');
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('Terrain impact');
    expect(state.position.y).toBeGreaterThanOrEqual(renderedTerrainHeight(campaign, mission, 500, 350)! + 2.52);
  });

  it('treats a fast deck strike as a crash but permits a slow recovery', () => {
    const { campaign, mission } = makeFixture();
    const impact = createSim(campaign, mission) as ExtendedSimState;
    impact.phase = 'return';
    impact.velocity.x = 7;
    stepSim(impact, noInput, campaign, mission);
    expect(impact.outcome).toBe('failed');
    expect(impact.message).toContain('RSN LST impact');

    const landing = createSim(campaign, mission) as ExtendedSimState;
    landing.phase = 'return';
    landing.position.y = .01;
    landing.velocity.y = -.8;
    stepSim(landing, noInput, campaign, mission);
    expect(landing.outcome).toBe('none');
    expect(landing.position.y).toBe(0);
    expect(landing.velocity.y).toBe(0);
  });

  it('fails when the cabin strikes the ship superstructure', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'depart';
    state.position = { x: 0, y: 12, z: -40 };
    stepSim(state, noInput, campaign, mission);
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('superstructure');
  });

  it('fails an outboard rail strike before the aircraft origin reaches deck height', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'return';
    state.position = { x: campaign.shipWidth / 2 + 1, y: 1, z: mission.ship.z + 12 };
    stepSim(state, noInput, campaign, mission);
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('RSN LST impact');
  });

  it('detects Persistence mast contact above its bridge roof', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'depart';
    state.position = { x: 0, y: 24, z: -50 };
    stepSim(state, noInput, campaign, mission);
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('superstructure');
  });

  it('keeps the aircraft above Persistence raised forecastle on impact', () => {
    const { campaign, mission } = makeFixture();
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'depart';
    state.position = { x: 0, y: 1, z: -94 };
    stepSim(state, noInput, campaign, mission);
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('forecastle');
    expect(state.position.y).toBeGreaterThan(2);
  });

  it('allows flight above Kunisaki low aft island without an invisible tall wall', () => {
    const { campaign, mission } = makeFixture(true);
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'depart';
    state.position = { x: 7, y: 14, z: -40 };
    stepSim(state, noInput, campaign, mission);
    expect(state.outcome).toBe('none');
    expect(state.failureCause).not.toBe('collision');
  });

  it('detects a tree at rotor radius even when the cabin clears it', () => {
    const { campaign, mission } = makeFixture();
    setTreeColliders(mission, [{ x: 512, z: 500, ground: 0, height: 20, radius: 4 }]);
    const state = createSim(campaign, mission) as ExtendedSimState;
    state.phase = 'transit';
    state.position = { x: 500, y: 18, z: 500 };
    stepSim(state, noInput, campaign, mission);
    expect(state.failureCause).toBe('collision');
    expect(state.message).toContain('Rotor struck a tree');
  });

  it('detects a rotor strike on a structure and clears the shore pad on gentle contact', () => {
    const { campaign, mission } = makeFixture(true);
    setStructureColliders(mission, [{ x: 510, z: 506, halfWidth: 1, halfLength: 1, bottom: 15, top: 30, label: 'tower' }]);
    const strike = createSim(campaign, mission) as ExtendedSimState;
    strike.position = { x: 500, y: 18, z: 500 };
    stepSim(strike, noInput, campaign, mission);
    expect(strike.failureCause).toBe('collision');
    expect(strike.message).toContain('tower impact');

    const landing = createSim(campaign, mission) as ExtendedSimState;
    landing.position = { x: mission.shore!.x, y: 0, z: mission.shore!.z };
    stepSim(landing, noInput, campaign, mission);
    expect(landing.outcome).toBe('none');
    expect(landing.position.y).toBeGreaterThanOrEqual(2.53);
  });
});

it('stops a sea-level bucket at the hull instead of snapping it up onto the deck', () => {
  const { campaign, mission } = makeFixture();
  const state = createSim(campaign, mission) as ExtendedSimState;
  const edge = mission.ship.x + campaign.shipWidth / 2;
  Object.assign(state, {
    phase: 'return', bucketAttached: true, bucketLocation: 'aircraft',
    position: { x: edge + 10, y: 10, z: mission.ship.z + 17 },
    bucket: { x: edge + 1.3, y: -9 + BUCKET_BODY_HEIGHT_M, z: mission.ship.z + 17 },
    bucketVelocity: { x: -40, y: 0, z: 0 },
    precisionAction: 'deck-recover',
  });
  const oldBucket = { ...state.bucket };
  stepSim(state, noInput, campaign, mission);
  expect(state.phase).not.toBe('failed');
  expect(state.bucket).toEqual(oldBucket);
  expect(state.precisionAction).toBeNull();
  expect(getObjectiveAction(state, campaign, mission)).not.toBe('deck-recover');
  expect(state.message).toContain('Raise the bucket above the flight deck');
});
