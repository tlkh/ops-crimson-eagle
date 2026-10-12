import * as THREE from 'three';
import type { Campaign } from '../types';
import { shipLandingLocalZ } from '../sim/shipLanding';

/** Deck top in the ship model's local frame. */
export const SHIP_DECK_SURFACE_Y = -2.525;
const MARKINGS_Y = SHIP_DECK_SURFACE_Y + 0.003;
const GRAIN_TILE_METRES = 16;
const GRAIN_TEXTURE_SIZE = 256;
const MARKING_PIXELS_PER_METRE = 8;

type Station = readonly [fraction: number, halfBeamFraction: number];
type Rgba = readonly [number, number, number, number];

const SG_STATIONS: readonly Station[] = [
  [0, .10], [.045, .55], [.12, .87], [.22, .98], [.34, 1], [.91, 1], [1, .96],
];
const JP_STATIONS: readonly Station[] = [
  [0, .11], [.035, .54], [.10, .84], [.19, .98], [.30, 1], [.91, 1], [1, .98],
];

function isJapan(campaign: Pick<Campaign, 'id'>): boolean {
  return campaign.id === 'jp_ketapang_2026_09';
}

function sternZ(campaign: Pick<Campaign, 'id'>): number {
  return isJapan(campaign) ? 40 : 35;
}

function stations(campaign: Pick<Campaign, 'id'>): readonly Station[] {
  return isJapan(campaign) ? JP_STATIONS : SG_STATIONS;
}

function bowZ(campaign: Pick<Campaign, 'shipLength' | 'id'>): number {
  return sternZ(campaign) - campaign.shipLength;
}

function pointUv(campaign: Campaign, x: number, z: number): [number, number] {
  return [x / campaign.shipWidth + .5, (z - bowZ(campaign)) / campaign.shipLength];
}

function deckHalfBeamAt(campaign: Campaign, z: number): number {
  const fraction = THREE.MathUtils.clamp((z - bowZ(campaign)) / campaign.shipLength, 0, 1);
  const rows = stations(campaign);
  for (let i = 1; i < rows.length; i++) {
    if (fraction > rows[i][0]) continue;
    const [f0, w0] = rows[i - 1], [f1, w1] = rows[i];
    return campaign.shipWidth * .5 * THREE.MathUtils.lerp(w0, w1, (fraction - f0) / (f1 - f0));
  }
  return campaign.shipWidth * .5 * rows.at(-1)![1];
}

function pointOnDeck(campaign: Campaign, x: number, z: number): boolean {
  return x >= -deckHalfBeamAt(campaign, z) && x <= deckHalfBeamAt(campaign, z);
}

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function hashGrid(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), y + 0x27d4eb2d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

/** Continuous deterministic noise with an exact tile period. */
function periodicNoise(x: number, y: number, lattice: number, seed: number): number {
  const px = modulo(x, GRAIN_TEXTURE_SIZE) / GRAIN_TEXTURE_SIZE * lattice;
  const py = modulo(y, GRAIN_TEXTURE_SIZE) / GRAIN_TEXTURE_SIZE * lattice;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const tx = THREE.MathUtils.smoothstep(px - x0, 0, 1);
  const ty = THREE.MathUtils.smoothstep(py - y0, 0, 1);
  const x1 = (x0 + 1) % lattice, y1 = (y0 + 1) % lattice;
  const a = THREE.MathUtils.lerp(hashGrid(x0, y0, seed), hashGrid(x1, y0, seed), tx);
  const b = THREE.MathUtils.lerp(hashGrid(x0, y1, seed), hashGrid(x1, y1, seed), tx);
  return THREE.MathUtils.lerp(a, b, ty);
}

