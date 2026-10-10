import type { Mission } from '../types';

export type LinearRgb = readonly [number, number, number];

export type TimeOfDayEvaluation = {
  /** Unit world-space direction from the scene toward the sun. */
  sunDirection: readonly [number, number, number];
  /** Linear RGB values in the 0..1 range, ready for Three.js Color.setRGB. */
  skyZenith: LinearRgb;
  skyHorizon: LinearRgb;
  fogColor: LinearRgb;
  sunColor: LinearRgb;
  sunIntensity: number;
  ambientColor: LinearRgb;
  ambientIntensity: number;
  /** 1 is full night; 0 is full daytime. */
  nightStrength: number;
};

const MAX_SUN_ELEVATION = 68 * Math.PI / 180;
const NIGHT_ZENITH: LinearRgb = [0.012, 0.022, 0.065];
const DAY_ZENITH: LinearRgb = [0.27, 0.48, 0.64];
const TWILIGHT_ZENITH: LinearRgb = [0.22, 0.15, 0.23];
const NIGHT_HORIZON: LinearRgb = [0.035, 0.05, 0.09];
const DAY_HORIZON: LinearRgb = [0.61, 0.70, 0.67];
const TWILIGHT_HORIZON: LinearRgb = [0.88, 0.31, 0.15];
const NIGHT_FOG: LinearRgb = [0.018, 0.027, 0.052];
const DAY_FOG: LinearRgb = [0.43, 0.48, 0.43];
const TWILIGHT_FOG: LinearRgb = [0.45, 0.24, 0.16];
const NIGHT_SUN: LinearRgb = [0.23, 0.31, 0.52];
const DAY_SUN: LinearRgb = [1, 0.91, 0.73];
const TWILIGHT_SUN: LinearRgb = [1, 0.47, 0.22];
const NIGHT_AMBIENT: LinearRgb = [0.28, 0.36, 0.50];
const DAY_AMBIENT: LinearRgb = [0.77, 0.84, 0.88];

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a: LinearRgb, b: LinearRgb, amount: number): LinearRgb {
  const t = Math.max(0, Math.min(1, amount));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function warm(base: LinearRgb, twilight: LinearRgb, amount: number): LinearRgb {
  return mix(base, twilight, Math.max(0, Math.min(0.82, amount)));
}

/**
 * Evaluate the authored sky and lighting at mission simulation time.
 * Mission time maps linearly from startMinutes to endMinutes over the target
 * sortie duration, then holds at the end; endMinutes may exceed 1440 to cross
 * midnight. The shared solar arc rises at 06:00, peaks at 12:00 and sets at
 * 18:00. All returned colours are normalized linear RGB values.
 */
export function evaluateTimeOfDay(mission: Mission, timeSec: number): TimeOfDayEvaluation {
  const duration = Number.isFinite(mission.durationTargetSec) && mission.durationTargetSec > 0
    ? mission.durationTargetSec
    : 300;
  const elapsedFraction = Math.max(0, Math.min(1, (Number.isFinite(timeSec) ? timeSec : 0) / duration));
  const dayMinutes = mission.timeOfDay.startMinutes +
    (mission.timeOfDay.endMinutes - mission.timeOfDay.startMinutes) * elapsedFraction;

  // The hour angle gives an east-to-west arc. Solar elevation follows a
  // tropical latitude curve with a high, but not vertical, midday sun.
  const hourAngle = (dayMinutes - 720) * Math.PI / 720;
  const azimuth = (dayMinutes - 360) * Math.PI / 720;
  const sineElevation = Math.cos(hourAngle) * Math.sin(MAX_SUN_ELEVATION);
  const sunY = sineElevation;
  const horizontal = Math.sqrt(Math.max(0, 1 - sunY * sunY));
  const sunDirection: readonly [number, number, number] = [
    Math.cos(azimuth) * horizontal,
    sunY,
    Math.sin(azimuth) * horizontal,
  ];

  // Let authored dawn/dusk colours and ambient fill blend in before direct
  // sunlight reaches or leaves the horizon.
  const daylight = smoothstep(-0.28, 0.18, sunY);
  const sunAboveHorizon = smoothstep(0, 0.16, sunY);
  const nightStrength = 1 - daylight;
  const twilight = Math.exp(-Math.pow(sunY / 0.19, 2)) * daylight * (1 - smoothstep(0.12, 0.35, sunY));
  const skyZenith = warm(mix(NIGHT_ZENITH, DAY_ZENITH, daylight), TWILIGHT_ZENITH, twilight * 0.48);
  const skyHorizon = warm(mix(NIGHT_HORIZON, DAY_HORIZON, daylight), TWILIGHT_HORIZON, twilight * 0.78);
  const fogColor = warm(mix(NIGHT_FOG, DAY_FOG, daylight), TWILIGHT_FOG, twilight * 0.42);
  const sunColor = warm(mix(NIGHT_SUN, DAY_SUN, daylight), TWILIGHT_SUN, twilight * 0.76);
  const ambientColor = mix(NIGHT_AMBIENT, DAY_AMBIENT, daylight);

  return {
    sunDirection,
    skyZenith,
    skyHorizon,
    fogColor,
    sunColor,
    sunIntensity: 3.5 * sunAboveHorizon,
    ambientColor,
    ambientIntensity: 0.82 + 1.48 * daylight,
    nightStrength,
  };
}
