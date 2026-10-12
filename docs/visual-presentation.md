# Visual presentation pass

The October 2026 presentation pass builds on the existing Three.js renderer.
Its direction is low-altitude cinematic firefighting: visible aircraft materials,
clear foregrounds, a layered tropical horizon, varied canopy silhouettes and
localized water/fire effects. It uses original procedural assets and adds no
external model or texture dependency.

## Composition and movement

`src/render/chaseCamera.ts` defines local camera framing. Transit shows more
horizon; low flight and proximity to the lake/fire blend toward working framing.
Fetching, releases and in-flight water packets retain the more downward view.
Neither framing nor its transitions issue flight commands. Composition blends
and rotor spin-up use simulation time. The normal camera position retains its
existing eased follow behavior and deterministic capture poses still override it.

Projection tests cover both rotor discs and a full-length sling with lateral and
fore/aft swing at desktop, portrait-phone and landscape-phone aspect ratios.
These are framing checks, not substitutes for real touch-device validation.

At flight RPM, physical blades fade toward a swept disc instead of remaining
opaque spokes. Handling phases retain readable slow blades. Cinematic edge
softness is reduced to preserve terrain and contact-point detail.

## Assets and lighting

Vegetation keeps its 26,000 existing seeded trunk placements and collider data.
Fuller asymmetric crowns and layered ground tones improve the apparent
canopy without adding trees or changing mission geography. Crown LOD and burn
history remain shared across quality tiers. Surface appearance changes do not
revise collision geometry or invalidate saved positions.

Every foliage LOD reaches the existing collision crown top and bottom, so
changing detail cannot create an invisible obstacle above the rendered trees.
Animated flame cards also reserve their complete width inside the authored
suppression circle at every camera bearing.

Time-of-day palettes and environment reflections separate the aircraft from
the ground. The near haze layer is lighter, with distance still fading into a
cool tropical horizon. Low clouds use shaded offset slices in instanced banks;
night floodlights have a smaller, softer footprint. These effects remain
simulation-time driven and do not represent historical weather.

Water has calmer lake ripples and broken sea highlights; rotor wash stays
localized. Fire and smoke presentation follows existing simulated heat, wind,
burn history and suppression boundaries. Visual changes cannot create hits,
scoring or suppression.

Auto and mobile retain their existing resolution/shadow budgets. Desktop High
allows a 1920-pixel scene long edge and 2048-square shadows. This is a bounded
optional tier; it requires actual GPU/frame-time validation on the intended
hardware. See [graphics quality](graphics-quality.md) for device acceptance.

## Verification — 12–13 October 2026

- `npm test`: 54 test files and 284 tests passed, including all 12 mission
  completion checks and the camera-framing, foliage-envelope and flame-boundary
  regressions.
- `npm run build`: TypeScript and the production build passed. Vite still reports
  the existing JavaScript chunk-size advisory.
- Inspected both campaigns in the local graphics fixture, including forest,
  lake, fire and night views. The inspected views produced no console warnings
  or errors.
- Tested the production build under `/ops-crimson-eagle/` at 390 × 844: launch,
  bucket attachment, keyboard lift, tactical map, pause/resume and changing the
  graphics profile. Desktop visual inspection used the explicit High profile.
- These are local browser checks. Physical-device GPU performance and touch
  behavior were not verified; no deployment was performed.
