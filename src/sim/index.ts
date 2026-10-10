import { shouldObserveFire } from './fireWork';
import type { Campaign, FlightCommand, Mission, SimState, Vec3 } from '../types';
import type { ExtendedSimState } from './types';
import { nearbyTrees, renderedTerrainHeight, structureColliders, terrainHeight } from './collision';
import { BUCKET_BODY_HEIGHT_M, BUCKET_FLOAT_RIM_M, BUCKET_HOOK_OFFSET_M, BUCKET_LIFT_OFFSET_M,
  SLING_LENGTH_M, bucketReadyForDeckRecovery, bucketCrossesShipSide, bucketMinimumRimHeight, bucketSurfaceHeight, getBucketHook, isBucketTouchingLake } from './bucket';
import { shipLandingLocalZ, shipLandingPoint } from './shipLanding';

export type { ExtendedSimState, WaterPacket } from './types';

const STEP = 1 / 60;
const WATER_CAPACITY_L = 5_000;
const WATER_DENSITY_KG_PER_L = 1;
const FILL_RATE_L_PER_SEC = 750;
const DUMP_RATE_L_PER_SEC = 1_250;
const DECK_RIG_DURATION_SEC = 6;
const SHORE_RIG_DURATION_SEC = 8;
const WATER_PACKET_INTERVAL_SEC = 0.1;
const MAX_BANK = 25 * Math.PI / 180;
const MAX_PITCH = 25 * Math.PI / 180;
const MAX_DAMAGE = 100;
const EPSILON = 1e-8;
const TYRE_CLEARANCE_M = 2.53;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const safe = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;
const smoothFactor = (dt: number, seconds: number): number => 1 - Math.exp(-dt / seconds);
const copyVec = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const xz = (v: Pick<Vec3, 'x' | 'z'>): Vec3 => ({ x: v.x, y: 0, z: v.z });

export function distance2D(a: Vec3, b: Vec3): number;
export function distance2D(a: Pick<Vec3, 'x' | 'z'>, b: Pick<Vec3, 'x' | 'z'>): number;
export function distance2D(a: Pick<Vec3, 'x' | 'z'>, b: Pick<Vec3, 'x' | 'z'>): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const emptyBucketMass = (campaign: Campaign): number =>
  campaign.mass.baseline + campaign.mass.crew + campaign.mass.fuel;

export function grossMass(state: SimState, campaign: Campaign): number {
  const rigMass = state.bucketAttached ? campaign.mass.rig : 0;
  return campaign.mass.baseline + campaign.mass.crew + Math.max(0, state.fuelKg) +
    rigMass + (state.bucketAttached ? Math.max(0, state.waterLitres) * WATER_DENSITY_KG_PER_L : 0);
}

function isJapan(campaign: Campaign): boolean {
  return campaign.id === 'jp_ketapang_2026_09';
}

function handlingPoint(campaign: Campaign, mission: Mission): Vec3 {
  // Older/custom mission manifests may omit the reconstructed shore site. The
  // lake is a safe gameplay fallback; authored Japan missions provide shore.
  const marker = mission.shore ?? (isJapan(campaign) ? mission.lake : mission.ship);
  return { x: marker.x, y: 0, z: marker.z };
}

function bucketStagingPoint(campaign: Campaign, mission: Mission, location: 'ship' | 'shore'): Vec3 {
  const site = location === 'shore' ? handlingPoint(campaign, mission) : shipLandingPoint(campaign, mission);
  // Ground crews stage the load beside the fuselage, clear of the landing gear.
  const x = site.x + 6;
  return { x, y: bucketMinimumRimHeight(campaign, mission, x, site.z), z: site.z };
}

function effectiveBurnKgPerMin(state: SimState): number {
  if (!state.bucketAttached) return 320;
  const payload = clamp(state.waterLitres / WATER_CAPACITY_L, 0, 1);
  if (payload <= EPSILON) return 360;
  if (payload <= 0.5) return 360 + (payload / 0.5) * 60;
  return 420 + ((payload - 0.5) / 0.5) * 40;
}

function legFuelKg(from: Vec3, to: Vec3, state: SimState, campaign: Campaign, mission: Mission): number {
  const distance = distance2D(from, to);
  if (distance < 1) return 0;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const along = Math.hypot(dx, dz) > 0 ? (dx / distance) * mission.wind.x + (dz / distance) * mission.wind.z : 0;
  const attached = state.bucketAttached;
  const cruise = attached ? 36 : (isJapan(campaign) ? 68 : 71);
  const groundSpeed = Math.max(attached ? 18 : 30, cruise + along);
  const minutes = distance / groundSpeed / 60;
  const payload = clamp(state.waterLitres / WATER_CAPACITY_L, 0, 1);
  const burn = attached ? (360 + payload * 100) : 320;
  return minutes * burn;
}

/** Estimates fuel remaining when the aircraft reaches and recovers aboard its ship. */
export function estimateLandingFuel(state: SimState, campaign: Campaign, mission: Mission): number {
  const here = xz(state.position);
  const ship = shipLandingPoint(campaign, mission);
  const shore = handlingPoint(campaign, mission);
  let required = 0;

  if (isJapan(campaign) && (state.bucketAttached || state.bucketLocation === 'shore')) {
    required += legFuelKg(here, shore, state, campaign, mission);
    if (state.bucketAttached) {
      // Handling is an engine-running stop; fuel is still consumed while the
      // crew removes the sling before the clean ferry to Kunisaki.
      required += effectiveBurnKgPerMin(state) * 0.5;
      const cleanState = { ...state, bucketAttached: false, waterLitres: 0 };
      required += legFuelKg(shore, ship, cleanState, campaign, mission);
    } else {
      required += legFuelKg(shore, ship, state, campaign, mission);
    }
  } else {
    required += legFuelKg(here, ship, state, campaign, mission);
  }

  // Covers stabilised approach, contact and (for Singapore) deck recovery.
  required += effectiveBurnKgPerMin(state) * (isJapan(campaign) ? 0.55 : 0.75);
  return Math.max(0, state.fuelKg - required);
}

function worldBounds(mission: Mission): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const markers = [mission.ship, mission.shore, mission.lake, mission.fire].filter(
    (marker): marker is NonNullable<typeof marker> => marker !== undefined,
  );
  const xs = markers.map((marker) => marker.x);
  const zs = markers.map((marker) => marker.z);
  const spanX = Math.max(1_000, Math.max(...xs) - Math.min(...xs));
  const spanZ = Math.max(1_000, Math.max(...zs) - Math.min(...zs));
  const padX = Math.max(2_500, spanX * 0.12);
  const padZ = Math.max(2_500, spanZ * 0.12);
  return {
    minX: Math.min(...xs) - padX,
    maxX: Math.max(...xs) + padX,
    minZ: Math.min(...zs) - padZ,
    maxZ: Math.max(...zs) + padZ,
  };
}

function setMessage(state: ExtendedSimState, message: string, seconds = 3): void {
  state.message = message;
  state.messageUntil = state.timeSec + seconds;
}

