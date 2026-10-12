import { MathUtils } from 'three';

export type ChaseFraming = {
  distance: number;
  height: number;
  aimHeight: number;
  lookAhead: number;
  fov: number;
};

/** Local, rear-facing camera composition; never changes aircraft controls. */
export function chaseFraming(
  aspect: number,
  bucketAttached: boolean,
  precision: number,
  releasing: number,
  speed: number,
  out: ChaseFraming = { distance: 0, height: 0, aimHeight: 0, lookAhead: 0, fov: 55 },
): ChaseFraming {
  const work = MathUtils.clamp(precision, 0, 1);
  const drop = MathUtils.clamp(releasing, 0, 1);
  // Portrait needs horizontal rotor clearance, but not the old 1.85x retreat.
  const portrait = MathUtils.clamp(.72 / Math.max(.4, aspect), 1, 1.65);
  out.distance = (bucketAttached ? 44 + work * 2 + drop * 5 : 36 + work * 3) * portrait;
  out.height = (bucketAttached ? 10 + work * 8 + drop * 2 : 10 + work * 4) * Math.sqrt(portrait);
  out.aimHeight = bucketAttached ? -9 - work * 6 - drop * 4 : 1;
  out.lookAhead = MathUtils.lerp(18, 12, work);
  out.fov = 55 + MathUtils.smoothstep(speed, 12, 40) * 3;
  return out;
}
