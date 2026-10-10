import type { Mission } from '../types';

export type BurnSample = { severity: number; age: number; activity: number };
export type BurnField = {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  size: number;
  /** Linear RGBA: damage, age (old=1), current activity, eligible land. */
  data: Uint8Array;
  sample(x: number, z: number): BurnSample;
};

const SIZE = 256;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
  const a = hash(ix, iy, seed) * (1 - fx) + hash(ix + 1, iy, seed) * fx;
  const b = hash(ix, iy + 1, seed) * (1 - fx) + hash(ix + 1, iy + 1, seed) * fx;
  return a * (1 - fy) + b * fy;
}

/** Paved/support footprints from world.ts, not its much broader tree clearance. */
export function isBurnProtectedAirport(mission: Mission, x: number, z: number): boolean {
  if (!mission.shore) return false;
  const dx = mission.shore.x - mission.ship.x, dz = mission.shore.z - mission.ship.z;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  const px = x - mission.shore.x, pz = z - mission.shore.z;
  // Inverse of the support apron group's atan2(ux, uz) rotation.
  const localX = px * uz - pz * ux, localZ = px * ux + pz * uz;
  const pad = Math.abs(localX) < 38 && Math.abs(localZ) < 23;
  const runway = localX > 210 && localX < 260 && localZ > -130 && localZ < 890;
  const facilities = localX > -56 && localX < 226 && localZ > 40 && localZ < 160;
  const taxiway = localX > 120 && localX < 238 &&
    (Math.abs(localZ + 60) < 18 || Math.abs(localZ - 740) < 18);
  return pad || runway || facilities || taxiway;
}

/** Authored visual history, not a spatial fire simulation or collision source. */
export function createBurnField(mission: Mission, options: { eligible?: (x: number, z: number) => boolean } = {}): BurnField {
  const radius = Math.max(1, mission.fire.radius);
  const speed = Math.hypot(mission.wind.x, mission.wind.z);
  // Calm scenarios keep one stable orientation, rather than an unstable tiny vector.
  const angle = (mission.seed >>> 0) % 6283 / 1000;
  const wx = speed > .01 ? mission.wind.x / speed : Math.cos(angle);
  const wz = speed > .01 ? mission.wind.z / speed : Math.sin(angle);
  const sx = -wz, sz = wx;
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const u of [-3, 1.12]) for (const v of [-1.5, 1.5]) {
    const x = mission.fire.x + radius * (wx * u + sx * v);
    const z = mission.fire.z + radius * (wz * u + sz * v);
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  const data = new Uint8Array(SIZE * SIZE * 4);
  const seed = mission.seed ^ 0x53af217;
  const lobes = [
    [0, 0, .9, .8], [-.8, -.08, 1.03, .91], [-1.7, .10, .88, .64],
    [-2.19, -.10, .57, .38], [-1.16, .68, .78, .37], [-.52, -.73, .73, .36],
  ];
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
    const x = bounds.minX + col / (SIZE - 1) * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + row / (SIZE - 1) * (bounds.maxZ - bounds.minZ);
    if (options.eligible && !options.eligible(x, z)) continue;
    const dx = (x - mission.fire.x) / radius, dz = (z - mission.fire.z) / radius;
    const u = dx * wx + dz * wz, v = dx * sx + dz * sz;
    const broad = noise(u * 3.7, v * 3.7, seed);
    const fine = noise(u * 16, v * 16, seed + 7);
    let edge = -Infinity;
    for (const [cx, cz, rx, rz] of lobes) {
      edge = Math.max(edge, 1 - Math.hypot((u - cx) / rx, (v - cz) / rz));
    }
    edge += (broad - .5) * .3 + (fine - .5) * .09;
    const islandRaggedness = (noise(u * 24, v * 24, seed + 43) - .5) * .6;
    const islandA = 1 - smooth(.45, 1.2, Math.hypot((u + .86 + (broad - .5) * .12) / .18, (v - .3) / .2) + islandRaggedness);
    const islandB = 1 - smooth(.45, 1.2, Math.hypot((u + 1.88) / .15, (v + .2 + (fine - .5) * .06) / .14) - islandRaggedness);
    const severity = smooth(-.07, .34, edge) * (1 - Math.max(islandA, islandB) * .96);
    const age = clamp((.15 - u) / 2.65 + (broad - .5) * .15);
    const radial = Math.hypot(u, v);
    const front = (1 - smooth(.06, .25, Math.abs(radial - .65)))
      * smooth(-.5, .4, u / Math.max(.01, radial));
    const gaps = smooth(.26, .64, noise(u * 7.5, v * 7.5, seed + 19));
    const interior = (1 - smooth(.2, .5, radial)) * (.15 + .16 * fine);
    const activity = severity * Math.max(front * gaps, interior) * (1 - smooth(.85, .94, radial));
    const i = (row * SIZE + col) * 4;
    data[i] = Math.round(severity * 255);
    data[i + 1] = Math.round(age * 255);
    data[i + 2] = Math.round(activity * 255);
    data[i + 3] = 255;
  }
  return {
    bounds, size: SIZE, data,
    sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
        return { severity: 0, age: 0, activity: 0 };
      }
      const px = (x - bounds.minX) / (bounds.maxX - bounds.minX) * (SIZE - 1);
      const pz = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * (SIZE - 1);
      const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz;
      const channel = (c: number) => {
        const at = (cx: number, cz: number) => data[(Math.min(SIZE - 1, cz) * SIZE + Math.min(SIZE - 1, cx)) * 4 + c] / 255;
        return (at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx) * (1 - fz)
          + (at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx) * fz;
      };
      return { severity: channel(0), age: channel(1), activity: channel(2) };
    },
  };
}