function shipContact(state: SimState, campaign: Campaign, mission: Mission): boolean {
  const landingPoint = shipLandingPoint(campaign, mission);
  const dx = Math.abs(state.position.x - landingPoint.x);
  const dz = Math.abs(state.position.z - landingPoint.z);
  const halfLength = clamp(campaign.shipLength * 0.22, 18, 42);
  const halfWidth = Math.max(7, campaign.shipWidth / 2 - 1.4);
  // Ship geometry runs lengthwise along world Z, with its beam along X.
  return (isJapan(campaign) || !state.bucketAttached || (bucketReadyForDeckRecovery(state, campaign, mission) && Math.hypot(dx, dz) <= 5)) &&
    dx <= halfWidth && dz <= halfLength && state.position.y <= 2.2 &&
    Math.hypot(state.velocity.x, state.velocity.z) <= 2.5 && Math.abs(state.velocity.y) <= 1.2;
}

function shoreContact(state: SimState, campaign: Campaign, mission: Mission): boolean {
  const site = handlingPoint(campaign, mission);
  return distance2D(state.position, site) <= 17 && state.position.y <= 3.2 &&
    Math.hypot(state.velocity.x, state.velocity.z) <= 2.5 && Math.abs(state.velocity.y) <= 1.2;
}

function makeInitialState(campaign: Campaign, mission: Mission): ExtendedSimState {
  const japanese = isJapan(campaign);
  const landingPoint = shipLandingPoint(campaign, mission);
  return {
    campaignId: campaign.id,
    missionId: mission.id,
    tick: 0,
    timeSec: 0,
    phase: japanese ? 'depart' : 'deck_rig',
    position: copyVec(landingPoint),
    velocity: { x: 0, y: 0, z: 0 },
    // The authored route runs toward +Z; the rendered Chinook points along
    // local -Z, so a half-turn puts its nose toward the first waypoint.
    heading: Math.PI,
    bank: 0,
    pitch: 0,
    bucket: bucketStagingPoint(campaign, mission, japanese ? 'shore' : 'ship'),
    bucketVelocity: { x: 0, y: 0, z: 0 },
    bucketAttached: false,
    bucketLocation: japanese ? 'shore' : 'ship',
    waterLitres: 0,
    releasedLitres: 0,
    usefulLitres: 0,
    wastedLitres: 0,
    airborneLitres: 0,
    fuelKg: campaign.mass.fuel,
    fireHeat: 100,
    peatHeat: mission.peat ? 72 : 0,
    fireState: 'burning',
    dropsCompleted: 0,
    crewProgress: 0,
    objectiveSaved: false,
    damage: 0,
    message: '',
    messageUntil: 0,
    rigProgress: 0,
    stabilitySec: 0,
    score: 0,
    outcome: 'none',
    rng: mission.seed >>> 0,
    dumping: false,
    dropHeld: false,
    dropId: 0,
    dumpStartedWithLitres: 0,
    dropPacketTime: 0,
    dropPacketLitres: 0,
    waterPackets: [],
    guidance: { target: copyVec(landingPoint), label: 'Ship deck', distanceM: 0 },
    faceObjectiveActive: false,
    precisionAction: null,
    fetching: false,
    failureCause: null,
  };
}

export function createSim(campaign: Campaign, mission: Mission): SimState {
  return makeInitialState(campaign, mission);
}

function rand(state: SimState): number {
  // Mulberry32; seeded per mission and stored in the serialised state.
  let value = (state.rng + 0x6d2b79f5) | 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  state.rng = (value ^ (value >>> 14)) >>> 0;
  return state.rng / 4_294_967_296;
}

function updateAttitudeAndFlight(
  state: ExtendedSimState,
  command: FlightCommand,
  campaign: Campaign,
  mission: Mission,
  dt: number,
): Vec3 {
  const mass = grossMass(state, campaign);
  const empty = emptyBucketMass(campaign);
  const loadFraction = clamp((mass - empty) / Math.max(1, campaign.mass.maxGross - empty), 0, 1);
  const attached = state.bucketAttached;
  const maxSpeed = attached ? 52 * (1 - loadFraction * 0.12) : 72;
  const maxAccel = (attached ? 8.0 : 10.5) * (1 - loadFraction * 0.3);
  const climbRate = (attached ? 4.2 : 5.2) * (1 - loadFraction * 0.34);
  const yawRate = 0.95;
  const yawInput = clamp(safe(command.yaw), -1, 1);
  const bankInput = clamp(safe(command.cyclicX), -1, 1);
  const pitchInput = clamp(safe(command.cyclicY), -1, 1);
  const climbInput = clamp(safe(command.climb), -1, 1);
  const desiredHeading = state.heading + yawInput * yawRate * dt;
  state.heading = desiredHeading;

  const attitudeResponse = smoothFactor(dt, 0.72);
  state.bank += (-bankInput * MAX_BANK - state.bank) * attitudeResponse;
  state.pitch += (pitchInput * MAX_PITCH - state.pitch) * attitudeResponse;

  // Three.js model forward is local -Z, so the world-space forward vector
  // follows the same yaw used by the renderer and compass.
  const forwardX = -Math.sin(state.heading);
  const forwardZ = -Math.cos(state.heading);
  const rightX = Math.cos(state.heading);
  const rightZ = -Math.sin(state.heading);
  const ax = (forwardX * pitchInput + rightX * bankInput) * maxAccel;
  const az = (forwardZ * pitchInput + rightZ * bankInput) * maxAccel;

  const damping = attached ? 0.11 : 0.075;
  const accel = { x: ax - state.velocity.x * damping, y: 0, z: az - state.velocity.z * damping };
  state.velocity.x += accel.x * dt;
  state.velocity.z += accel.z * dt;
  const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  if (horizontalSpeed > maxSpeed) {
    const ratio = maxSpeed / horizontalSpeed;
    state.velocity.x *= ratio;
    state.velocity.z *= ratio;
  }

  const bankLift = Math.cos(state.bank);
  const verticalTarget = climbInput * climbRate * bankLift;
  const verticalResponse = smoothFactor(dt, 0.78);
  state.velocity.y += (verticalTarget - state.velocity.y) * verticalResponse;

  const priorVelocity = copyVec(state.velocity);
  state.position.x += state.velocity.x * dt;
  state.position.y += state.velocity.y * dt;
  state.position.z += state.velocity.z * dt;

  const bounds = worldBounds(mission);
  const boundedX = clamp(state.position.x, bounds.minX, bounds.maxX);
  const boundedZ = clamp(state.position.z, bounds.minZ, bounds.maxZ);
  const hitXBoundary = boundedX !== state.position.x;
  const hitZBoundary = boundedZ !== state.position.z;
  if (hitXBoundary || hitZBoundary) {
    state.position.x = boundedX;
    state.position.z = boundedZ;
    if (hitXBoundary) state.velocity.x = 0;
    if (hitZBoundary) state.velocity.z = 0;
  }

  const actualAccel = {
    x: (state.velocity.x - priorVelocity.x) / dt,
    y: (state.velocity.y - priorVelocity.y) / dt,
    z: (state.velocity.z - priorVelocity.z) / dt,
  };
  return actualAccel;
}

const BUCKET_TANGENTIAL_DAMPING_PER_SEC = 0.3;

