import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { campaigns } from '../content';
import { shipLandingLocalZ } from '../sim/shipLanding';
import { createShipDeck, SHIP_DECK_SURFACE_Y } from './shipDeck';

function dataTexture(material: THREE.MeshStandardMaterial, key: 'map' | 'normalMap' | 'roughnessMap'): THREE.DataTexture {
  const texture = material[key];
  expect(texture).toBeInstanceOf(THREE.DataTexture);
  return texture as THREE.DataTexture;
}

function checksum(texture: THREE.DataTexture): number {
  const bytes = texture.image.data as Uint8Array;
  let result = 2166136261;
  for (let i = 0; i < bytes.length; i++) result = Math.imul(result ^ bytes[i], 16777619);
  return result >>> 0;
}

function dispose(deck: ReturnType<typeof createShipDeck>): void {
  deck.markings.geometry.dispose();
  for (const material of [deck.surface, deck.markings.material as THREE.MeshStandardMaterial]) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
    material.dispose();
  }
}

function alphaAtLocalPoint(texture: THREE.DataTexture, campaign: typeof campaigns[number], x: number, z: number): number {
  const width = texture.image.width as number, height = texture.image.height as number;
  const bow = (campaign.id === 'jp_ketapang_2026_09' ? 40 : 35) - campaign.shipLength;
  const pixelX = Math.round((x / campaign.shipWidth + .5) * (width - 1));
  const pixelY = Math.round((z - bow) / campaign.shipLength * (height - 1));
  return (texture.image.data as Uint8Array)[(pixelY * width + pixelX) * 4 + 3];
}

describe('ship flight deck', () => {
  for (const campaign of campaigns) it(`${campaign.id} has metric, matte grain and the authored deck marks`, () => {
    const deck = createShipDeck(campaign);
    const { surface, markings } = deck;
    const material = markings.material as THREE.MeshStandardMaterial;
    try {
      const color = dataTexture(surface, 'map');
      const normal = dataTexture(surface, 'normalMap');
      const roughness = dataTexture(surface, 'roughnessMap');
      expect(surface.roughness).toBe(.96);
      expect(surface.metalness).toBe(.035);
      expect(surface.normalScale.x).toBeCloseTo(.16);
      expect(color.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(normal.colorSpace).toBe(THREE.NoColorSpace);
      expect(roughness.colorSpace).toBe(THREE.NoColorSpace);
      expect(color.wrapS).toBe(THREE.RepeatWrapping);
      expect(color.wrapT).toBe(THREE.RepeatWrapping);
      expect(color.repeat.x).toBeCloseTo(campaign.shipWidth / 16);
      expect(color.repeat.y).toBeCloseTo(campaign.shipLength / 16);
      expect(normal.repeat.toArray()).toEqual(color.repeat.toArray());
      expect(roughness.repeat.toArray()).toEqual(color.repeat.toArray());
      expect(color.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(color.anisotropy).toBe(4);
      const repeated = createShipDeck(campaign);
      try {
        expect(checksum(color)).toBe(checksum(dataTexture(repeated.surface, 'map')));
        expect(checksum(normal)).toBe(checksum(dataTexture(repeated.surface, 'normalMap')));
        expect(checksum(roughness)).toBe(checksum(dataTexture(repeated.surface, 'roughnessMap')));
      } finally {
        dispose(repeated);
      }

      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      const atlas = dataTexture(material, 'map');
      expect(material.emissive.getHex()).toBe(0);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.polygonOffset).toBe(true);
      expect(markings.castShadow).toBe(false);
      expect(markings.receiveShadow).toBe(true);
      expect(markings.name).toContain('markings');

      const positions = markings.geometry.getAttribute('position');
      const normals = markings.geometry.getAttribute('normal');
      const indices = markings.geometry.index!;
      expect(indices.count).toBe(36);
      for (let i = 0; i < positions.count; i++) {
        expect(positions.getY(i)).toBeCloseTo(SHIP_DECK_SURFACE_Y + .003, 6);
        expect(normals.getY(i)).toBeGreaterThan(.99);
      }
      const bounds = new THREE.Box3().setFromObject(markings);
      expect(bounds.min.z).toBeCloseTo((campaign.id === 'jp_ketapang_2026_09' ? 40 : 35) - campaign.shipLength, 5);
      expect(bounds.max.z).toBeCloseTo(campaign.id === 'jp_ketapang_2026_09' ? 40 : 35, 5);

      const landingZ = shipLandingLocalZ(campaign);
      if (campaign.id === 'sg_fictional_2026_10') {
        const circleCore = alphaAtLocalPoint(atlas, campaign, 5.5, landingZ);
        const stripeCore = alphaAtLocalPoint(atlas, campaign, 0, landingZ);
        expect(circleCore).toBe(255);
        expect(circleCore).toBe(stripeCore);
        expect(alphaAtLocalPoint(atlas, campaign, 5, landingZ + .4)).toBe(0);
        const bow = 35 - campaign.shipLength;
        expect(alphaAtLocalPoint(atlas, campaign, 5, bow + 1.5)).toBe(0);
      } else {
        expect(alphaAtLocalPoint(atlas, campaign, 5.5, landingZ)).toBeGreaterThan(150);
        expect(alphaAtLocalPoint(atlas, campaign, -3 + 5.25, 40 - campaign.shipLength + .24 * campaign.shipLength)).toBeGreaterThan(100);
      }
    } finally {
      dispose(deck);
    }
  });
});
