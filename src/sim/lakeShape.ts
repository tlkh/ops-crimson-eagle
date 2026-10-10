import type { CampaignId } from '../types';

export type LakePoint = { x: number; z: number };
export type LakeBoundary = LakePoint & { radius: number };
export type LakeHarmonic = readonly [cosine: number, sine: number];
export type LakeShapeProfile = {
  /** Mean radial scale; the harmonics create campaign-specific coves and unequal lobes. */
  readonly base: number;
  /** Cosine/sine coefficients for harmonics one through four. */
  readonly harmonics: readonly [LakeHarmonic, LakeHarmonic, LakeHarmonic, LakeHarmonic];
};

const profiles: Record<CampaignId, LakeShapeProfile> = {
  sg_fictional_2026_10: {
    base: 1.1483404909,
    harmonics: [
      [0.0185425614, 0.0046356403],
      [0.0166883052, -0.0185425614],
      [0.1390692102, 0.0463564034],
      [0.0370851227, -0.0185425614],
    ],
  },
  jp_ketapang_2026_09: {
    base: 1.1590138037,
    harmonics: [
      [-0.0248459068, 0.0397534509],
      [0.0149075441, 0.0397534509],
      [-0.1341678968, 0.0894452646],
      [0.0149075441, 0.0645993577],
    ],
  },
};

export function lakeShapeProfile(campaignId: CampaignId): LakeShapeProfile {
  return profiles[campaignId];
}

/** Conservative radius bounds around the full refill disc and campaign-specific shoreline. */
export function lakeRadiusBounds(campaignId: CampaignId, refillRadius: number): { min: number; max: number } {
  let maxFactor = 1;
  const samples = 1440;
  for (let index = 0; index < samples; index++) {
    maxFactor = Math.max(maxFactor, lakeRadiusFactor(campaignId, index / samples * Math.PI * 2));
  }
  return {
    min: refillRadius,
    // A small outward allowance accounts for maxima between angular samples.
    max: refillRadius * (maxFactor + .0002),
  };
}

/** Radial scale for the shoreline angle used by the lake mesh and water shader. */
export function lakeRadiusFactor(campaignId: CampaignId, angle: number): number {
  const profile = lakeShapeProfile(campaignId);
  const factor = profile.base + profile.harmonics.reduce((sum, [cosine, sine], index) => {
    const harmonicAngle = angle * (index + 1);
    return sum + cosine * Math.cos(harmonicAngle) + sine * Math.sin(harmonicAngle);
  }, 0);
  // Keep the entire circular refill area inside the visible freshwater body.
  return Math.max(1, factor);
}

export function lakeRadiusAtAngle(campaignId: CampaignId, refillRadius: number, angle: number): number {
  return refillRadius * lakeRadiusFactor(campaignId, angle);
}

/**
 * Outline points use the same inverted Z angle as the Three.js lake surface.
 * `radiusScale` expands the shoreline for its shallow sand-coloured margin.
 */
export function lakeOutlinePoints(
  campaignId: CampaignId,
  lake: LakeBoundary,
  segments = 96,
  radiusScale = 1,
): LakePoint[] {
  if (!Number.isInteger(segments) || segments < 3) throw new RangeError('Lake outline needs at least three segments');
  if (!Number.isFinite(radiusScale) || radiusScale <= 0) throw new RangeError('Lake outline scale must be positive and finite');
  return Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * Math.PI * 2;
    const radius = lakeRadiusAtAngle(campaignId, lake.radius, angle) * radiusScale;
    return { x: lake.x + Math.cos(angle) * radius, z: lake.z - Math.sin(angle) * radius };
  });
}

/** Test a world point against the actual shoreline, optionally expanded by metres. */
export function isWithinLakeOutline(
  campaignId: CampaignId,
  lake: LakeBoundary,
  point: LakePoint,
  paddingM = 0,
): boolean {
  const dx = point.x - lake.x;
  const dz = point.z - lake.z;
  const angle = Math.atan2(-dz, dx);
  const padding = Number.isFinite(paddingM) ? Math.max(0, paddingM) : 0;
  return Math.hypot(dx, dz) <= lakeRadiusAtAngle(campaignId, lake.radius, angle) + padding + 1e-6;
}