function updateBucket(
  state: ExtendedSimState,
  campaign: Campaign,
  mission: Mission,
  hookVelocity: Vec3,
  dt: number,
  priorAircraftPosition: Vec3,
): void {
  if (!state.bucketAttached || state.bucketLocation !== 'aircraft') {
    // Retain the place where crews set it down. Resetting x/z to a marker
    // would make a detached bucket jump across the pad.
    state.bucket.y = bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z);
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    return;
  }

  // Semi-implicit gravity and a one-sided rope constraint. A sling carries
  // tension only; while the bucket sits on a deck or lake it can stay slack.
  const old = copyVec(state.bucket);
  const velocity = state.bucketVelocity;
  const atRest = old.y <= bucketMinimumRimHeight(campaign, mission, old.x, old.z) + 0.005;
  if (atRest) {
    const groundDrag = Math.exp(-5.5 * dt);
    velocity.x *= groundDrag;
    velocity.z *= groundDrag;
  }
  velocity.y = (velocity.y - 9.81 * dt) * Math.exp(-0.08 * dt);
  state.bucket.x += velocity.x * dt;
  state.bucket.y += velocity.y * dt;
  state.bucket.z += velocity.z * dt;

  const blockHullCrossing = () => {
    if (!bucketCrossesShipSide(old, state.bucket, campaign, mission)) return false;
    state.bucket = { ...old };
    state.bucketVelocity = { x: 0, y: 0, z: 0 };
    state.position.x = priorAircraftPosition.x;
    state.position.z = priorAircraftPosition.z;
    state.velocity.x = 0; state.velocity.z = 0;
    state.precisionAction = null;
    setMessage(state, 'Raise the bucket above the flight deck before moving aboard.');
    return true;
  };
  const hook = getBucketHook(state);
  for (let iteration = 0; iteration < 3; iteration++) {
    if (blockHullCrossing()) return;
    const floor = bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z);
    if (state.bucket.y < floor) state.bucket.y = floor;
    const dx = state.bucket.x - hook.x;
    const dy = state.bucket.y + BUCKET_LIFT_OFFSET_M - hook.y;
    const dz = state.bucket.z - hook.z;
    const length = Math.hypot(dx, dy, dz);
    if (length <= SLING_LENGTH_M) break;
    const ratio = SLING_LENGTH_M / length;
    state.bucket.x = hook.x + dx * ratio;
    state.bucket.y = hook.y + dy * ratio - BUCKET_LIFT_OFFSET_M;
    state.bucket.z = hook.z + dz * ratio;
  }
  if (blockHullCrossing()) return;
  // The contact plane wins if the aircraft hook is still below a grounded
  // bucket. As the aircraft lifts, the slack is paid out before the load rises.
  const floor = bucketMinimumRimHeight(campaign, mission, state.bucket.x, state.bucket.z);
  if (state.bucket.y < floor) state.bucket.y = floor;
  state.bucketVelocity = {
    x: clamp((state.bucket.x - old.x) / dt, -45, 45),
    y: clamp((state.bucket.y - old.y) / dt, -45, 45),
    z: clamp((state.bucket.z - old.z) / dt, -45, 45),
  };
  const onSurface = state.bucket.y <= floor + 0.005;
  if (onSurface) {
    state.bucketVelocity.y = 0;
  } else {
    // At a taut rope, damp motion along the rope's tangent relative to the
    // moving hook. World-space drag would make a bucket trail at cruise speed.
    const liftPointY = state.bucket.y + BUCKET_LIFT_OFFSET_M;
    const dx = state.bucket.x - hook.x;
    const dy = liftPointY - hook.y;
    const dz = state.bucket.z - hook.z;
    const ropeLength = Math.hypot(dx, dy, dz);
    if (ropeLength >= SLING_LENGTH_M - 0.02) {
      const nx = dx / ropeLength;
      const ny = dy / ropeLength;
      const nz = dz / ropeLength;
      const relativeX = state.bucketVelocity.x - hookVelocity.x;
      const relativeY = state.bucketVelocity.y - hookVelocity.y;
      const relativeZ = state.bucketVelocity.z - hookVelocity.z;
      const radialSpeed = relativeX * nx + relativeY * ny + relativeZ * nz;
      const tangentX = relativeX - nx * radialSpeed;
      const tangentY = relativeY - ny * radialSpeed;
      const tangentZ = relativeZ - nz * radialSpeed;
      // The rope removes outward radial speed, while inward speed may slacken it.
      const allowedRadialSpeed = Math.min(0, radialSpeed);
      const tangentDamping = Math.exp(-BUCKET_TANGENTIAL_DAMPING_PER_SEC * dt);
      state.bucketVelocity = {
        x: hookVelocity.x + nx * allowedRadialSpeed + tangentX * tangentDamping,
        y: hookVelocity.y + ny * allowedRadialSpeed + tangentY * tangentDamping,
        z: hookVelocity.z + nz * allowedRadialSpeed + tangentZ * tangentDamping,
      };
    }
  }
}

function updateRigging(
  state: ExtendedSimState,
  command: FlightCommand,
  campaign: Campaign,
  mission: Mission,
  dt: number,
): void {
  if (state.phase === 'deck_rig') {
    if (!state.bucketAttached) {
      if (shipContact(state, campaign, mission) && (command.action || state.rigProgress > 0)) {
        state.rigProgress = Math.min(1, state.rigProgress + dt / DECK_RIG_DURATION_SEC);
        if (state.rigProgress < 1) setMessage(state, `Rigging bucket · ${Math.round(state.rigProgress * 100)}%`, 0.25);
        if (state.rigProgress >= 1) {
          state.bucketAttached = true;
          state.bucketLocation = 'aircraft';
          state.rigProgress = 0;
          state.stabilitySec = 0;
          state.phase = 'depart';
          setMessage(state, 'Bucket rigged. Lift clear, then fly to the fire sector.');
        }
      } else {
        state.rigProgress = Math.max(0, state.rigProgress - dt * 0.5);
      }
    } else if (shipContact(state, campaign, mission) && (command.action || state.rigProgress > 0)) {
      state.rigProgress = Math.min(1, state.rigProgress + dt / DECK_RIG_DURATION_SEC);
      if (state.rigProgress < 1) setMessage(state, `Securing bucket on deck · ${Math.round(state.rigProgress * 100)}%`, 0.25);
      if (state.rigProgress >= 1) {
        state.bucketAttached = false;
        state.bucketLocation = 'ship';
        state.rigProgress = 0;
        state.phase = 'debrief';
        finishOutcome(state, mission);
        setMessage(state, 'Bucket secured on deck. Sortie complete.');
      }
    } else {
      state.rigProgress = Math.max(0, state.rigProgress - dt * 0.5);
    }
    return;
  }

  if (state.phase === 'shore_rig') {
    const contact = shoreContact(state, campaign, mission);
    if (contact && (command.action || state.rigProgress > 0) && !state.bucketAttached) {
      state.rigProgress = Math.min(1, state.rigProgress + dt / SHORE_RIG_DURATION_SEC);
      if (state.rigProgress < 1) setMessage(state, `Attaching sling · ${Math.round(state.rigProgress * 100)}%`, 0.25);
      if (state.rigProgress >= 1) {
        state.bucketAttached = true;
        state.bucketLocation = 'aircraft';
        state.phase = 'transit';
        state.rigProgress = 0;
        state.stabilitySec = 0;
        setMessage(state, 'Sling attached. Continue to the reconstructed freshwater lake.');
      }
    } else {
      state.rigProgress = Math.max(0, state.rigProgress - dt * 0.5);
    }
    return;
  }

  if (state.phase === 'shore_unrig') {
    const contact = shoreContact(state, campaign, mission);
    if (contact && (command.action || state.rigProgress > 0) && state.bucketAttached) {
      state.rigProgress = Math.min(1, state.rigProgress + dt / SHORE_RIG_DURATION_SEC);
      if (state.rigProgress < 1) setMessage(state, `Removing sling · ${Math.round(state.rigProgress * 100)}%`, 0.25);
      if (state.rigProgress >= 1) {
        state.bucketAttached = false;
        state.bucketLocation = 'shore';
        state.phase = 'return';
        state.rigProgress = 0;
        state.stabilitySec = 0;
        setMessage(state, 'Sling secured ashore. Recover clean to JS Kunisaki.');
      }
    } else {
      state.rigProgress = Math.max(0, state.rigProgress - dt * 0.5);
    }
  }
}

