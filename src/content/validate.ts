import type { Campaign, CampaignId, Mission } from '../types';

const REQUIRED_CAMPAIGNS: CampaignId[] = ['sg_fictional_2026_10', 'jp_ketapang_2026_09'];
const EARTHLY_SOURCE_CUTOFF = '2026-10-09';
const REQUIRED_TIME_WINDOWS = [[330, 480], [480, 720], [720, 1050], [1050, 1110], [1110, 1200], [1200, 1770]] as const;

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isFinitePoint(point: { x: number; z: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

function isDateInside(date: string, start: string, end: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= end;
}

function expectedMissionId(prefix: 'SG' | 'JP', index: number): string {
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}

function validateMission(campaign: Campaign, mission: Mission, index: number, issues: string[]): void {
  const prefix = campaign.id === 'sg_fictional_2026_10' ? 'SG' : 'JP';
  const path = `${campaign.id}/${mission.id}`;
  if (mission.id !== expectedMissionId(prefix, index)) issues.push(`${path}: mission ID/order must be ${expectedMissionId(prefix, index)}.`);
  if (!mission.title.trim() || !mission.description.trim() || !mission.lesson.trim() || !mission.protectedLabel.trim()) {
    issues.push(`${path}: title, briefing, lesson and protected objective are required.`);
  }
  if (!Number.isInteger(mission.seed) || mission.seed < 1) issues.push(`${path}: seed must be a positive integer.`);
  if (!isFinitePoint(mission.ship) || Math.hypot(mission.ship.x, mission.ship.z) > 30) {
    issues.push(`${path}: ship must stay within 30 m of the fixed offshore campaign anchorage.`);
  }
  if (!Number.isFinite(mission.shipHeading) || Math.abs(mission.shipHeading) > .12) {
    issues.push(`${path}: ship heading must be within 0.12 radians of the campaign alignment.`);
  }
  if (!isFinitePoint(mission.lake) || !Number.isFinite(mission.lake.radius) || mission.lake.radius <= 0) {
    issues.push(`${path}: lake point and positive radius are required.`);
  }
  if (!isFinitePoint(mission.fire) || !Number.isFinite(mission.fire.radius) || mission.fire.radius <= 0) {
    issues.push(`${path}: fire point and positive radius are required.`);
  }
  if (!Number.isFinite(mission.wind.x) || !Number.isFinite(mission.wind.z) || Math.hypot(mission.wind.x, mission.wind.z) > 8) {
    issues.push(`${path}: wind must be finite and within the authored 8 m/s tuning envelope.`);
  }
  if (mission.durationTargetSec < 180 || mission.durationTargetSec > 600) {
    issues.push(`${path}: target duration must fit the compact playable sortie window (180–600 seconds).`);
  }
  if (!Number.isFinite(mission.timeOfDay?.startMinutes) || !Number.isFinite(mission.timeOfDay?.endMinutes) ||
      mission.timeOfDay.startMinutes < 0 || mission.timeOfDay.startMinutes >= 1440 ||
      mission.timeOfDay.endMinutes <= mission.timeOfDay.startMinutes || mission.timeOfDay.endMinutes > 2880) {
    issues.push(`${path}: time of day must be an ascending minute interval starting within a day and ending within two days.`);
  }
  const expectedTimeWindow = REQUIRED_TIME_WINDOWS[index];
  if (expectedTimeWindow && (mission.timeOfDay?.startMinutes !== expectedTimeWindow[0] || mission.timeOfDay?.endMinutes !== expectedTimeWindow[1])) {
    issues.push(`${path}: time of day must match mission ${index + 1}'s authored campaign interval.`);
  }
  if (!isDateInside(mission.date, '2026-09-23', EARTHLY_SOURCE_CUTOFF)) {
    issues.push(`${path}: mission date falls outside the dated scenario window.`);
  }

  if (index === 0 && mission.requiredDrops !== 1) issues.push(`${path}: the guided practice mission must require one drop.`);
  if (index > 0 && (!Number.isInteger(mission.requiredDrops) || mission.requiredDrops < 2 || mission.requiredDrops > 3)) {
    issues.push(`${path}: operational missions must require two or three drops.`);
  }

  if (campaign.id === 'sg_fictional_2026_10') {
    if (mission.date !== '2026-10-09') issues.push(`${path}: Singapore scenarios are dated 9 October 2026.`);
    if (mission.shore) issues.push(`${path}: Singapore sorties use the ship-centred layout without a shore handling stop.`);
    const shipToLake = distance(mission.ship, mission.lake);
    if (shipToLake < 1400 || shipToLake > 1600) issues.push(`${path}: Singapore lake should be about 1.5 km from the ship in local gameplay space.`);
  } else {
    if (!mission.shore || !isFinitePoint(mission.shore)) issues.push(`${path}: Japan scenarios require a shore handling waypoint.`);
    else {
      const shipToShore = distance(mission.ship, mission.shore);
      const shoreToLake = distance(mission.shore, mission.lake);
      if (shipToShore < 350 || shipToShore > 500) issues.push(`${path}: shore point should be 350–500 m from the ship in local gameplay space.`);
      if (shoreToLake < 1000 || shoreToLake > 1100) issues.push(`${path}: lake should be 1,000–1,100 m beyond the shore point in local gameplay space.`);
    }
  }

  const fireToLake = distance(mission.fire, mission.lake);
  if (fireToLake < 100 || fireToLake > 400) issues.push(`${path}: fire target should be 100–400 m from its lake in local gameplay space.`);
}

/** Return actionable errors before scenario content is loaded by the game. */
export function validateScenarioData(campaigns: Campaign[]): string[] {
  const issues: string[] = [];
  if (campaigns.length !== REQUIRED_CAMPAIGNS.length) issues.push('There must be exactly two campaign packages.');
  if (campaigns.map((campaign) => campaign.id).join('|') !== REQUIRED_CAMPAIGNS.join('|')) {
    issues.push(`Campaign packages must appear as exactly ${REQUIRED_CAMPAIGNS.join(' and ')}.`);
  }

  for (const campaign of campaigns) {
    const isSingapore = campaign.id === 'sg_fictional_2026_10';
    const expectedEvidence = isSingapore ? 'fictional_inspired' : 'documented_operation_reconstruction';
    if (campaign.evidenceMode !== expectedEvidence) issues.push(`${campaign.id}: evidence mode does not match the campaign.`);
    if (campaign.missions.length !== 6) issues.push(`${campaign.id}: exactly six missions are required.`);
    if (!campaign.context.includes('compressed local gameplay layout in metres')) {
      issues.push(`${campaign.id}: context must state that the metre coordinates are compressed local gameplay geometry.`);
    }
    if (isSingapore && !campaign.context.includes('A fictional humanitarian mission inspired by Indonesia’s October 2026 wildfire and haze conditions.')) {
      issues.push(`${campaign.id}: required fictional-context wording is missing.`);
    }
    if (!isSingapore && !campaign.context.includes('Based on Japan’s real September 2026 firefighting deployment to Indonesia. Playable missions, exact routes, ship positions, weather and freshwater refill lakes are reconstructed for the game.')) {
      issues.push(`${campaign.id}: required Japan reconstruction wording is missing.`);
    }

    const missionIds = campaign.missions.map((mission) => mission.id);
    if (new Set(missionIds).size !== missionIds.length) issues.push(`${campaign.id}: mission IDs must be unique.`);
    const seeds = campaign.missions.map((mission) => mission.seed);
    if (new Set(seeds).size !== seeds.length) issues.push(`${campaign.id}: mission seeds must be unique.`);
    const winds = campaign.missions.map((mission) => `${mission.wind.x},${mission.wind.z}`);
    if (new Set(winds).size < 4) issues.push(`${campaign.id}: missions need distinct authored weather vectors.`);
    if (!campaign.missions.some((mission) => mission.peat) || !campaign.missions.some((mission) => !mission.peat)) {
      issues.push(`${campaign.id}: missions need both peat and surface-fire scenarios.`);
    }
    if (campaign.mass.baseline + campaign.mass.crew + campaign.mass.rig + campaign.mass.fuel + 5000 !== (isSingapore ? 20098 : 20450)) {
      issues.push(`${campaign.id}: mass allowances must reproduce the brief’s default-fuel/full-water gross mass.`);
    }
    if (campaign.mass.maxGross !== 22680 || campaign.mass.baseline <= 0 || campaign.mass.maxGross <= campaign.mass.baseline) {
      issues.push(`${campaign.id}: aircraft mass profile is outside the documented gross-mass profile.`);
    }
    if (campaign.shipLength <= 0 || campaign.shipWidth <= 0) issues.push(`${campaign.id}: ship dimensions must be positive.`);

    for (const [index, mission] of campaign.missions.entries()) validateMission(campaign, mission, index, issues);
    if (campaign.missions.length === 6) {
      const firstLake = campaign.missions[0].lake;
      if (campaign.missions.some((mission) => mission.lake.x !== firstLake.x || mission.lake.z !== firstLake.z)) {
        issues.push(`${campaign.id}: all six missions must share one readable world layout.`);
      }
      if (!isSingapore) {
        const firstShore = campaign.missions[0].shore;
        if (firstShore && campaign.missions.some((mission) => mission.shore?.x !== firstShore.x || mission.shore?.z !== firstShore.z)) {
          issues.push(`${campaign.id}: all six missions must share one shore handling point.`);
        }
      }
    }
  }

  return issues;
}
