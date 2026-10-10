import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/graphics/terrain-atlas.png');
const tileSize = 256;
const gutter = 16;
const cellSize = tileSize + gutter * 2;
const width = cellSize * 3;
const height = cellSize;
const seeds = [0x51731a, 0x6e1f09, 0x9ad318];
const kinds = ['grass', 'peat', 'sand'];

function hash(x, y, seed) {
  let h = (Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h / 4294967295;
}

function periodicNoise(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wrap = n => ((n % cells) + cells) % cells;
  const a = hash(wrap(ix), wrap(iy), seed);
  const b = hash(wrap(ix + 1), wrap(iy), seed);
  const c = hash(wrap(ix), wrap(iy + 1), seed);
  const d = hash(wrap(ix + 1), wrap(iy + 1), seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function encodePng(imageWidth, imageHeight, rgba) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = buffer => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const body = Buffer.concat([name, data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const scanlines = Buffer.alloc((imageWidth * 4 + 1) * imageHeight);
  for (let y = 0; y < imageHeight; y++) {
    const row = y * (imageWidth * 4 + 1);
    scanlines[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * imageWidth * 4, imageWidth * 4).copy(scanlines, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(imageWidth, 0);
  header.writeUInt32BE(imageHeight, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pixels = new Uint8Array(width * height * 4);
const toByte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const tile = Math.min(2, Math.floor(x / cellSize));
    const localX = x - tile * cellSize - gutter;
    const localY = y - gutter;
    const u = (localX + .5) / tileSize;
    const v = (localY + .5) / tileSize;
    const seed = seeds[tile];
    const macro = periodicNoise(u, v, 5, seed ^ 0x1337);
    const mid = periodicNoise(u, v, 19, seed ^ 0x2b11);
    const fine = periodicNoise(u, v, 67, seed ^ 0x51f3);
    const grain = periodicNoise(u, v, 143, seed ^ 0x7a91);
    const warpedV = v + (mid - .5) * .024 + (macro - .5) * .03;
    const fibers = .5 + .5 * Math.sin((warpedV * 39 + u * 7 + (macro - .5) * 2) * Math.PI * 2);
    let albedo, relief, roughness;
    if (kinds[tile] === 'grass') {
      albedo = .70 + macro * .18 + mid * .12 + fine * .045 + (fibers - .5) * .075;
      relief = .30 + macro * .34 + mid * .23 + fine * .12 + (fibers - .5) * .12;
      roughness = .70 + macro * .15 + mid * .13 + grain * .08;
    } else if (kinds[tile] === 'peat') {
      const dampSpots = Math.max(0, .62 - macro) * .45;
      albedo = .64 + macro * .22 + mid * .11 + fine * .055 - dampSpots;
      relief = .34 + macro * .30 + mid * .22 + fine * .16;
      roughness = .77 + macro * .12 + mid * .14 + grain * .07;
    } else {
      const ripple = .5 + .5 * Math.sin((warpedV * 24 + (macro - .5) * 2.2) * Math.PI * 2);
      const fleck = grain > .88 ? -.12 : 0;
      albedo = .75 + macro * .13 + mid * .085 + fine * .035 + (ripple - .5) * .035 + fleck;
      relief = .38 + macro * .22 + mid * .22 + fine * .14 + (ripple - .5) * .1;
      roughness = .66 + macro * .15 + mid * .12 + grain * .12;
    }
    const index = (y * width + x) * 4;
    pixels[index] = toByte(albedo);
    pixels[index + 1] = toByte(relief);
    pixels[index + 2] = toByte(roughness);
    pixels[index + 3] = 255;
  }
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, encodePng(width, height, pixels));
console.log(`Wrote ${output} (${width}x${height}, grass/peat/sand RGB data)`);
