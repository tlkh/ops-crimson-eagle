import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGroundSurface } from './groundSurface';
import { createHeightFog } from './heightFog';
import type { BurnField } from './burnField';

const makeBurnField = (): BurnField => ({
  bounds: { minX: -10, maxX: 10, minZ: -20, maxZ: 20 },
  size: 2,
  // row 0 is minZ; channels are severity, age, activity and eligibility.
  data: new Uint8Array([
    255, 0, 0, 255, 128, 255, 128, 255,
    64, 40, 255, 255, 0, 0, 0, 0,
  ]),
  sample(x, z) {
    return x < -10 || x > 10 || z < -20 || z > 20
      ? { severity: 0, age: 0, activity: 0 }
      : { severity: 1, age: 0, activity: 0 };
  },
});

describe('ground surface material', () => {
  it('keeps its atlas, normal and roughness shader hooks composable with height fog', () => {
    const ground = createGroundSurface();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), ground.material);
    createHeightFog(false).apply(mesh);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <fog_pars_vertex>\n#include <fog_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <fog_pars_fragment>\n#include <fog_fragment>',
    };

    ground.material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);

    expect(shader.uniforms).toHaveProperty('groundAtlas');
    expect(shader.uniforms).toHaveProperty('groundBurnField');
    expect(shader.vertexShader).toContain('vGroundWorldPosition');
    expect(shader.fragmentShader).toContain('groundAtlasUv(worldXZ * .095, 0.0)');
    expect(shader.fragmentShader).toContain('sampleGroundBurnField(worldXZ)');
    expect(shader.fragmentShader).toContain('p.x < groundBurnBounds.x');
    expect(shader.fragmentShader).toContain('(grid * (groundBurnSize - 1.0) + .5) / groundBurnSize');
    expect(shader.fragmentShader).toContain('groundBumpHeight');
    expect(shader.fragmentShader).toContain('vec3 habitatTint');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= 1.0 + macroBreakup');
    expect(shader.fragmentShader).toContain('vec3 charcoalTint');
    expect(shader.fragmentShader).toContain('vec3 ashTint');
    expect(shader.fragmentShader).toContain('burnBranchTrace');
    expect(shader.fragmentShader).toContain('if (burnCoverage > .001)');
    expect(shader.fragmentShader).toContain('smoothstep(28.0, 145.0, groundDistance)');
    expect(shader.fragmentShader).toContain('groundNoise(worldXZ * .105');
    expect(shader.fragmentShader).not.toContain('groundNoise(worldXZ * .83');
    expect(shader.fragmentShader).toContain('float burnRelief');
    expect(shader.fragmentShader).toContain('float peatRoughness');
    expect(shader.fragmentShader).toContain('heightFogSettings');
    ground.dispose();
  });

  it('uploads the field as a linear RGBA mask and disposes its texture once', () => {
    const ground = createGroundSurface(undefined, makeBurnField());
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
    };
    ground.material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);

    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    const texture = uniforms.groundBurnField.value as THREE.DataTexture;
    expect(texture.image).toMatchObject({ width: 2, height: 2 });
    expect(texture.image.data).toBeInstanceOf(Uint8Array);
    expect(texture.image.data).toEqual(makeBurnField().data);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(uniforms.groundBurnBounds.value).toEqual(new THREE.Vector4(-10, 10, -20, 20));
    expect(uniforms.groundBurnSize.value).toBe(2);
    expect(uniforms.groundBurnEnabled.value).toBe(1);

    let disposeEvents = 0;
    texture.addEventListener('dispose', () => { disposeEvents++; });
    ground.dispose();
    ground.dispose();
    expect(disposeEvents).toBe(1);
  });

  it('uses a disabled zero mask without a field and rejects malformed grids', () => {
    const ground = createGroundSurface();
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
    };
    ground.material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    const texture = uniforms.groundBurnField.value as THREE.DataTexture;
    expect(texture.image).toMatchObject({ width: 1, height: 1 });
    expect(texture.image.data).toEqual(new Uint8Array(4));
    expect(uniforms.groundBurnEnabled.value).toBe(0);
    ground.dispose();

    expect(() => createGroundSurface(undefined, { ...makeBurnField(), data: new Uint8Array(3) }))
      .toThrow('Burn field must have a square RGBA grid and non-empty finite bounds');
  });

  it('keeps suppression wetness transient and driven by positive heat decreases in simulation time', () => {
    const ground = createGroundSurface(undefined, makeBurnField());
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>',
    };
    ground.material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    const uniforms = shader.uniforms as Record<string, { value: unknown }>;
    const strength = uniforms.groundWetStrength;
    expect(shader.fragmentShader).toContain('max(burnActivity * .9, recentChar * .24) * burnEligibility');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= 1.0 - groundWetness * .24');
    expect(shader.fragmentShader).toContain('groundWetness * .34');

    ground.update({ timeSec: 5, fireHeat: 100 });
    expect(strength.value).toBe(0);
    ground.update({ timeSec: 5.016, fireHeat: 80 });
    expect(strength.value).toBe(.82);
    ground.update({ timeSec: 5.016, fireHeat: 80 });
    expect(strength.value).toBe(.82);
    ground.update({ timeSec: 6, fireHeat: 80 });
    expect(strength.value).toBeCloseTo(.82 * Math.exp(-.5 * .085), 6);
    ground.update({ timeSec: 6.016, fireHeat: 60 });
    expect(strength.value).toBeCloseTo(.82, 6);
    ground.dispose();
  });
});