function updatePhase(state: ExtendedSimState, command: FlightCommand, campaign: Campaign, mission: Mission, dt: number): void {
  const japanese = isJapan(campaign);
  const shore = handlingPoint(campaign, mission);
  const shipStable = shipContact(state, campaign, mission);
  const shoreStable = shoreContact(state, campaign, mission);

  if (command.returnHome && state.phase !== 'debrief' && state.phase !== 'failed' &&
    state.phase !== 'deck_rig' && state.phase !== 'shore_rig' && state.phase !== 'shore_unrig') {
    state.phase = 'return';
    setMessage(state, japanese ? 'Return to the shore handling site, then recover to the ship.' : 'Return to the ship for recovery.');
  }

  if (state.phase === 'depart' && state.position.y >= 5) {
    state.phase = japanese ? 'depart' : 'transit';
  }

  if (state.phase === 'depart' && japanese && shoreStable) {
    state.phase = 'shore_rig';
    state.stabilitySec = 0;
    setMessage(state, 'Landed at the shore handling site. Attach the bucket.');
  }

  if (state.phase === 'transit') {
    const fireDistance = distance2D(state.position, mission.fire);
    const lakeDistance = distance2D(state.position, mission.lake);
    if (fireDistance <= mission.fire.radius + 120 || lakeDistance <= mission.lake.radius + 100) {
      state.phase = 'work';
      setMessage(state, 'Work the lake-to-fire cycle. Lower the bucket at the lake and fetch water, then release over the fire.');
    }
  }

  if (state.phase === 'work' && state.objectiveSaved && state.dropsCompleted >= mission.requiredDrops) {
    state.phase = 'return';
    setMessage(state, japanese ? 'Fire secured. Return to the shore site to remove the sling.' : 'Fire secured. Return to the ship for recovery.');
  }

  if (state.phase === 'return' && japanese && state.bucketAttached && shoreStable) {
    state.phase = 'shore_unrig';
    state.stabilitySec = 0;
    setMessage(state, 'Land at the shore site and remove the sling before the clean ferry home.');
  }

  if (state.phase === 'return' && shipStable && (!japanese || !state.bucketAttached)) {
    state.phase = 'land';
    state.stabilitySec = 0;
  }

  if (state.phase === 'land') {
    if (shipStable) state.stabilitySec += dt;
    else state.stabilitySec = Math.max(0, state.stabilitySec - 2 * dt);
    if (state.stabilitySec >= 1.1) {
      if (japanese) {
        state.phase = 'debrief';
        finishOutcome(state, mission);
        setMessage(state, 'Recovered aboard JS Kunisaki. Sortie complete.');
      } else {
        state.phase = 'deck_rig';
        state.stabilitySec = 0;
        setMessage(state, 'Aircraft secure. Use the action control to recover the bucket to the deck.');
      }
    }
  }

  // If the player asks to return before entering the work area, guidance still
  // points at the correct operating sequence and permits a safe partial sortie.
  if (state.phase === 'return' && japanese && !state.bucketAttached && distance2D(state.position, shore) < 3) {
    state.bucketLocation = 'shore';
  }
}

function finishOutcome(state: ExtendedSimState, mission: Mission): void {
  if (state.damage >= MAX_DAMAGE || state.fuelKg <= 0) {
    state.outcome = 'failed';
    state.phase = 'failed';
    return;
  }
  const objectiveSatisfied = state.objectiveSaved;
  const enoughDrops = state.dropsCompleted >= mission.requiredDrops;
  state.outcome = objectiveSatisfied && enoughDrops ? 'success' : 'partial';
  state.score = Math.round(state.usefulLitres * 0.08 + state.crewProgress * 5 + (objectiveSatisfied ? 1000 : 0));
}

function navigationTarget(state: ExtendedSimState, campaign: Campaign, mission: Mission): { target: Vec3; label: string } {
  const ship = shipLandingPoint(campaign, mission);
  const shore = handlingPoint(campaign, mission);
  const lake = { x: mission.lake.x, y: 0, z: mission.lake.z };
  const fire = { x: mission.fire.x, y: 0, z: mission.fire.z };
  if (state.phase === 'deck_rig' || state.phase === 'land') {
    return { target: ship, label: state.bucketAttached ? 'Recover bucket on flight deck' : 'Rig bucket on flight deck' };
  }
  if (state.phase === 'shore_rig' || state.phase === 'shore_unrig') {
    return { target: shore, label: state.phase === 'shore_rig' ? 'Attach sling at shore site' : 'Remove sling at shore site' };
  }
  if (state.phase === 'depart') return isJapan(campaign)
    ? { target: shore, label: 'Shore handling site' }
    : { target: lake, label: 'Freshwater lake' };
  if (shouldObserveFire(state, mission)) return { target: fire, label: 'Observe fire' };
  if (state.phase === 'transit') return { target: lake, label: 'Freshwater lake' };
  if (state.phase === 'work') {
    return state.waterLitres >= WATER_CAPACITY_L * 0.9 || state.dumping
      ? { target: fire, label: 'Active fire' }
      : { target: lake, label: 'Freshwater lake' };
  }
  if (state.phase === 'return') {
    if (isJapan(campaign) && state.bucketAttached) return { target: shore, label: 'Shore sling recovery' };
    return { target: ship, label: campaign.shipName };
  }
  return { target: ship, label: campaign.shipName };
}

export type ObjectiveAction = NonNullable<ExtendedSimState['precisionAction']>;

