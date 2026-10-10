# Gameplay atmosphere and coastal detail

Implemented 10 October 2026. Lighting is authored for gameplay, not a reconstruction of recorded weather or astronomical conditions.

## Mission lighting

Both campaigns use the following schedule. Each transition spans the mission's `durationTargetSec` (currently 300 simulated seconds), then holds its final lighting.

| Sortie | Start | End |
| --- | --- | --- |
| 01 | 05:30 dawn | 08:00 morning |
| 02 | 08:00 morning | 12:00 noon |
| 03 | 12:00 noon | 17:30 sunset |
| 04 | 17:30 sunset | 18:30 dusk |
| 05 | 18:30 dusk | 20:00 night |
| 06 | 20:00 night | Next day 05:30 dawn |

`timeOfDay.ts` evaluates one shared solar direction, linear RGB palette, sunlight and ambient fill. The sky disc, cloud tint, fog, water reflections and illumination consume this state. Time derives from existing simulation time, so pause, restart and checkpoint restore need no extra save fields. The briefing describes the accelerated lighting; no clock is added to the HUD.

Night uses six persistent local lights: aircraft landing spotlight, two fire lights, ship floodlight, shore floodlight and a practical light shared by the nearest settlement/coastal cluster. Fixtures include aircraft navigation lights, ship/deck markers, shore lamps and warm building windows. Only the sun or the low-approach landing spotlight casts shadows at a time. Ambient fill preserves terrain readability.

## Scene effects

The optional cinematic pass applies only to the WebGL scene, leaving the DOM HUD sharp. A five-sample shader adds an 8% daytime / 5% nighttime vignette and peripheral softening, with protected aircraft and bucket areas. Edge blur is capped at 1.25 CSS pixels on desktop and 0.75 on narrow screens. Speed-dependent directional blur fades in from 40–100 km/h, capped at 1.5 / 0.75 pixels with a contribution below 8%; it stops while paused or when reduced motion is enabled. This is a restrained directional approximation, not temporal motion blur or physical lens depth of field.

The pause-menu **Cinematic effects** switch persists per origin. Unsupported framebuffer configurations fall back to direct rendering. Render targets and effects resources are disposed with the scene.

Rotor proximity produces ground/deck dust and water spray; nearby active fires produce ash and occasional embers. One reusable point pool is capped at 128 sprites, reduced to 64 for narrow/coarse-pointer views. Surface sampling shares collision/terrain conventions. Effects follow simulation time and never alter flight forces or mission outcomes.

## Coast

The original authored shoreline and terrain remain authoritative. A separate deterministic seed adds a wet strand, shallow shelf, sediment tint, grass/shrubs, mangrove roots and crowns, small working boats, and a stilt hut/work-shelter cluster with a stepped jetty and equipment. These are representative regional details rather than surveyed placements. Existing geographical evidence remains in `map-geometry-references.md`.

The coastal layer stays within 12 draws and 100,000 triangles; current missions retain 6–8 boats in three variants. Placement respects mission routes and objective exclusions, and solid props register matching collision bounds. Merged geometry and instancing avoid per-prop draw calls. Boat movement and lamps use simulation time and shared lighting.

## Verification

Automated coverage includes lighting endpoints/overnight transitions/unit solar direction, screen-effect limits, particle timing/budgets, and coastal budgets, deterministic placement and route clearance across all 12 missions. Existing simulation and full-campaign completion tests remain required.

Real Chromium captures at 0, 75, 150, 225 and 300 simulated seconds cover both campaigns (60 images), plus desktop and narrow phone checks. Temporary captures live under ignored `output/playwright/`. These are browser viewport checks, not physical-device or sustained mobile GPU measurements. Renderer diagnostics report submitted draws/triangles and CPU submission time, not GPU frame time.

Final checks: `npm test` passed 102 tests in 13 files, including all 12 mission-completion tests; `npm run build` passed with the existing large-bundle advisory; `git diff --check` passed. Fresh browser checks reported no errors. Three repeated campaign-switch cycles returned to the same 20 textures / 248 geometries. In a warmed coastal night view, enabling cinematic effects added one draw and two triangles; sampled CPU submission was approximately 2.5–4 ms. First-use shader compilation caused a one-off stall when toggling the pass, so these steady-state figures do not describe startup or mobile GPU performance. The persisted toggle was verified after reload. No deployment was performed.

## Deck and rotor follow-up

RSAF Chinook starts and recovers at the aftmost RSS Persistence landing guide, local Z=+17 m. Japan retains Z=+20 m. `src/sim/shipLanding.ts` is shared by simulation, deck markings, ground crew and practical lighting; mission ship anchors stay fixed. Existing checkpoints retain their saved aircraft positions; new/restarted sorties use the corrected start.

Physical rotor blades remain opaque and visible at flight RPM, alongside a lighter translucent swept disc. This avoids water transparency drawing over the blades. Both continue to use simulation time for rotation and pause behavior. Actual-renderer captures verify the aft landing circle and consecutive blade orientations over water on desktop and phone.

## Fire observation and Singapore recovery — 2026-10-10

Mission guidance waits for released water to impact. Once the required releases have been made and suppression permits crews to finish (surface heat ≤30 for peat, ≤8 otherwise), the HUD and radio keep the player observing the fire until it is secured, then route to the next recovery objective. These thresholds also prevent first-tick rekindling from incorrectly requesting another load.

Singapore recovery requires the whole bucket footprint above the flight deck and the aircraft within 5 m of its marked landing spot before the local recovery action becomes available. Approach with the load clear of the deck, then descend vertically. Swept bucket/hull contact stops lateral dragging from sea level before the surface-height correction can lift the bucket through the ship. The test-only sortie driver follows the same overhead approach.

Verification: all 12 simulated sorties complete; regression coverage includes every mission's cooling-to-return transition, deck clearance, swept hull crossings, stale recovery actions and radio descent gating. HUD inspected in a real browser at 1440×900 and 390×844 using seeded gameplay states; this does not constitute physical-device testing.
