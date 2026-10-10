import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoColorSpace, SRGBColorSpace, Texture, type WebGLRenderer } from 'three';
import {
  createTextureAssets,
  textureAssetUrl,
  type TextureAssetLoader,
} from './textureAssets';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function makeCache(loader: TextureAssetLoader, baseUrl = '/ops-crimson-eagle/') {
  const renderer = {} as WebGLRenderer;
  const createLoader = vi.fn((_renderer: WebGLRenderer, _path: string) => loader);
  const cache = createTextureAssets(renderer, { baseUrl, createLoader });
  return { cache, createLoader };
}

afterEach(() => vi.restoreAllMocks());

describe('texture asset URL handling', () => {
  it('prefixes public paths with the configured app base', () => {
    expect(textureAssetUrl('graphics/terrain-atlas.ktx2', '/ops-crimson-eagle/'))
      .toBe('/ops-crimson-eagle/graphics/terrain-atlas.ktx2');
    expect(textureAssetUrl('/graphics/basis/', '/ops-crimson-eagle'))
      .toBe('/ops-crimson-eagle/graphics/basis/');
    expect(textureAssetUrl('https://example.test/texture.ktx2', '/ops-crimson-eagle/'))
      .toBe('https://example.test/texture.ktx2');
  });
});

describe('texture asset leases', () => {
  it('shares a decode and keeps the texture alive until the last lease releases', async () => {
    const request = deferred<Texture>();
    const loader: TextureAssetLoader = { loadAsync: vi.fn(() => request.promise), dispose: vi.fn() };
    const { cache, createLoader } = makeCache(loader);
    const first = cache.acquire('graphics/terrain-atlas.ktx2', { colorSpace: NoColorSpace });
    const second = cache.acquire('/graphics/terrain-atlas.ktx2', { colorSpace: NoColorSpace });
    const loaded = new Texture();
    const onDispose = vi.fn();
    loaded.addEventListener('dispose', onDispose);

    expect(createLoader).toHaveBeenCalledWith(expect.anything(), '/ops-crimson-eagle/graphics/basis/');
    expect(loader.loadAsync).toHaveBeenCalledTimes(1);
    expect(first.placeholder).toBe(second.placeholder);
    request.resolve(loaded);

    await expect(first.ready).resolves.toBe(loaded);
    await expect(second.ready).resolves.toBe(loaded);
    expect(loaded.userData.sharedAsset).toBe(true);
    first.release();
    first.release();
    expect(onDispose).not.toHaveBeenCalled();
    second.release();
    expect(onDispose).toHaveBeenCalledTimes(1);
    cache.dispose();
    expect(loader.dispose).toHaveBeenCalledTimes(1);
  });

  it('resolves a cancelled lease to its fallback and disposes a late decode', async () => {
    const request = deferred<Texture>();
    const loader: TextureAssetLoader = { loadAsync: vi.fn(() => request.promise), dispose: vi.fn() };
    const { cache } = makeCache(loader);
    const fallback = new Texture();
    const fallbackDispose = vi.fn();
    fallback.addEventListener('dispose', fallbackDispose);
    const lease = cache.acquire('graphics/slow.ktx2', { fallback });
    const lateTexture = new Texture();
    const lateDispose = vi.fn();
    lateTexture.addEventListener('dispose', lateDispose);

    lease.cancel();
    expect(await lease.ready).toBe(fallback);
    request.resolve(lateTexture);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(lateDispose).toHaveBeenCalledTimes(1);
    expect(fallbackDispose).not.toHaveBeenCalled();
    cache.dispose();
    expect(fallbackDispose).not.toHaveBeenCalled();
  });

  it('uses a caller fallback after decode errors and allows a later retry', async () => {
    const loader: TextureAssetLoader = { loadAsync: vi.fn().mockRejectedValue(new Error('bad KTX2')), dispose: vi.fn() };
    const { cache } = makeCache(loader);
    const fallback = new Texture();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = cache.acquire('graphics/missing.ktx2', { fallback });
    await expect(first.ready).resolves.toBe(fallback);
    first.release();
    const retry = cache.acquire('graphics/missing.ktx2', { fallback });
    await expect(retry.ready).resolves.toBe(fallback);

    expect(loader.loadAsync).toHaveBeenCalledTimes(2);
    retry.release();
    cache.dispose();
  });

  it('separates color-space overrides and resolves pending leases when the cache is disposed', async () => {
    const requests: Array<ReturnType<typeof deferred<Texture>>> = [];
    const loader: TextureAssetLoader = {
      loadAsync: vi.fn(() => {
        const request = deferred<Texture>();
        requests.push(request);
        return request.promise;
      }),
      dispose: vi.fn(),
    };
    const { cache } = makeCache(loader);
    const linear = cache.acquire('graphics/shared.ktx2', { colorSpace: NoColorSpace });
    const srgb = cache.acquire('graphics/shared.ktx2', { colorSpace: SRGBColorSpace });
    expect(loader.loadAsync).toHaveBeenCalledTimes(2);

    const linearFallback = linear.placeholder;
    const srgbFallback = srgb.placeholder;
    cache.dispose();
    await expect(linear.ready).resolves.toBe(linearFallback);
    await expect(srgb.ready).resolves.toBe(srgbFallback);
    expect(loader.dispose).toHaveBeenCalledTimes(1);
    expect(() => cache.acquire('graphics/after-dispose.ktx2')).toThrow(/disposed/);

    const lateTextures = [new Texture(), new Texture()];
    const disposeListeners = lateTextures.map((texture) => {
      const listener = vi.fn();
      texture.addEventListener('dispose', listener);
      return listener;
    });
    requests.forEach((request, index) => request.resolve(lateTextures[index]));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(disposeListeners.map((listener) => listener.mock.calls.length)).toEqual([1, 1]);
  });
});