/** The action cue is deliberately local: these are final approach ranges, not navigation ranges. */
export function getObjectiveAction(state: SimState, campaign: Campaign, mission: Mission): ObjectiveAction | null {
  if (state.phase === 'debrief' || state.phase === 'failed' || state.outcome === 'failed') return null;
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  const shoreDistance = distance2D(state.position, handlingPoint(campaign, mission));
  const deck = shipLandingPoint(campaign, mission);
  const deckNear = Math.abs(state.position.x - deck.x) <= 24 && Math.abs(state.position.z - deck.z) <= 50 &&
    state.position.y <= 9 && speed <= 10 && Math.abs(state.velocity.y) <= 4;
  const shoreNear = shoreDistance <= 35 && state.position.y <= 10 && speed <= 10 && Math.abs(state.velocity.y) <= 4;
  if (state.phase === 'deck_rig' && !state.bucketAttached && deckNear) return 'deck-rig';
  if (!isJapan(campaign) && ['return', 'land', 'deck_rig'].includes(state.phase) && state.bucketAttached && deckNear &&
    bucketReadyForDeckRecovery(state, campaign, mission) && distance2D(state.position, deck) <= 5 && speed <= 2.5) return 'deck-recover';
  if (isJapan(campaign) && ['depart', 'shore_rig'].includes(state.phase) && !state.bucketAttached && shoreNear) return 'attach';
  if (isJapan(campaign) && ['return', 'shore_unrig'].includes(state.phase) && state.bucketAttached && shoreNear) return 'unrig';
  if (!state.bucketAttached || (state as ExtendedSimState).dumping || shouldObserveFire(state, mission)) return null;
  const lakeDistance = distance2D(state.position, mission.lake);
  const fireDistance = distance2D(state.position, mission.fire);
  if (state.waterLitres > 1 && ['transit', 'work'].includes(state.phase) &&
    fireDistance <= Math.min(70, mission.fire.radius * 0.65) &&
    state.position.y >= 32 && state.position.y <= 85 && speed <= 12) return 'release';
  if (state.waterLitres < WATER_CAPACITY_L * 0.99 &&
    ['depart', 'transit', 'work'].includes(state.phase) && speed <= 12) {
    // A bucket already at the water is the strongest indication that the
    // aircraft is in position. It may be low or offset while the sling hangs
    // into the lake, so retain the usual aircraft envelope only for approach.
    if (isBucketTouchingLake(state.bucket, mission)) return 'fetch';
    if (lakeDistance <= Math.min(55, mission.lake.radius * 0.75) &&
      state.position.y >= 15 && state.position.y <= 36) return 'fetch';
  }
  return null;
}

function precisionTarget(action: ObjectiveAction, campaign: Campaign, mission: Mission): Vec3 {
  if (action === 'attach' || action === 'unrig') {
    const site = handlingPoint(campaign, mission);
    return { ...site, y: Math.max(0, terrainHeight(campaign, mission, site.x, site.z) ?? 0) + TYRE_CLEARANCE_M };
  }
  if (action === 'deck-rig' || action === 'deck-recover') return shipLandingPoint(campaign, mission);
  if (action === 'fetch') return { x: mission.lake.x,
    y: SLING_LENGTH_M + BUCKET_FLOAT_RIM_M + BUCKET_LIFT_OFFSET_M + BUCKET_HOOK_OFFSET_M,
    z: mission.lake.z };
  return { x: mission.fire.x, y: 55, z: mission.fire.z };
}

function readyForRelease(state: ExtendedSimState, mission: Mission): boolean {
  return state.bucketAttached && state.waterLitres > 1 && !state.dumping &&
    distance2D(state.position, mission.fire) <= Math.min(36, mission.fire.radius * 0.35) &&
    state.position.y >= 38 && state.position.y <= 70 &&
    Math.hypot(state.velocity.x, state.velocity.z) <= 3.5 && Math.abs(state.velocity.y) <= 1.5;
}

function withLocalGuidance(
  state: ExtendedSimState,
  command: FlightCommand,
  campaign: Campaign,
  mission: Mission,
): FlightCommand {
  const manual = Math.abs(command.yaw) + Math.abs(command.climb) +
    Math.abs(command.cyclicX) + Math.abs(command.cyclicY) > 0.08;
  if (manual) {
    state.faceObjectiveActive = false;
    state.precisionAction = null;
    state.fetching = false;
    return command;
  }

  const available = getObjectiveAction(state, campaign, mission);
  if (command.action && available && ['attach', 'unrig', 'deck-rig', 'deck-recover'].includes(available)) {
    state.precisionAction = available;
  }
  if (command.fetch && available === 'fetch') {
    state.precisionAction = 'fetch';
    state.fetching = true;
  }
  if (command.drop && available === 'release') state.precisionAction = 'release';
  if (command.faceObjective) state.faceObjectiveActive = true;

  if (state.precisionAction) {
    const action = state.precisionAction;
    if (action === 'deck-recover' && (available !== 'deck-recover' || !bucketReadyForDeckRecovery(state, campaign, mission))) {
      state.precisionAction = null;
      return { ...command, action: false };
    }
    // Once the bucket reaches the lake, let it settle and fill in place. The
    // normal fetch target is for the approach; holding the aircraft at that
    // target after contact could lift a slack sling back out of the water.
    if (action === 'fetch' && isBucketTouchingLake(state.bucket, mission)) {
      return { ...command, action: false, drop: false };
    }
    const target = precisionTarget(action, campaign, mission);
    const dx = target.x - state.position.x;
    const dz = target.z - state.position.z;
    const distance = Math.hypot(dx, dz);
    // Never let a saved or stale precision action become a route autopilot.
    if (distance > (action === 'fetch' || action === 'release' ? 75 : 65)) {
      state.precisionAction = null;
      state.fetching = false;
      return command;
    }
    const maxSpeed = action === 'fetch' || action === 'release' ? 5 : 4;
    const desiredVx = distance > 0.001 ? dx / distance * Math.min(maxSpeed, distance * 0.55) : 0;
    const desiredVz = distance > 0.001 ? dz / distance * Math.min(maxSpeed, distance * 0.55) : 0;
    const accelX = clamp((desiredVx - state.velocity.x) * 1.7, -7, 7);
    const accelZ = clamp((desiredVz - state.velocity.z) * 1.7, -7, 7);
    const forwardX = -Math.sin(state.heading);
    const forwardZ = -Math.cos(state.heading);
    const rightX = Math.cos(state.heading);
    const rightZ = -Math.sin(state.heading);
    const vertical = clamp((target.y - state.position.y) * 0.32 - state.velocity.y * 0.65, -1, 1);
    return {
      ...command,
      yaw: 0,
      cyclicX: clamp((accelX * rightX + accelZ * rightZ) / 7, -1, 1),
      cyclicY: clamp((accelX * forwardX + accelZ * forwardZ) / 7, -1, 1),
      climb: vertical,
      action: action !== 'fetch' && action !== 'release' &&
        (action === 'attach' || action === 'unrig' ? shoreContact(state, campaign, mission) : shipContact(state, campaign, mission)),
      drop: action === 'release' && readyForRelease(state, mission),
    };
  }

  if (state.faceObjectiveActive) {
    const target = navigationTarget(state, campaign, mission).target;
    const desiredHeading = Math.atan2(state.position.x - target.x, state.position.z - target.z);
    const error = Math.atan2(Math.sin(desiredHeading - state.heading), Math.cos(desiredHeading - state.heading));
    if (Math.abs(error) < 0.008) state.faceObjectiveActive = false;
    return { ...command, yaw: state.faceObjectiveActive ? clamp(error * 2, -1, 1) : 0 };
  }
  return { ...command, action: false, drop: false };
}

function updateGuidance(state: ExtendedSimState, campaign: Campaign, mission: Mission): void {
  const route = navigationTarget(state, campaign, mission);
  state.guidance = {
    target: route.target,
    label: route.label,
    distanceM: distance2D(state.position, route.target),
  };
}

