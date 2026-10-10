import {
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  type ColorSpace,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export interface TextureAssetOptions {
  /** Override the transfer function recorded in the KTX2 file. */
  colorSpace?: ColorSpace;
  /** Caller-owned texture used while loading and whenever loading fails. */
  fallback?: Texture;
}

export interface TextureAssetLease {
  /** Immediate texture for the loading state. On failure this is also the result of `ready`. */
  readonly placeholder: Texture;
  /** Resolves to the decoded texture, or to this lease's fallback when loading fails or is cancelled. */
  readonly ready: Promise<Texture>;
  /** Release this consumer's reference. Idempotent; `cancel` is an alias. */
  release(): void;
  cancel(): void;
}

export interface TextureAssets {
  /** Acquire a public asset path such as `graphics/terrain-atlas.ktx2`. */
  acquire(path: string, options?: TextureAssetOptions): TextureAssetLease;
  /** Dispose cached GPU textures and the loader. Create a new cache for a new renderer/context. */
  dispose(): void;
}

export interface TextureAssetLoader {
  loadAsync(url: string): Promise<Texture>;
  dispose(): void;
}

export interface TextureAssetsOptions {
  /** Primarily useful for tests and non-root hosted previews. Defaults to Vite's public base URL. */
  baseUrl?: string;
  /** Test seam; production should use Three's KTX2Loader. */
  createLoader?: (renderer: WebGLRenderer, transcoderPath: string) => TextureAssetLoader;
}

interface TextureRecord {
  readonly key: string;
  readonly url: string;
  references: number;
  status: 'loading' | 'loaded' | 'failed';
  texture?: Texture;
  promise: Promise<Texture | undefined>;
}

const SHARED_ASSET_FLAG = 'sharedAsset';

/** Resolve public paths under Vite's configured base, including GitHub Pages subpaths. */
export function textureAssetUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

function fallbackTexture(colorSpace: ColorSpace): Texture {
  const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  texture.colorSpace = colorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.userData[SHARED_ASSET_FLAG] = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Owns KTX2 loading and decoded texture lifetime for one renderer. Consumers must release each
 * lease when the object/material that uses it is disposed. Cache-owned textures carry
 * `texture.userData.sharedAsset = true` so recursive material disposal can leave them to this
 * manager.
 */
export function createTextureAssets(renderer: WebGLRenderer, options: TextureAssetsOptions = {}): TextureAssets {
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const transcoderPath = textureAssetUrl('graphics/basis/', baseUrl);
  const loader = options.createLoader
    ? options.createLoader(renderer, transcoderPath)
    : new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);

  const records = new Map<string, TextureRecord>();
  const leases = new Set<{ release(): void }>();
  const fallbackTextures = new Map<ColorSpace, Texture>();
  let disposed = false;

  const getFallback = (request: TextureAssetOptions): Texture => {
    if (request.fallback) return request.fallback;
    const colorSpace = request.colorSpace ?? NoColorSpace;
    let texture = fallbackTextures.get(colorSpace);
    if (!texture) {
      texture = fallbackTexture(colorSpace);
      fallbackTextures.set(colorSpace, texture);
    }
    return texture;
  };

  const removeRecord = (record: TextureRecord) => {
    if (records.get(record.key) === record) records.delete(record.key);
  };

  const createRecord = (key: string, url: string, colorSpace?: ColorSpace): TextureRecord => {
    const record: TextureRecord = {
      key,
      url,
      references: 0,
      status: 'loading',
      promise: Promise.resolve(undefined),
    };
    records.set(key, record);
    let request: Promise<Texture>;
    try {
      request = loader.loadAsync(url);
    } catch (error) {
      request = Promise.reject(error);
    }
    record.promise = Promise.resolve(request)
      .then((texture) => {
        if (disposed || record.references === 0 || records.get(key) !== record) {
          texture.dispose();
          record.status = 'failed';
          removeRecord(record);
          return undefined;
        }
        if (colorSpace !== undefined) texture.colorSpace = colorSpace;
        texture.userData[SHARED_ASSET_FLAG] = true;
        record.texture = texture;
        record.status = 'loaded';
        return texture;
      })
      .catch((error: unknown) => {
        record.status = 'failed';
        removeRecord(record);
        if (!disposed) console.warn(`[texture-assets] Failed to load ${url}; using its fallback.`, error);
        return undefined;
      })
      .then((texture) => {
        if (!texture && record.references === 0) removeRecord(record);
        if (texture && (disposed || record.references === 0)) {
          texture.dispose();
          record.texture = undefined;
          removeRecord(record);
          return undefined;
        }
        return texture;
      });
    return record;
  };

  const acquire = (path: string, request: TextureAssetOptions = {}): TextureAssetLease => {
    if (disposed) throw new Error('Cannot acquire a texture after its asset cache has been disposed.');

    const url = textureAssetUrl(path, baseUrl);
    const colorSpaceKey = request.colorSpace ?? 'from-file';
    const key = `${url}\u0000${colorSpaceKey}`;
    const placeholder = getFallback(request);
    let record = records.get(key);
    if (!record) record = createRecord(key, url, request.colorSpace);
    record.references++;

    let released = false;
    let settleReady: (texture: Texture) => void = () => undefined;
    let readySettled = false;
    const ready = new Promise<Texture>((resolve) => { settleReady = resolve; });
    const settle = (texture: Texture) => {
      if (readySettled) return;
      readySettled = true;
      settleReady(texture);
    };
    const lease = {
      release: () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        settle(placeholder);
        record!.references = Math.max(0, record!.references - 1);
        if (record!.references === 0 && record!.status !== 'loading') {
          if (record!.texture) {
            record!.texture.dispose();
            record!.texture = undefined;
          }
          removeRecord(record!);
        }
      },
      cancel: () => lease.release(),
    };
    leases.add(lease);

    void record.promise.then((texture) => {
      if (released || disposed || !texture) settle(placeholder);
      else settle(texture);
    });

    return { placeholder, ready, release: lease.release, cancel: lease.cancel };
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const lease of [...leases]) lease.release();
    for (const record of records.values()) record.texture?.dispose();
    records.clear();
    for (const texture of fallbackTextures.values()) texture.dispose();
    fallbackTextures.clear();
    loader.dispose();
  };

  return { acquire, dispose };
}