function textureFrom(data: Uint8Array, width: number, height: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function paintHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function makeSurfaceMaps(campaign: Campaign) {
  const size = GRAIN_TEXTURE_SIZE, count = size * size;
  const color = new Uint8Array(count * 4), normal = new Uint8Array(count * 4), roughness = new Uint8Array(count * 4);
  const jp = isJapan(campaign);
  const base = paintHex(jp ? '#737979' : '#4d585a');
  const seed = jp ? 4003 : 2198;
  const heights = new Float32Array(count);
  const roughnessValues = new Float32Array(count);

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const large = periodicNoise(x, y, 4, seed + 89);
    const medium = periodicNoise(x, y, 24, seed + 131);
    const grit = periodicNoise(x, y, 192, seed + 211);
    heights[i] = .48 * large + .34 * medium + .18 * grit;
    roughnessValues[i] = .945 + (medium - .5) * .035 + (grit - .5) * .025;
    const variation = (large - .5) * 4 + (medium - .5) * 3 + (grit - .5) * 2;
    color[i * 4] = THREE.MathUtils.clamp(Math.round(base[0] + variation), 0, 255);
    color[i * 4 + 1] = THREE.MathUtils.clamp(Math.round(base[1] + variation), 0, 255);
    color[i * 4 + 2] = THREE.MathUtils.clamp(Math.round(base[2] + variation), 0, 255);
    color[i * 4 + 3] = 255;
    const rough = THREE.MathUtils.clamp(Math.round(roughnessValues[i] * 255), 0, 255);
    roughness[i * 4] = roughness[i * 4 + 1] = roughness[i * 4 + 2] = rough;
    roughness[i * 4 + 3] = 255;
  }

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const left = heights[y * size + modulo(x - 1, size)], right = heights[y * size + modulo(x + 1, size)];
    const down = heights[modulo(y - 1, size) * size + x], up = heights[modulo(y + 1, size) * size + x];
    const nx = THREE.MathUtils.clamp((left - right) * 1.55, -.38, .38);
    const ny = THREE.MathUtils.clamp((down - up) * 1.55, -.38, .38);
    const nz = Math.sqrt(Math.max(.1, 1 - nx * nx - ny * ny));
    normal[i] = Math.round((nx * .5 + .5) * 255);
    normal[i + 1] = Math.round((ny * .5 + .5) * 255);
    normal[i + 2] = Math.round(nz * 255);
    normal[i + 3] = 255;
  }

  const colorMap = textureFrom(color, size, size, THREE.SRGBColorSpace);
  const normalMap = textureFrom(normal, size, size, THREE.NoColorSpace);
  const roughnessMap = textureFrom(roughness, size, size, THREE.NoColorSpace);
  colorMap.repeat.set(campaign.shipWidth / GRAIN_TILE_METRES, campaign.shipLength / GRAIN_TILE_METRES);
  normalMap.repeat.copy(colorMap.repeat);
  roughnessMap.repeat.copy(colorMap.repeat);
  return { colorMap, normalMap, roughnessMap };
}

function atlasPixel(campaign: Campaign, width: number, height: number, x: number, z: number): [number, number] {
  const [u, v] = pointUv(campaign, x, z);
  return [u * (width - 1), v * (height - 1)];
}

function overPixel(data: Uint8Array, width: number, height: number, x: number, y: number, rgba: Rgba, coverage: number): void {
  if (x < 0 || x >= width || y < 0 || y >= height || coverage <= 0) return;
  const offset = (y * width + x) * 4;
  const sourceAlpha = THREE.MathUtils.clamp(rgba[3] / 255 * coverage, 0, 1);
  const destinationAlpha = data[offset + 3] / 255;
  const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (alpha <= 0) return;
  for (let channel = 0; channel < 3; channel++) {
    data[offset + channel] = Math.round((rgba[channel] * sourceAlpha + data[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / alpha);
  }
  data[offset + 3] = Math.round(alpha * 255);
}

function drawLine(data: Uint8Array, campaign: Campaign, width: number, height: number,
  a: readonly [number, number], b: readonly [number, number], widthMetres: number, color: Rgba): void {
  const [ax, ay] = atlasPixel(campaign, width, height, a[0], a[1]);
  const [bx, by] = atlasPixel(campaign, width, height, b[0], b[1]);
  const scaleX = width / campaign.shipWidth, scaleY = height / campaign.shipLength;
  const half = widthMetres * Math.min(scaleX, scaleY) * .5;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1)), maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - half - 1)), maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + half + 1));
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const worldX = ((x + .5) / (width - 1) - .5) * campaign.shipWidth;
    const worldZ = bowZ(campaign) + (y + .5) / (height - 1) * campaign.shipLength;
    if (!pointOnDeck(campaign, worldX, worldZ)) continue;
    const t = length2 > 0 ? THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / length2, 0, 1) : 0;
    const distance = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    const coverage = distance <= half ? 1 : THREE.MathUtils.clamp(1 - (distance - half) / .75, 0, 1);
    overPixel(data, width, height, x, y, color, coverage);
  }
}