function updateWaterAndFire(state: ExtendedSimState, campaign: Campaign, mission: Mission, dt: number): void {
  for (let index = state.waterPackets.length - 1; index >= 0; index -= 1) {
    const packet = state.waterPackets[index];
    packet.velocity.x += (mission.wind.x - packet.velocity.x) * 0.22 * dt;
    packet.velocity.z += (mission.wind.z - packet.velocity.z) * 0.22 * dt;
    packet.velocity.y -= 9.81 * dt;
    packet.position.x += packet.velocity.x * dt;
    packet.position.y += packet.velocity.y * dt;
    packet.position.z += packet.velocity.z * dt;
    if (packet.position.y > bucketSurfaceHeight(campaign, mission, packet.position.x, packet.position.z)) continue;

    const distance = distance2D(packet.position, mission.fire);
    const radius = Math.max(1, mission.fire.radius);
    const accuracy = clamp(1 - distance / radius, 0, 1);
    const usefulShare = distance <= radius ? 0.2 + accuracy * 0.8 : 0;
    const useful = packet.litres * usefulShare;
    const wasted = packet.litres - useful;
    state.usefulLitres += useful;
    state.wastedLitres += wasted;
    state.airborneLitres = Math.max(0, state.airborneLitres - packet.litres);
    state.waterPackets.splice(index, 1);

    const fireCooling = 100 / (Math.max(1, mission.requiredDrops) * WATER_CAPACITY_L * 0.62);
    state.fireHeat = clamp(state.fireHeat - useful * fireCooling, 0, 100);
    if (mission.peat) {
      state.peatHeat = clamp(state.peatHeat - useful * 0.0042, 0, 100);
    }
  }

  // Once suppression allows crews to finish, do not rekindle across that
  // threshold before their first work tick. Guidance uses these same limits.
  if ((state.fireState === 'burning' || state.fireState === 'surface_suppressed') &&
    state.fireHeat > (mission.peat ? 30 : 8)) {
    const rekindle = state.fireHeat < 8 ? 0.025 : 0.12;
    state.fireHeat = clamp(state.fireHeat + rekindle * (0.85 + rand(state) * 0.3) * dt, 0, 100);
  }

  if (state.fireHeat <= 28 && state.crewProgress === 0) {
    state.fireState = 'surface_suppressed';
  }
  if (state.fireHeat <= 30 && state.crewProgress > 0 && state.fireState !== 'secured') {
    state.fireState = 'being_secured';
  }
  if (state.fireHeat <= 30) {
    state.crewProgress = Math.min(16, state.crewProgress + dt);
    if (mission.peat && state.crewProgress >= 16) {
      state.peatHeat = Math.max(0, state.peatHeat - 1.8 * dt);
    }
    const heatSecured = mission.peat ? state.peatHeat <= 4 : state.fireHeat <= 8;
    if (state.crewProgress >= 16 && heatSecured) {
      state.fireState = 'secured';
      state.objectiveSaved = true;
    }
  }

  if (state.fireHeat >= 99 && state.timeSec > mission.durationTargetSec * 1.2) {
    state.fireState = 'burnt_out';
    state.objectiveSaved = false;
  }
}

function crash(state: ExtendedSimState, cause: string, contactHeight?: number): true {
  if (contactHeight !== undefined) state.position.y = Math.max(state.position.y, contactHeight);
  state.velocity = { x: 0, y: 0, z: 0 };
  state.damage = MAX_DAMAGE;
  state.phase = 'failed';
  state.outcome = 'failed';
  state.failureCause = 'collision';
  setMessage(state, `${cause} — aircraft lost. Mission failed.`, 3600);
  return true;
}

/** Aircraft origin is above the tyres, so contact is checked at wheel and hull points. */
function groundContactHeight(state: SimState, campaign: Campaign, mission: Mission): number {
  const heading = state.heading;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const samples: [number, number, number][] = [
    [0, 0, -TYRE_CLEARANCE_M],
    [-1.56, -4.1, -2.52], [1.56, -4.1, -2.52],
    [-1.56, 5.8, -2.52], [1.56, 5.8, -2.52],
    [0, -7.7, -1.45], [0, 8.2, -1.2],
    [-9.15, -5.7, 2.73], [9.15, -5.7, 2.73],
    [-9.15, 6.15, 3.18], [9.15, 6.15, 3.18],
  ];
  let floor = -Infinity;
  for (const [localX, localZ, localY] of samples) {
    const x = state.position.x + localX * cos + localZ * sin;
    const z = state.position.z - localX * sin + localZ * cos;
    let surface = renderedTerrainHeight(campaign, mission, x, z) ?? -9;
    if (distance2D({ x, z }, mission.lake) <= mission.lake.radius * 1.01) surface = Math.max(surface, .025);
    if (mission.shore && distance2D({ x, z }, mission.shore) <= 30) surface = Math.max(surface, 0);
    // Renderer uses Euler order YXZ: bank around local Z, then -pitch around X.
    const offsetY = (localX * Math.sin(state.bank) + localY * Math.cos(state.bank)) * Math.cos(state.pitch) +
      localZ * Math.sin(state.pitch);
    floor = Math.max(floor, surface - offsetY + .02);
  }
  return floor;
}

function rotorHitsBox(
  state: SimState,
  box: { x: number; z: number; halfWidth: number; halfLength: number; bottom: number; top: number },
): boolean {
  const verticalSweep = 9.15 * Math.hypot(Math.sin(state.bank), Math.sin(state.pitch));
  for (const [rotorZ, rotorY] of [[-5.7, 2.73], [6.15, 3.18]]) {
    const x = state.position.x + Math.sin(state.heading) * rotorZ;
    const z = state.position.z + Math.cos(state.heading) * rotorZ;
    const dx = Math.max(0, Math.abs(x - box.x) - box.halfWidth);
    const dz = Math.max(0, Math.abs(z - box.z) - box.halfLength);
    const y = state.position.y + rotorY * Math.cos(state.bank) * Math.cos(state.pitch) + rotorZ * Math.sin(state.pitch);
    if (Math.hypot(dx, dz) <= 9.15 && y + verticalSweep >= box.bottom && y - verticalSweep <= box.top) return true;
  }
  return false;
}

