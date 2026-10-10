import * as THREE from 'three';

const ATLAS_SIZE = 128;
const TILE_SIZE = ATLAS_SIZE / 2;
const TILE_GUTTER = 3;

function noise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43_758.5453;
  return value - Math.floor(value);
}

function createAtlas(kind: 'foliage' | 'bark') {
  const pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const palettes = kind === 'foliage'
    ? [[42, 75, 33], [57, 91, 40], [67, 88, 37], [76, 103, 45]]
    : [[74, 52, 35], [91, 63, 40], [64, 57, 43], [102, 75, 47]];

  for (let tileY = 0; tileY < 2; tileY++) {
    for (let tileX = 0; tileX < 2; tileX++) {
      const tile = tileY * 2 + tileX;
      const [baseR, baseG, baseB] = palettes[tile];
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const u = (x + .5) / TILE_SIZE;
          const v = (y + .5) / TILE_SIZE;
          const grain = noise(x + tile * 19, y, tile + (kind === 'bark' ? 11 : 3)) - .5;
          let shade = 0;

          if (kind === 'foliage') {
            const columns = 5;
            const rows = 4;
            const leafU = (u * columns + (Math.floor(v * rows) % 2) * .5) % 1;
            const leafV = (v * rows) % 1;
            const du = (leafU - .5) / .46;
            const dv = (leafV - .5) / .31;
            const leafShape = du * du + dv * dv;
            const vein = Math.abs(dv) < .055 && leafShape < .82;
            if (leafShape < 1) shade = (vein ? .38 : .12) + .11 * (1 - leafShape);
            else shade = -.17;
            shade += Math.sin(v * 38 + Math.sin(u * 25) * .75) * .045;
          } else {
            const ridge = .5 + .5 * Math.sin(x * .39 + Math.sin(y * .105) * 2.1 + tile * .8);
            const split = Math.abs(Math.sin(x * .19 + Math.sin(y * .07) * 3.4));
            shade = (ridge - .5) * .28 - (split > .94 ? .18 : 0) + Math.sin(y * .29 + x * .13) * .035;
          }

          const index = ((tileY * TILE_SIZE + y) * ATLAS_SIZE + tileX * TILE_SIZE + x) * 4;
          const variation = shade + grain * .13;
          pixels[index] = Math.max(0, Math.min(255, Math.round(baseR * (1 + variation))));
          pixels[index + 1] = Math.max(0, Math.min(255, Math.round(baseG * (1 + variation))));
          pixels[index + 2] = Math.max(0, Math.min(255, Math.round(baseB * (1 + variation))));
          pixels[index + 3] = 255;
        }
      }
    }
  }

  const texture = new THREE.DataTexture(pixels, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  texture.name = kind === 'foliage' ? 'procedural tropical foliage atlas' : 'procedural tropical bark atlas';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Shared, deterministic material detail generated locally; no external art assets are required. */
export function createVegetationAtlases() {
  return { foliage: createAtlas('foliage'), bark: createAtlas('bark') };
}

/** Remap a 0..1 UV coordinate into one atlas tile with enough padding to avoid neighbor bleed. */
export function atlasUv(u: number, v: number, tile: number) {
  const tileX = tile % 2;
  const tileY = Math.floor(tile / 2);
  const available = TILE_SIZE - TILE_GUTTER * 2;
  return [
    (tileX * TILE_SIZE + TILE_GUTTER + THREE.MathUtils.clamp(u, 0, 1) * available) / ATLAS_SIZE,
    (tileY * TILE_SIZE + TILE_GUTTER + THREE.MathUtils.clamp(v, 0, 1) * available) / ATLAS_SIZE,
  ] as const;
}
