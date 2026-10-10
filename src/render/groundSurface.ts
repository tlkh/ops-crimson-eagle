import * as THREE from 'three';

type GroundSurface = {
  material: THREE.MeshStandardMaterial;
  dispose(): void;
};

// Three small procedural patterns add material scale without downloading artwork.
// The terrain's vertex colours supply each habitat's broad colour and the
// groundBiome attribute blends the patterns continuously at their boundaries.
function makePattern(kind: 'grass' | 'peat' | 'sand', seed: number): THREE.DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let state = seed >>> 0;
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const noise = random() - .5;
      const fine = Math.sin(x * .74 + y * .19) * Math.sin(y * .57 - x * .11);
      const fleck = random() > .965 ? 1 : 0;
      const value = kind === 'grass'
        ? .91 + noise * .14 + fine * .055 + fleck * .12
        : kind === 'peat'
          ? .82 + noise * .18 + Math.sin(x * .19 + y * .27) * .055 - fleck * .19
          : .99 + noise * .11 + Math.sin(x * .12 + y * .23) * .035 - fleck * .1;
      const index = (y * size + x) * 4;
      const channel = Math.round(THREE.MathUtils.clamp(value, .58, 1.16) * 220);
      pixels[index] = channel;
      pixels[index + 1] = channel;
      pixels[index + 2] = channel;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createGroundSurface(): GroundSurface {
  const grass = makePattern('grass', 0x51731a);
  const peat = makePattern('peat', 0x6e1f09);
  const sand = makePattern('sand', 0x9ad318);
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1 });
  material.onBeforeCompile = shader => {
    shader.uniforms.groundGrass = { value: grass };
    shader.uniforms.groundPeat = { value: peat };
    shader.uniforms.groundSand = { value: sand };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 groundBiome;
        varying vec3 vGroundBiome;
        varying vec2 vGroundCoord;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGroundBiome = groundBiome;
        vGroundCoord = uv * vec2(95.0, 65.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D groundGrass;
        uniform sampler2D groundPeat;
        uniform sampler2D groundSand;
        varying vec3 vGroundBiome;
        varying vec2 vGroundCoord;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 groundWeights = max(vGroundBiome, vec3(0.0));
        groundWeights /= max(dot(groundWeights, vec3(1.0)), .001);
        float grassDetail = texture2D(groundGrass, vGroundCoord * 1.3).r;
        float peatDetail = texture2D(groundPeat, vGroundCoord).r;
        float sandDetail = texture2D(groundSand, vGroundCoord * .8).r;
        float groundDetail = dot(groundWeights, vec3(grassDetail, peatDetail, sandDetail));
        diffuseColor.rgb *= .83 + groundDetail * .22;`);
  };
  material.customProgramCacheKey = () => 'ground-surface-v1';
  return {
    material,
    dispose() { grass.dispose(); peat.dispose(); sand.dispose(); },
  };
}
