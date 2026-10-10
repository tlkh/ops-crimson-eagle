import * as THREE from 'three';

/** Optional asynchronous GPU timing; never blocks on a query or reads pixels. */
export function createGpuTimer(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let latest: number | null = null;
  return {
    begin() {
      if (!extension || gl.isContextLost()) return;
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      if (disjoint) {
        for (const query of pending.splice(0)) gl.deleteQuery(query);
        latest = null;
      }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift()!;
        if (!disjoint) latest = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
      }
      if (pending.length >= 3) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(extension.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (active && extension && !gl.isContextLost()) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        pending.push(active);
      }
      active = null;
    },
    get milliseconds(): number | null { return latest; },
    dispose() {
      if (active) gl.deleteQuery(active);
      for (const query of pending) gl.deleteQuery(query);
      pending.length = 0; active = null;
    },
  };
}

export class FrameHistory {
  private readonly samples: number[] = [];
  private index = 0;
  add(milliseconds: number) {
    if (!(milliseconds > 0 && milliseconds < 250)) return;
    this.samples[this.index] = milliseconds;
    this.index = (this.index + 1) % 180;
  }
  read() {
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const p = (percent: number) => sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)] ?? 0;
    return { frameIntervalP50Ms: p(.5), frameIntervalP95Ms: p(.95), samples: sorted.length };
  }
}

/** An estimate of resident scene buffers, excluding driver/browser allocations. */
export function estimateSceneBytes(scene: THREE.Scene): number {
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const buffers = new Set<ArrayBufferLike>();
  const collect = (value: unknown) => { if (value instanceof THREE.Texture) textures.add(value); };
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      Object.values(material).forEach(collect);
      const uniforms = (material as THREE.ShaderMaterial).uniforms;
      if (uniforms) Object.values(uniforms).forEach(uniform => collect(uniform.value));
    }
    const instanced = object as THREE.InstancedMesh;
    if (instanced.instanceMatrix) buffers.add(instanced.instanceMatrix.array.buffer);
    if (instanced.instanceColor) buffers.add(instanced.instanceColor.array.buffer);
  });
  collect(scene.environment);
  for (const geometry of geometries) {
    if (geometry.index) buffers.add(geometry.index.array.buffer);
    for (const attribute of Object.values(geometry.attributes)) {
      if (attribute instanceof THREE.InterleavedBufferAttribute) buffers.add(attribute.data.array.buffer);
      else buffers.add(attribute.array.buffer);
    }
  }
  let bytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
  for (const texture of textures) {
    if ((texture as THREE.CompressedTexture).isCompressedTexture) {
      bytes += texture.mipmaps.reduce((total, mip) => total + ((mip as { data?: ArrayBufferView }).data?.byteLength ?? 0), 0);
      continue;
    }
    const image = texture.image as { width?: number; height?: number } | undefined;
    const channels = texture.format === THREE.RedFormat ? 1 : texture.format === THREE.RGFormat ? 2 : 4;
    const channelBytes = texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1;
    bytes += (image?.width ?? 0) * (image?.height ?? 0) * channels * channelBytes * (texture.generateMipmaps ? 4 / 3 : 1);
  }
  return Math.round(bytes);
}