function drawCircle(data: Uint8Array, campaign: Campaign, width: number, height: number,
  centerX: number, centerZ: number, radius: number, lineWidth: number, color: Rgba): void {
  const [cx, cy] = atlasPixel(campaign, width, height, centerX, centerZ);
  const xScale = width / campaign.shipWidth, yScale = height / campaign.shipLength;
  const radiusX = radius * xScale, radiusY = radius * yScale;
  const widthPx = lineWidth * Math.min(xScale, yScale);
  const extent = Math.max(radiusX, radiusY) + widthPx + 1;
  const minX = Math.max(0, Math.floor(cx - extent)), maxX = Math.min(width - 1, Math.ceil(cx + extent));
  const minY = Math.max(0, Math.floor(cy - extent)), maxY = Math.min(height - 1, Math.ceil(cy + extent));
  const antialiasBand = .5 * Math.hypot(1 / xScale, 1 / yScale);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const worldX = ((x + .5) / (width - 1) - .5) * campaign.shipWidth;
    const worldZ = bowZ(campaign) + (y + .5) / (height - 1) * campaign.shipLength;
    if (!pointOnDeck(campaign, worldX, worldZ)) continue;
    const distance = Math.hypot((x - cx) / xScale, (y - cy) / yScale);
    const signedDistance = Math.abs(distance - radius) - lineWidth * .5;
    const coverage = signedDistance <= 0 ? 1 : THREE.MathUtils.clamp(1 - signedDistance / antialiasBand, 0, 1);
    overPixel(data, width, height, x, y, color, coverage);
  }
}

function drawDot(data: Uint8Array, campaign: Campaign, width: number, height: number,
  centerX: number, centerZ: number, radius: number, color: Rgba): void {
  const [cx, cy] = atlasPixel(campaign, width, height, centerX, centerZ);
  const xScale = width / campaign.shipWidth, yScale = height / campaign.shipLength;
  const antialiasBand = .5 * Math.hypot(1 / xScale, 1 / yScale);
  const extentX = (radius + antialiasBand) * xScale, extentY = (radius + antialiasBand) * yScale;
  const minX = Math.max(0, Math.floor(cx - extentX)), maxX = Math.min(width - 1, Math.ceil(cx + extentX));
  const minY = Math.max(0, Math.floor(cy - extentY)), maxY = Math.min(height - 1, Math.ceil(cy + extentY));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const worldX = ((x + .5) / (width - 1) - .5) * campaign.shipWidth;
    const worldZ = bowZ(campaign) + (y + .5) / (height - 1) * campaign.shipLength;
    if (!pointOnDeck(campaign, worldX, worldZ)) continue;
    const distance = Math.hypot((x - cx) / xScale, (y - cy) / yScale);
    const coverage = distance <= radius ? 1 : THREE.MathUtils.clamp(1 - (distance - radius) / antialiasBand, 0, 1);
    overPixel(data, width, height, x, y, color, coverage);
  }
}

function drawBox(data: Uint8Array, campaign: Campaign, width: number, height: number,
  centerX: number, centerZ: number, boxWidth: number, boxLength: number, lineWidth: number, color: Rgba): void {
  const left = centerX - boxWidth / 2, right = centerX + boxWidth / 2;
  const front = centerZ - boxLength / 2, back = centerZ + boxLength / 2;
  drawLine(data, campaign, width, height, [left, front], [right, front], lineWidth, color);
  drawLine(data, campaign, width, height, [right, front], [right, back], lineWidth, color);
  drawLine(data, campaign, width, height, [right, back], [left, back], lineWidth, color);
  drawLine(data, campaign, width, height, [left, back], [left, front], lineWidth, color);
}

