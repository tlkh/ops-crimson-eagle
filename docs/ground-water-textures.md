# Ground and water materials

`public/graphics/terrain-atlas.png` is a deterministic, authored data atlas baked by `node scripts/bake-ground-water-textures.mjs`. It contains repeating grass, peat and sand tiles, each with a 16-pixel periodic gutter. The RGB channels hold albedo variation, surface height and roughness; alpha is opaque. These are shader data values, not display colors.

The atlas has no external image source or third-party license. Its source is the checked-in baker and fixed seeds in that script. `scripts/graphics/compress-textures.mjs` produces the checked-in runtime `public/graphics/terrain-atlas.ktx2`: an 864×288 linear UASTC texture with ten mip levels and Zstd supercompression, approximately 205 KiB. It accepts an installed `basisu` CLI or the official local BasisEncoder JS/WASM pair through `BASIS_ENCODER_JS` and `BASIS_ENCODER_WASM`; no texture is uploaded. Scenes start with an immediate procedural fallback; previews without the cache and cache failures load the PNG into that same data texture when ready.

Ground texture detail fades with view distance and combines the atlas with world-scale tonal breakup. A low-amplitude derivative bump and per-pixel roughness come from the same atlas channels. The existing vertex colors and `groundBiome` weights still control the broad habitat colors and transitions.

The committed KTX2 was generated locally with the official [Basis Universal
v2_50 encoder](https://github.com/BinomialLLC/basis_universal/tree/v2_50/webgl/encoder/build).
SHA-256: `be85f9b6ab351cff67a5fc6c1580e1c06ec7c948fe300efeefc258a75fc6779b`.
The matching runtime in `public/graphics/basis/` is copied from Three.js 0.180.0;
its licence and checksums are recorded in that directory's `NOTICE.txt`.
