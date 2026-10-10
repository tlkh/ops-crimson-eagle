# Graphics quality and verification

The graphics pass preserves the authored terrain, all mission coordinates,
collision placement, aircraft/ship dimensions, liveries and save schema. Its art
is original generated material work, not photography or a historical record.
The existing aircraft and ship meshes remain the gameplay and menu models.

## Runtime budgets

The main application owns one animation scheduler. Simulation remains fixed at
60 steps/second; rendering targets 30 FPS on narrow/coarse-pointer devices and
60 FPS on desktop. Rendering is suspended in hidden documents and reduced to
2 FPS while paused after a short settling period. Collision explosions retain
their short presentation window. Direct `renderFrame` capture calls retain the
existing external-clock and explicit pixel-ratio behavior.

The pause panel provides Auto, High and Battery modes. Auto starts at full
quality, lowers water reflection resolution/cadence before scene resolution,
and uses a sustained three-second load window after warm-up. Recovery requires
30 seconds of stable timing. High locks detail; Battery disables reflections
and cinematic processing, lowers shadow size and renders at 70% scale. Scene
DPR is capped at 1.5 and its long edge at 1440 pixels; the DOM HUD stays native.

Vegetation uses 12 spatial batches and camera-distance crown geometry, including
clustered near crowns and shared bark/foliage atlases. All 20,000 tree trunks
remain represented in every tier; only non-collidable ground cover can disappear.
Placement/collider seeds and route exclusions are unchanged.

## Materials and resources

- Ground: a packed grass/peat/sand atlas, persistent broad habitat variation,
  distance-faded relief, and biome roughness. See [the baker and data layout](ground-water-textures.md).
- Vehicles: original panel, normal, roughness and local-occlusion maps; restrained
  reflective glass. See [vehicle map provenance](vehicle-material-authoring.md).
- Lighting: four small prefiltered environment maps blend continuously into a
  reusable CubeUV target as simulation lighting changes. No repeat cube captures.
- Water: different sea/lake treatment, varied wave flow, rotor/bucket contact
  highlights and configurable 256/512-pixel reflection targets.
- Atmosphere/fire: original cloud/flame/smoke masks, directional cloud/smoke
  shading, softer smoke silhouettes and cooling-driven ground wetness/steam.
  Effects remain simulation-time driven and never determine impacts or outcomes.
- Burn history: shared seeded terrain/vegetation damage leading into the active
  fire edge, persistent after suppression. See [burned landscape](burn-history.md).

KTX2 loading is renderer-scoped and reference counted. Missing/failed textures
keep a procedural fallback, then try the authored same-origin PNG. Late loads
cannot revive released scenes. Basis decoder files are self-hosted under the
Vite base; their licence and checksums accompany the binaries. Additional
graphics files total 1,462,082 bytes (about 1.4 MiB), including the PNG fallback,
decoder, licence and documentation, below the proposed 8 MB first-sortie budget.

## Repeatable checks

Run `npm test` and `npm run build`. The dev-only fixture at
`/ops-crimson-eagle/scripts/graphics/index.html` provides deck, lake, forest, fire
and night views for both campaigns, mode switching, rebuilding, pausing and
JPEG capture directly from a rendered frame.
It has no save writes and is excluded from the production entrypoint. It can
also be opened with `?campaign=jp&view=night&quality=high&time=35`.

Diagnostics distinguish CPU submission time from optional asynchronous GPU
queries, and report rolling frame-interval p50/p95, draws and triangles across
passes. Scene buffer estimates and the postprocess target estimate are not total
browser/driver memory; hidden environment/reflection targets and driver overhead
are not fully represented. Frame intervals measure RAF scheduling, not physical
display presentation. Desktop viewport emulation is not a phone benchmark.

The remaining physical acceptance check is two consecutive five-minute sorties
on iPhone 13/Safari and Pixel 7a/Chrome. Check launch, dense woodland, lake pickup,
fire suppression, night recovery and campaign switching. Target about 30 FPS,
95% of presented-frame intervals at or below 36 ms and no sustained thermal drop
below 27 FPS. Record actual device/browser versions and capture traces before
claiming that target has been met. Unsupported GPU timing must stay labelled
unavailable rather than being substituted with CPU timing.

## Verification in this change

All 156 tests and the production build passed on 2026-10-10. All 17 literal
service-worker precache entries and 39 voice assets exist in the build. A clean
production launch under `/ops-crimson-eagle/` and the deck attachment action
worked without renderer or texture-loading warnings. Vite still reports its
large-JavaScript-chunk advisory (the entry is about 268 KiB gzipped).

Desktop and 390×844 browser checks covered lake/forest/fire/night rendering, both
campaigns, the graphics control and keyboard pause/resume. No physical-device or
thermal measurement was available. One narrow desktop lake sample at High showed
33.3/33.5 ms frame-interval p50/p95 and approximately 1.53 million submitted
triangles, including secondary passes. That is a spot check on the host GPU,
not evidence of sustained phone performance.