// Chamfered, continuous block paint outlines in normalized glyph coordinates.
// Rasterize the outlines directly so headless captures do not depend on fonts.
type GlyphOutline = readonly (readonly [number, number])[];
const DIGIT_OUTLINES: Record<string, readonly GlyphOutline[]> = {
  '0': [
    [[.18,0],[.82,0],[1,.14],[1,.86],[.82,1],[.18,1],[0,.86],[0,.14]],
    [[.26,.16],[.74,.16],[.8,.21],[.8,.79],[.74,.84],[.26,.84],[.2,.79],[.2,.21]],
  ],
  '1': [[[.2,.17],[.49,0],[.69,0],[.69,.84],[.96,.84],[.96,1],[.14,1],[.14,.84],[.48,.84],[.48,.22],[.2,.38]]],
  '2': [[[0,.14],[.18,0],[.82,0],[1,.14],[1,.38],[.23,.84],[1,.84],[1,1],[0,1],[0,.77],[.8,.3],[.8,.2],[.74,.16],[.26,.16],[.2,.21],[.2,.3],[0,.3]]],
  '3': [[[0,0],[.82,0],[1,.14],[1,.4],[.87,.5],[1,.6],[1,.86],[.82,1],[0,1],[0,.84],[.74,.84],[.8,.79],[.8,.62],[.73,.58],[.29,.58],[.29,.42],[.73,.42],[.8,.38],[.8,.21],[.74,.16],[0,.16]]],
  '9': [
    [[.18,0],[.82,0],[1,.14],[1,.84],[.8,1],[.1,1],[.1,.84],[.72,.84],[.8,.77],[.8,.58],[.18,.58],[0,.44],[0,.14]],
    [[.26,.16],[.74,.16],[.8,.21],[.8,.42],[.26,.42],[.2,.37],[.2,.21]],
  ],
};

