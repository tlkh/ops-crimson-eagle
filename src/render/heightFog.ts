import * as THREE from 'three';

/** Add ground-layer aerial perspective without a postprocessing pass or fog planes. */
export function createHeightFog(japanese: boolean) {
  const patched = new WeakSet<THREE.Material>();
  // Extinction per metre, inverse layer height, clear foreground, maximum mix.
  const settings = { value: new THREE.Vector4(japanese ? .00135 : .0012, 1 / 190, 65, .48) };

  return {
    apply(root: THREE.Object3D) {
      root.traverse(object => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        for (const entry of Array.isArray(material) ? material : [material]) {
          if (!(entry as THREE.Material & { fog?: boolean }).fog || patched.has(entry)) continue;
          patched.add(entry);
          const beforeCompile = entry.onBeforeCompile;
          const previousCacheKey = entry.customProgramCacheKey();
          entry.onBeforeCompile = (shader, renderer) => {
            // Preserve the particle opacity/burn-scar shader hooks already in use.
            beforeCompile.call(entry, shader, renderer);
            shader.uniforms.heightFogSettings = settings;
            shader.vertexShader = shader.vertexShader
              .replace('#include <fog_pars_vertex>', `#include <fog_pars_vertex>
                #ifdef USE_FOG
                  varying float vHeightFogY;
                  varying vec3 vHeightFogViewPosition;
                #endif`)
              .replace('#include <fog_vertex>', `#include <fog_vertex>
                #ifdef USE_FOG
                  // Undo the camera rotation to recover world Y. mvPosition
                  // already includes instancing, skinning and sprite placement.
                  vHeightFogY = cameraPosition.y + dot(viewMatrix[1].xyz, mvPosition.xyz);
                  vHeightFogViewPosition = mvPosition.xyz;
                #endif`);
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>
                #ifdef USE_FOG
                  uniform vec4 heightFogSettings;
                  varying float vHeightFogY;
                  varying vec3 vHeightFogViewPosition;
                #endif`)
              .replace('#include <fog_fragment>', `#include <fog_fragment>
                #ifdef USE_FOG
                  // Integrate an exponentially thinning layer along the view ray.
                  // Symmetric endpoints avoid overflow above/below the layer and
                  // the small-span limit stays finite for horizontal views.
                  float cameraHeight = max(cameraPosition.y, 0.0);
                  float surfaceHeight = max(vHeightFogY, 0.0);
                  float heightSpan = abs(cameraHeight - surfaceHeight) * heightFogSettings.y;
                  float averageDensity = exp(-min(cameraHeight, surfaceHeight) * heightFogSettings.y);
                  averageDensity *= heightSpan < .001 ? 1.0 : (1.0 - exp(-heightSpan)) / heightSpan;
                  // Measure per fragment: interpolating vertex distances would
                  // incorrectly fog even nearby pixels on the huge sea plane.
                  float pathLength = max(length(vHeightFogViewPosition) - heightFogSettings.z, 0.0);
                  float layerFog = min(heightFogSettings.w, 1.0 - exp(-pathLength * averageDensity * heightFogSettings.x));
                  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, layerFog);
                #endif`);
          };
          entry.customProgramCacheKey = () => `${previousCacheKey}|ground-height-fog-v1`;
          entry.needsUpdate = true;
        }
      });
    },
  };
}