function shipCollision(state: ExtendedSimState, campaign: Campaign, mission: Mission): string | null {
  const x = state.position.x - mission.ship.x;
  const z = state.position.z - mission.ship.z;
  const japanese = isJapan(campaign);
  const stern = japanese ? 40 : 35;
  const length = campaign.shipLength;
  const beam = campaign.shipWidth;
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  const safeDeck = (japanese || !state.bucketAttached || bucketReadyForDeckRecovery(state, campaign, mission)) && Math.abs(x) <= Math.max(7, beam / 2 - 1.4) &&
    Math.abs(z - shipLandingLocalZ(campaign)) <= clamp(length * .22, 18, 42) &&
    speed <= 3.5 && Math.abs(state.velocity.y) <= 3;

  // Match the separate bridge, boat-bay, funnel and mast envelopes in ships.ts.
  // Keeping the tiers separate avoids a tall invisible wall over the low island.
  const station = (fraction: number) => stern - length + fraction * length;
  const structures = japanese
    ? [{ x: beam * .27, z: station(.47), hw: beam * .39 / 2, hl: length * .245 / 2, top: 3.65 },
      { x: beam * .27, z: station(.392), hw: beam * .20, hl: 8, top: 7.415 },
      { x: beam * .27, z: station(.48), hw: 3.4, hl: 7, top: 6.45 },
      { x: beam * .27, z: station(.52), hw: 2.25, hl: 3.25, top: 11.35 },
      { x: beam * .27 - 1, z: station(.445), hw: 3.5, hl: 1.5, top: 24.15 },
      { x: beam * .27, z: station(.325), hw: 2.5, hl: 3, top: 2 },
      { x: beam * .27, z: station(.59), hw: 1.4, hl: 2.2, top: 6.45 },
      { x: beam * .27, z: station(.545), hw: 3.7, hl: 4, top: 10 }]
    : [{ x: 0, z: station(.375), hw: beam * .63 / 2, hl: 16.5, top: 5.05 },
      { x: 0, z: station(.292), hw: beam * .44, hl: 8.5, top: 9.625 },
      { x: 0, z: -40.5, hw: beam * .61 / 2, hl: 6, top: 3.75 },
      { x: 0, z: station(.332), hw: 2.4, hl: 2.5, top: 14.9 },
      { x: 0, z: station(.395), hw: 3.5, hl: 1.5, top: 27.45 },
      ...[-1, 1].flatMap(side => [
        { x: side * beam * .42, z: station(.40), hw: 1.7, hl: 12.5, top: 6.85 },
        { x: side * beam * .42, z: station(.485), hw: 1.5, hl: 2.8, top: 9.425 },
      ])];
  for (const volume of structures) {
    const bodyHit = Math.abs(x - volume.x) <= volume.hw + 2.7 && Math.abs(z - volume.z) <= volume.hl + 8.2 &&
      state.position.y - 1.5 <= volume.top && state.position.y + 3.2 >= -2.55;
    const rotorHit = rotorHitsBox(state, {
      x: mission.ship.x + volume.x, z: mission.ship.z + volume.z,
      halfWidth: volume.hw, halfLength: volume.hl, bottom: -2.55, top: volume.top,
    });
    if (bodyHit || rotorHit) return `${campaign.shipName} superstructure strike`;
  }
  // Hull/deck: do not confuse deliberate, slow contact with an impact.
  if (!japanese) {
    // Persistence's raised forecastle is no longer at flight-deck height.
    // Check gear/body contact along the actual sloped bow before it can clip.
    let forecastleFloor = -Infinity;
    const stations = [[0, .1], [.045, .55], [.12, .87], [.22, .98], [.34, 1]];
    for (const [localX, localZ, localY] of [
      [-1.56, -4.1, -2.52], [1.56, -4.1, -2.52],
      [-1.56, 5.8, -2.52], [1.56, 5.8, -2.52],
      [0, -7.7, -1.45], [0, 8.2, -1.2],
    ]) {
      const sampleX = x + localX * Math.cos(state.heading) + localZ * Math.sin(state.heading);
      const sampleZ = z - localX * Math.sin(state.heading) + localZ * Math.cos(state.heading);
      const fraction = (sampleZ - (stern - length)) / length;
      if (fraction < 0 || fraction >= .29) continue;
      const end = stations.findIndex(([f]) => f > fraction);
      const [f0, w0] = stations[end - 1], [f1, w1] = stations[end];
      const width = (w0 + (w1 - w0) * (fraction - f0) / (f1 - f0)) * beam / 2;
      const surfaceY = -2.525 + (1 - fraction / .29) * 3.2;
      const offsetY = (localX * Math.sin(state.bank) + localY * Math.cos(state.bank)) * Math.cos(state.pitch) +
        localZ * Math.sin(state.pitch);
      if (Math.abs(sampleX) <= width) forecastleFloor = Math.max(forecastleFloor, surfaceY - offsetY);
    }
    if (state.position.y <= forecastleFloor) {
      state.position.y = forecastleFloor;
      return `${campaign.shipName} forecastle impact`;
    }
  }
  const nearHull = Math.abs(x) <= beam / 2 + 3.2 && z >= stern - length - 8 && z <= stern + 8;
  const deckStrike = state.position.y <= .05;
  // Outboard tyres and sponsons can touch the safety rail before the aircraft
  // origin reaches deck height. The central marked landing lane remains open.
  const railStrike = Math.abs(x) > Math.max(7, beam / 2 - 1.4) && state.position.y <= 1.2;
  if (nearHull && (deckStrike || railStrike)) {
    if (safeDeck) {
      if (state.position.y < 0) state.position.y = 0;
      if (state.velocity.y <= 0) {
        state.position.y = 0;
        state.velocity.y = 0;
        if (speed <= 2.5) { state.velocity.x = 0; state.velocity.z = 0; }
      }
      return null;
    }
    return `${campaign.shipName} impact`;
  }
  return null;
}

function checkCollision(state: ExtendedSimState, campaign: Campaign, mission: Mission): boolean {
  const shipImpact = shipCollision(state, campaign, mission);
  if (shipImpact) return crash(state, shipImpact, 0);

  const groundFloor = groundContactHeight(state, campaign, mission);
  if (state.position.y < groundFloor - .005) {
    const site = mission.shore;
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    const gentleContact = speed <= 3.5 && Math.abs(state.velocity.y) <= 3;
    const departingScrape = state.velocity.y > 0 && groundFloor - state.position.y < .15;
    const safeShore = isJapan(campaign) && site && distance2D(state.position, site) <= 17 &&
      (gentleContact || departingScrape);
    if (safeShore) {
      state.position.y = groundFloor;
      if (state.velocity.y <= 0) {
        state.velocity.y = 0;
        if (speed <= 2.5) { state.velocity.x = 0; state.velocity.z = 0; }
      }
    } else {
      const onLake = distance2D(state.position, mission.lake) <= mission.lake.radius;
      return crash(state, onLake ? 'Water impact' : groundFloor < -4 ? 'Sea impact' : 'Terrain impact', groundFloor);
    }
  }

  // The rotor discs are much wider than the fuselage, so a crown can be struck
  // even while the visible cabin is clear. Both mast positions are sampled.
  for (const tree of nearbyTrees(mission, state.position.x, state.position.z)) {
    const crownRadius = tree.radius * 1.16;
    const crownBottom = tree.ground + tree.height * .96 - tree.radius * 1.1;
    const crownTop = tree.ground + tree.height * .96 + tree.radius * 1.35;
    const fuselageNear = distance2D(state.position, tree) <= crownRadius + 2.6;
    if (fuselageNear && state.position.y + 1.6 >= crownBottom && state.position.y - 1.5 <= crownTop) {
      return crash(state, 'Tree strike');
    }
    if (distance2D(state.position, tree) <= 3.2 && state.position.y - 1.5 <= tree.ground + tree.height && state.position.y + 2 >= tree.ground) {
      return crash(state, 'Tree strike');
    }
    for (const rotorZ of [-5.7, 6.15]) {
      const rx = state.position.x + Math.sin(state.heading) * rotorZ;
      const rz = state.position.z + Math.cos(state.heading) * rotorZ;
      if (Math.hypot(rx - tree.x, rz - tree.z) <= crownRadius + 9.15 &&
        state.position.y + (rotorZ < 0 ? 2.73 : 3.18) >= crownBottom &&
        state.position.y + (rotorZ < 0 ? 2.73 : 3.18) <= crownTop) return crash(state, 'Rotor struck a tree');
    }
  }

  for (const structure of structureColliders(mission)) {
    const bodyHit = Math.abs(state.position.x - structure.x) <= structure.halfWidth + 2.6 &&
      Math.abs(state.position.z - structure.z) <= structure.halfLength + 8.2 &&
      state.position.y - 1.5 <= structure.top && state.position.y + 3.2 >= structure.bottom;
    if (bodyHit || rotorHitsBox(state, structure)) {
      return crash(state, `${structure.label} impact`);
    }
  }
  return false;
}