function insideOutline(x: number, y: number, outline: GlyphOutline): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[i], [bx, by] = outline[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function drawText(data: Uint8Array, campaign: Campaign, width: number, height: number,
  value: string, centerX: number, centerZ: number, textWidth: number, textHeight: number, color: Rgba): void {
  const glyphSpacing = .34;
  const glyphWidth = textWidth / (value.length + (value.length - 1) * glyphSpacing);
  const left = centerX - textWidth / 2, top = centerZ - textHeight / 2;
  for (let charIndex = 0; charIndex < value.length; charIndex++) {
    const outlines = DIGIT_OUTLINES[value[charIndex]];
    const glyphLeft = left + charIndex * glyphWidth * (1 + glyphSpacing);
    const [px0, py0] = atlasPixel(campaign, width, height, glyphLeft, top);
    const [px1, py1] = atlasPixel(campaign, width, height, glyphLeft + glyphWidth, top + textHeight);
    for (let y = Math.max(0, Math.floor(py0)); y <= Math.min(height - 1, Math.ceil(py1)); y++) {
      for (let x = Math.max(0, Math.floor(px0)); x <= Math.min(width - 1, Math.ceil(px1)); x++) {
        let coverage = 0;
        for (const dy of [-.25, .25]) for (const dx of [-.25, .25]) {
          const gx = (x + dx - px0) / (px1 - px0), gy = (y + dy - py0) / (py1 - py0);
          if (insideOutline(gx, gy, outlines[0]) && !outlines.slice(1).some(hole => insideOutline(gx, gy, hole))) coverage += .25;
        }
        overPixel(data, width, height, x, y, color, coverage);
      }
    }
  }
}

function drawDashedLine(data: Uint8Array, campaign: Campaign, width: number, height: number,
  a: readonly [number, number], b: readonly [number, number], dash: number, gap: number, lineWidth: number, color: Rgba): void {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  for (let start = 0; start < length; start += dash + gap) {
    const end = Math.min(length, start + dash);
    drawLine(data, campaign, width, height,
      [a[0] + dx * start / length, a[1] + dz * start / length],
      [a[0] + dx * end / length, a[1] + dz * end / length], lineWidth, color);
  }
}

function drawTieDowns(data: Uint8Array, campaign: Campaign, width: number, height: number, color: Rgba): void {
  // Flush tie-down sockets sit in sparse paired rows down the marked operating area.
  const aft = 29;
  const start = -31;
  for (const x of [-7.2, -3.6, 3.6, 7.2]) for (let z = start; z <= aft; z += 2.4) {
    drawDot(data, campaign, width, height, x, z, .10, color);
  }
}

function makeMarkingAtlas(campaign: Campaign): THREE.DataTexture {
  const width = Math.round(campaign.shipWidth * MARKING_PIXELS_PER_METRE);
  const height = Math.round(campaign.shipLength * MARKING_PIXELS_PER_METRE);
  const data = new Uint8Array(width * height * 4);
  const white: Rgba = [224, 229, 225, 245];
  const dark: Rgba = isJapan(campaign) ? [72, 80, 80, 215] : [42, 54, 57, 215];
  const tieDown: Rgba = isJapan(campaign) ? [65, 72, 73, 185] : [137, 148, 146, 185];
  const japan = isJapan(campaign);
  const stern = sternZ(campaign);
  const aftLanding = shipLandingLocalZ(campaign);

  if (japan) {
    drawBox(data, campaign, width, height, -3, stern - campaign.shipLength + .24 * campaign.shipLength, 10.5, 15, .13, dark);
    drawBox(data, campaign, width, height, -3, stern - campaign.shipLength + .59 * campaign.shipLength, 10.5, 12, .13, dark);
    for (const z of [-12, aftLanding]) {
      drawBox(data, campaign, width, height, 0, z, campaign.shipWidth * .78, 22, .13, white);
      drawLine(data, campaign, width, height, [-campaign.shipWidth * .38, z], [campaign.shipWidth * .38, z], .16, white);
      for (const side of [-1, 1]) drawLine(data, campaign, width, height,
        [side * campaign.shipWidth * .37, z - 10], [0, z], .14, white);
    }
    drawLine(data, campaign, width, height, [0, -29.5], [0, 35.5], .19, white);
    drawText(data, campaign, width, height, '03', 0, stern - 5, 5.8, 3.4, white);
  } else {
    for (const z of [-16, aftLanding]) {
      drawCircle(data, campaign, width, height, 0, z, 5.5, .14, white);
      drawLine(data, campaign, width, height, [-campaign.shipWidth * .41, z], [campaign.shipWidth * .41, z], .16, white);
    }
    for (const x of [-campaign.shipWidth * .44, 0, campaign.shipWidth * .44]) {
      drawLine(data, campaign, width, height, [x, -32.5], [x, 32.5], x === 0 ? .2 : .2, white);
    }
    for (const x of [-.34, .34]) drawLine(data, campaign, width, height, [x, -31.5], [x, 29.5], .055, dark);
    drawText(data, campaign, width, height, '1', 1.5, -16, 1.7, 2.1, white);
    drawText(data, campaign, width, height, '2', 1.5, aftLanding, 1.7, 2.1, white);
    drawText(data, campaign, width, height, '209', 0, 29, 6.5, 2.6, white);

    // Broken diagonal approach guides lead into Persistence's forward ring.
    for (const centerZ of [-16, aftLanding]) for (const side of [-1, 1]) drawDashedLine(data, campaign, width, height,
      [side * 8.8, centerZ - 20], [0, centerZ - 5.5], 1.15, .9, .12, white);
    drawTieDowns(data, campaign, width, height, tieDown);
  }

  const atlas = textureFrom(data, width, height, THREE.SRGBColorSpace);
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.generateMipmaps = true;
  return atlas;
}

function makeDeckSilhouette(campaign: Campaign): THREE.BufferGeometry {
  const rows = stations(campaign), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const bow = bowZ(campaign);
  for (const [fraction, halfBeamFraction] of rows) {
    const z = bow + fraction * campaign.shipLength;
    const halfBeam = campaign.shipWidth * .5 * halfBeamFraction;
    positions.push(-halfBeam, MARKINGS_Y, z, halfBeam, MARKINGS_Y, z);
    uvs.push(...pointUv(campaign, -halfBeam, z), ...pointUv(campaign, halfBeam, z));
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const leftNear = i * 2, rightNear = leftNear + 1, leftFar = leftNear + 2, rightFar = leftFar + 1;
    indices.push(leftNear, leftFar, rightNear, rightNear, leftFar, rightFar);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Creates a physically lit nonslip deck and its single, silhouette-clipped paint atlas. */
export function createShipDeck(campaign: Campaign): { surface: THREE.MeshStandardMaterial; markings: THREE.Mesh } {
  const maps = makeSurfaceMaps(campaign);
  const surface = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: maps.colorMap,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    roughness: .96,
    metalness: .035,
    normalScale: new THREE.Vector2(.16, .16),
    side: THREE.DoubleSide,
  });
  surface.name = 'Ship flight deck · matte nonslip';

  const markingMaterial = new THREE.MeshStandardMaterial({
    map: makeMarkingAtlas(campaign),
    color: 0xffffff,
    roughness: .92,
    metalness: .025,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
  markingMaterial.name = 'Ship flight deck · painted markings';
  const markings = new THREE.Mesh(makeDeckSilhouette(campaign), markingMaterial);
  markings.name = 'Ship flight deck markings';
  markings.castShadow = false;
  markings.receiveShadow = true;
  return { surface, markings };
}