function updateFillAndDump(state: ExtendedSimState, command: FlightCommand, mission: Mission, dt: number): void {
  const risingDrop = command.drop && !state.dropHeld;
  state.dropHeld = command.drop;
  if (risingDrop && readyForRelease(state, mission)) {
    state.dumping = true;
    state.precisionAction = null;
    state.dropId += 1;
    state.dumpStartedWithLitres = state.waterLitres;
    state.dropPacketTime = 0;
    state.dropPacketLitres = 0;
    setMessage(state, 'Water released. Observe the impact and assess the fire.', 3.5);
  }

  if (state.dumping) {
    const released = Math.min(state.waterLitres, DUMP_RATE_L_PER_SEC * dt);
    state.waterLitres -= released;
    state.releasedLitres += released;
    state.airborneLitres += released;
    state.dropPacketTime += dt;
    state.dropPacketLitres += released;
    if (state.dropPacketTime >= WATER_PACKET_INTERVAL_SEC || state.waterLitres <= EPSILON) {
      if (state.dropPacketLitres > EPSILON) {
        state.waterPackets.push({
          litres: state.dropPacketLitres,
          position: state.bucketAttached
            ? { ...state.bucket, y: state.bucket.y - BUCKET_BODY_HEIGHT_M }
            : copyVec(state.position),
          velocity: copyVec(state.bucketAttached ? state.bucketVelocity : state.velocity),
          dropId: state.dropId,
        });
      }
      state.dropPacketTime = 0;
      state.dropPacketLitres = 0;
    }
    if (state.waterLitres <= EPSILON) {
      state.waterLitres = 0;
      state.dumping = false;
      state.dropsCompleted += 1;
      setMessage(state, 'Dump complete. Water impacts are cooling the fire.');
    }
  }

  if (!state.dumping && state.fetching && state.bucketAttached) {
    const immersed = isBucketTouchingLake(state.bucket, mission);
    const speed = Math.hypot(state.bucketVelocity.x, state.bucketVelocity.z);
    if (immersed && speed <= 2) {
      // Capacity is further clamped by the hard gross-mass ceiling below in stepSim.
      state.waterLitres = Math.min(WATER_CAPACITY_L, state.waterLitres + FILL_RATE_L_PER_SEC * dt);
    }
    if (state.waterLitres >= WATER_CAPACITY_L - EPSILON) {
      state.fetching = false;
      state.precisionAction = null;
      setMessage(state, 'Bucket full. Fly to the fire and release the load.');
    }
  }
}

/**
 * One deterministic SI-unit physics/update step. The main game clock supplies
 * fixed 60 Hz calls; `dt` remains injectable for headless invariant tests.
 */
export function stepSim(
  input: SimState,
  command: FlightCommand,
  campaign: Campaign,
  mission: Mission,
  dt = STEP,
): SimState {
  const state = input as ExtendedSimState;
  state.dumping ??= false;
  state.dropHeld ??= false;
  state.dropId ??= 0;
  state.dumpStartedWithLitres ??= 0;
  state.dropPacketTime ??= 0;
  state.dropPacketLitres ??= 0;
  if (!Array.isArray(state.waterPackets)) state.waterPackets = [];
  state.faceObjectiveActive ??= false;
  state.precisionAction ??= null;
  state.fetching ??= false;
  state.failureCause ??= null;
  if (!state.guidance) {
    const route = navigationTarget(state, campaign, mission);
    state.guidance = { ...route, distanceM: distance2D(state.position, route.target) };
  }
  const step = clamp(safe(dt, STEP), 0, 0.1);
  if (step <= 0 || state.outcome === 'failed' || state.phase === 'debrief' || state.phase === 'failed') return state;

  state.tick += 1;
  state.timeSec += step;
  const priorPosition = copyVec(state.position);
  const flightCommand = withLocalGuidance(state, command, campaign, mission);
  const previousHook = getBucketHook(state);
  updateAttitudeAndFlight(state, flightCommand, campaign, mission, step);
  if (checkCollision(state, campaign, mission)) return state;
  const currentHook = getBucketHook(state);
  const hookVelocity = {
    x: (currentHook.x - previousHook.x) / step,
    y: (currentHook.y - previousHook.y) / step,
    z: (currentHook.z - previousHook.z) / step,
  };
  updateBucket(state, campaign, mission, hookVelocity, step, priorPosition);

  // Continuous fuel use also covers the engine-running deck/shore handling time.
  state.fuelKg = Math.max(0, state.fuelKg - effectiveBurnKgPerMin(state) * step / 60);
  if (state.fuelKg <= EPSILON && state.position.y > 2) {
    state.damage = clamp(state.damage + 10 * step, 0, MAX_DAMAGE);
    setMessage(state, 'Fuel exhausted. Land immediately.', 2);
    if (state.damage >= MAX_DAMAGE) {
      state.phase = 'failed';
      state.outcome = 'failed';
      return state;
    }
  }

  // Hard gross-mass limit is evaluated while emerged, so immersion cannot mask
  // an unsafe lift. An assisted pickup pauses at the configured limit.
  const remainingPayloadKg = Math.max(0, campaign.mass.maxGross - grossMass(state, campaign));
  const preFill = state.waterLitres;
  updateFillAndDump(state, flightCommand, mission, step);
  if (state.waterLitres > preFill && state.bucketAttached) {
    state.waterLitres = Math.min(state.waterLitres, preFill + remainingPayloadKg);
  }
  if (state.fetching && state.bucketAttached && campaign.mass.maxGross - grossMass(state, campaign) <= EPSILON) {
    state.fetching = false;
    state.precisionAction = null;
    setMessage(state, 'Maximum safe load reached. Fly to the fire.');
  }

  updateWaterAndFire(state, campaign, mission, step);
  if (state.fireState === 'burning' && state.fireHeat <= 28) state.fireState = 'surface_suppressed';
  updateRigging(state, flightCommand, campaign, mission, step);
  updatePhase(state, flightCommand, campaign, mission, step);
  if ((state.precisionAction === 'attach' && state.bucketAttached) ||
    (state.precisionAction === 'unrig' && !state.bucketAttached) ||
    (state.precisionAction === 'deck-rig' && state.bucketAttached) ||
    (state.precisionAction === 'deck-recover' && !state.bucketAttached)) state.precisionAction = null;

  updateGuidance(state, campaign, mission);

  const bounds = worldBounds(mission);
  const leftBounds = priorPosition.x < bounds.minX || priorPosition.x > bounds.maxX || priorPosition.z < bounds.minZ || priorPosition.z > bounds.maxZ;
  if (leftBounds) {
    state.damage = clamp(state.damage + 3 * step, 0, MAX_DAMAGE);
  }
  if (state.damage >= MAX_DAMAGE) {
    state.phase = 'failed';
    state.outcome = 'failed';
    setMessage(state, 'Aircraft damaged beyond recovery.');
  }
  if (state.messageUntil > 0 && state.timeSec >= state.messageUntil) state.message = '';
  return state;
}
