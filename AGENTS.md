# Agent guide

This is the main development guide for **Ops Crimson Eagle**, a TypeScript/Three.js browser game. Keep [README.md](README.md) a concise human-facing overview. Record durable implementation guidance here and detailed reference evidence in `docs/`.

## Model routing

Proactively delegate useful, independent subtasks. Choose the least expensive model suited to the work:

- **gpt-6-luna / xhigh:** focused searches, summaries, mechanical edits, routine implementation, and bounded bug fixes.
- **gpt-6-sol / xhigh:** difficult debugging, design, and correctness reviews.
- **gpt-6-astra / low:** exceptionally hard problems, open problems, or unresolved blockers after a cheaper model has made a meaningful attempt but failed.

Explicitly select the model and reasoning effort when spawning each subagent. Give it a focused brief rather than copying the entire conversation. Keep simple tasks with the main agent. Avoid duplicate work and overlapping file ownership; subagents return concise results and evidence, and the main agent integrates and verifies their work.

Use semantic names: `[MODEL_NAME]-[TASK_TITLE]-[OPTIONAL_ID]`, using underscores when the tool requires them (for example, `gpt_6_luna_bucket_contact`). Mark finished children done with `interrupt_agent` when that tool is available.

## Product scope and evidence

- Two campaigns, six missions each: fictional RSAF Deployment around Seruyan, and JSDF Deployment around Ketapang based on a real deployment. Keep that distinction in subtitles and supporting copy.
- Missions target about **300 simulated seconds**. This is a gameplay duration target, not a strict wall-clock timeout. Routes, distances, fuel consumption, and handling are deliberately compressed for short sessions.
- The [original brief](Singapore_and_Japan_Chinook_Codex_Brief.md) is background. Follow current user requirements and implemented conventions; do not restore its longer travel distances or superseded controls.
- Scenario coordinates are local gameplay metres, not latitude/longitude or surveyed geography. Aircraft variants and operational details may be representative presets; do not present authored missions as historical flight records.
- Every mission has a start and end time of day. The sky, sun, illumination, and atmospheric transitions follow simulation time over the sortie; keep effects paused with gameplay and avoid treating authored lighting as local forecast data.
- Generated campaign images are illustrations, not observations of actual fires. Preserve source URLs and generation provenance in [campaign-artwork.json](docs/campaign-artwork.json).

## Architecture and ownership

| Location | Responsibility |
| --- | --- |
| `src/main.ts` | Application lifecycle, input aggregation, fixed-step loop, scene/UI coordination, audio, serialized saves |
| `src/types.ts`, `src/sim/types.ts` | Shared content, commands, and simulation state |
| `src/content/index.ts` | Campaign and mission definitions |
| `src/content/geography.ts` | Fixed campaign settlement anchors, sector access points, and connected road network |
| `src/content/provenance.ts`, `validate.ts` | Scenario evidence and startup content validation |
| `src/sim/index.ts` | Headless gameplay: flight, phases, fuel, objective actions, bucket, water, fire, outcomes |
| `src/sim/bucket.ts` | Shared bucket geometry, surface heights, and water-contact helpers |
| `src/sim/fireWork.ts`, `src/sim/shipLanding.ts` | Shared fire-observation thresholds and campaign-specific ship landing points |
| `src/sim/collision.ts` | Shared terrain heights, triangle interpolation, and registered world obstacle collision data |
| `src/render/index.ts` | Three.js scene lifecycle, camera, and visual updates |
| `src/render/aircraft.ts`, `ships.ts`, `world.ts` | Aircraft, ships, terrain assembly, and world collider registration |
| `src/render/airbase.ts` | Japan airbase perimeter, checkpoints, support assets, and connections to campaign roads |
| `src/render/groundSurface.ts`, `vegetation.ts`, `landUse.ts`, `coastalDetails.ts`, `distantScenery.ts` | Procedural ground patterns, biome vegetation, farms/roads/settlements, coastal transitions, and distant silhouettes |
| `src/render/bucket.ts`, `groundCrew.ts` | Sling/load visuals and ground handling animation |
| `src/render/water.ts`, `fire.ts`, `atmosphere.ts`, `timeOfDay.ts`, `nightLighting.ts`, `cinematicEffects.ts`, `proximityParticles.ts` | Water, fire, smoke, time-of-day lighting, and restrained cinematic/proximity effects |
| `src/render/campaignFleet.ts` | Cached menu portraits rendered from the actual game aircraft and ships |
| `src/ui/index.ts`, `flightHud.ts`, `briefingMap.ts`, `menu.ts`, `src/style.css` | Campaign/mission screens, top-down mission map, controls, cues, instruments, and responsive styling |
| `src/audio.ts`, `src/music.ts`, `src/missionRadio.ts`, `src/persistence.ts` | Flight sound, campaign music, radio cues, and browser save storage |
| `public/` | Static artwork, generated campaign map, fonts, music/voice assets, app icons, manifest, and service worker |

Keep gameplay authoritative in the simulation. Render code consumes state; it must not independently decide fill levels, water hits, collision outcomes, or mission progression. Keep the simulation usable without a browser or renderer.

## Simulation and geometry invariants

### Time and coordinates

- Fixed simulation step: **1/60 second**. The main loop bounds elapsed time, step count, and backlog. Preserve pause/terminal-state behavior and clear one-shot commands after consumption.
- Y is up; the aircraft faces local **-Z** at heading zero. Ship length follows Z and beam follows X. Positive yaw turns left; HUD heading wraps the negated yaw into degrees. Do not assume gameplay X/Z are geographic compass axes.
- `mission.ship` anchors ship geometry and map markers. The RSAF's actual spawn/landing target is **17 m along ship-local +Z** from that marker, matching Persistence's aftmost painted helicopter guide; Japan's target remains **20 m along ship-local +Z**, matching Kunisaki's painted aft guide. Use `shipLandingPoint` and `shipLandingLocalZ` from `src/sim/shipLanding.ts` so spawn, contact, guidance, rigging, rendering, and crew placement stay aligned. Preserve both offsets when varying a mission’s ship position and `shipHeading`; use `shipToWorld` / `shipToLocal` for deck, hull and crew coordinates. The coastline, terrain and settlements use the fixed `campaignTerrainFrame` in `src/content/terrainFrame.ts`, never the moving ship pose.
- Aircraft origin at a ship landing is Y=0; the visible deck surface is approximately **-2.525 m**, matching tyre clearance. Ground/shore landing heights must account for the gear instead of putting the aircraft origin on the surface.

### Bucket and water

- `state.bucket` is the **center of the open rim**, not the bucket bottom. Shared dimensions belong in `src/sim/bucket.ts`; do not duplicate inconsistent constants in render or UI code.
- Current dimensions: body height **1.48 m**, lift point **0.85 m above the rim**, hook **1.76 m below aircraft origin**, maximum sling length **22 m**.
- The rope is a one-sided length constraint: gravity and momentum move the bucket, tension limits its distance when taut, and it can slacken when resting. Avoid snapping the bucket to a permanently vertical offset.
- Damp taut-sling swing relative to the moving hook, preserving inward radial velocity so the rope can slacken. World-space horizontal drag creates persistent trailing during cruise.
- Ground clearance samples the bucket footprint against the applicable terrain, deck, apron, or pad. Maintain agreement between visible surfaces and simulation heights so neither bucket nor aircraft clips through them.
- Water contact follows the irregular visible lake shoreline. Filling also requires an attached bucket, an explicit fetching action, contact inside the central circular refill zone, and sufficiently low horizontal bucket speed; load remains limited by maximum gross mass.
- Released water travels as simulation packets and affects fire on impact. Keep the rendered stream, capacity bar, water mass, and fire response synchronized with that state.
- After required drops, keep guidance on fire observation while released water is still in flight and while the fire can be secured (surface heat ≤30 for peat, ≤8 otherwise). Keep radio and HUD guidance aligned with these shared thresholds; once the objective is secured, advance to recovery without another lake trip.
- Singapore deck recovery requires the full bucket footprint over the deck, the bucket clear of deck height, and the aircraft within 5 m of the marked landing point at low horizontal speed. The player carries the load over the deck and descends vertically. Sweep bucket motion against the hull before applying ground-height correction so a sea-level load cannot be dragged through the ship side. Japan retains its campaign-specific recovery flow.
- Keep bucket rigging separate from the aircraft model. Preserve the simple bucket attachment without restoring the removed protruding rods.

### Guidance, input, and collisions

- Heading is controlled manually; the Face objective button and F shortcut have been removed. The legacy simulation command remains for compatibility. **Set return** changes the destination without flying the route. There is no route autopilot or hover-assist control.
- Radio approach hints begin within 200 m, repeat after 24 simulated seconds, and leave at least 8 seconds between changing hints. Preserve event/urgent priority, mute and pause behavior; numeric hover advice uses the recorded 25 m lake and 55 m fire cues.
- Context actions appear only near their respective zones. A bounded final alignment assist may position the aircraft for that action; do not extend it into automatic travel between objectives.
- The left joystick uses **yaw = -pointer X** and collective/climb = pointer Y after screen-Y normalization. Its knob follows the pointer visually. Keyboard A/D turn left/right; preserve the same direction for focused joystick keyboard controls.
- `src/ui/stickResponse.ts` applies a radial deadzone and gentle response curve to virtual sticks, with separate yaw/cyclic/collective limits. Keep visual knob travel direct and global flight keyboard inputs independent of those virtual-stick limits.
- `src/keyboardResponse.ts` independently ramps global flight keys from a gentle initial input to keyboard-specific limits using simulation steps. Release, reversal, opposing keys, and input resets clear the relevant ramp; do not apply keyboard shaping to touch input or simulation/test-driver commands.
- Reset active inputs on pointer release/cancel/lost capture, pause, blur, visibility changes, and orientation changes. Global shortcuts must not override focused UI controls.
- Unsafe contact with terrain, trees, ships, structures, or water causes an explosion and mission failure. Controlled landings on designated deck/shore areas are explicit exceptions. Fix geometry/contact math rather than disabling collision to hide clipping.
- Rendered terrain and collision use the same triangulated height grid. Trees and structures register colliders from their actual generated placement; keep these aligned when changing models or world generation. Collision caches depend on the `Mission` object identity.
- `TERRAIN_GRID` in `src/sim/collision.ts` defines the visible and collision terrain dimensions. Keep its row/column layout synchronized with `src/render/world.ts`, and preserve triangle interpolation and Float32 height agreement. Hills and land use stay clear of authored routes, refilling water, fire sectors, landing sites, and drainage water.
- Procedural vegetation and rural land use use stable campaign seeds so scenery does not rearrange between sorties. Keep route/objective/settlement exclusions aligned with generated colliders. Reduced visual tiers must preserve visible trunks and their collision data; do not hide obstacles while retaining invisible colliders.
- Campaign roads and settlement anchors come from `src/content/geography.ts`; preserve shared junctions and campaign-wide placement when adding sector assets. Identify real road termini against other roads' full segments, not just shared endpoints. Keep a small asset cluster and a burnable driveway at each unserved end; settlement ends already have their own clusters. See [campaign geography](docs/campaign-geography.md). Road exclusions must remain continuous without introducing full-array scans per vegetation or burn-field sample.
- Campaign lake outlines are defined by `src/sim/lakeShape.ts` and shared by visible water, terrain cutouts, refill checks and briefing maps. Keep each campaign's shoreline distinct and irregular, with the complete circular refill area inside it; keep roads, airbase fences and all mission flight corridors clear of the full outer shoreline.
- Japan's airbase in `src/render/airbase.ts` connects its open checkpoint gates to the campaign road network. Align rendered fences, gates, buildings, roads and their colliders; leave the shore pad, runway, taxiways and approach corridors clear. Airbase roads and their surroundings remain eligible for burn history.

## Rendering and UI conventions

- Reuse the gameplay models for menu fleet views. The portrait renderer is temporary and cached; dispose its GPU resources after capturing the image.
- Dispose replaced scenes, materials, geometry, textures, and listeners. Prefer reuse or instancing to creating objects every frame. Preserve WebGL context-loss recovery.
- Check aircraft changes from the player's rear chase view as well as side view. The current photo-guided configuration has a short, wide upper rear opening over a raised, tapered lower ramp; keep the recess bounded so terrain cannot show through, and preserve the green JGSDF rear finish. Do not add a full-height open ramp or stray roof/gear shapes. JGSDF roundels belong at the side tanks' longitudinal centres, with 陸上自衛隊 forward of them toward the nose.
- Ground-layer aerial perspective is patched per material in `src/render/heightFog.ts`, alongside the existing smoke/distance fog. Preserve existing shader hooks; calculate view-ray length per fragment so large water polygons remain clear nearby. Menu portraits do not use this layer.
- Use simulation time for each mission's sky/sun transition and for night lighting; keep ambient illumination plausible for aircraft, ships, settlements, and fires. Proximity particles and cinematic effects remain subtle, pause with simulation, and respect reduced-motion preferences.
- The briefing map is a top-down render of the actual gameplay map with labeled locations. Keep its coordinates aligned with mission geometry and landing offsets; avoid substituting a decorative or geographically precise map for the authored local gameplay coordinates.
- Keep equipment names readable without truncation, reserve image dimensions before asynchronous loading, and retain clear next-step mission cues.
- Respect reduced motion, maintain keyboard focus across menu transitions, and keep touch controls usable at phone sizes. Ground crew and gameplay effects should follow simulation time so they freeze when paused.
- Audio unlocks on a user gesture; essential feedback must remain understandable when muted.
- The application owns the frame scheduler: preserve the 60 Hz simulation while `renderScheduledFrame` budgets 30 Hz mobile rendering. `renderFrame` remains available for deterministic capture. Keep Auto/High/Battery profiles in `src/render/quality.ts`; do not use CPU submission time as a substitute for GPU timing.
- Runtime graphics textures use renderer-scoped leases from `src/render/textureAssets.ts`. Release leases on scene disposal; recursive material cleanup must skip `texture.userData.sharedAsset`. Keep decoder URLs under `import.meta.env.BASE_URL` and retain the procedural/PNG fallback.
- Burn history is a shared, immutable visual field used by terrain, vegetation and fire sources; cooling must not erase its char or resurrect crowns. Keep flames inside the authored suppression radius, preserve all trunk colliders and clearances, and protect actual airport surfaces rather than applying the 900 m vegetation exclusion to burn rendering. See [burn history](docs/burn-history.md).

## Saves, assets, and deployment

- IndexedDB database `operation-crimson-eagle`, store `checkpoints`, stores campaign-keyed snapshots with save version 1. Progress is separate in `localStorage` under `progress:<campaignId>`.
- Preserve campaign/mission IDs or provide a migration. Selection resumes only the matching non-terminal mission; snapshot saves are serialized to prevent older writes overwriting newer state.
- `worldRevision` marks checkpoints against authored terrain and solid-scene changes. When that revision changes, validate legacy aircraft and attached-bucket positions against the constructed world; restart only a checkpoint that intersects new scenery and keep campaign progress intact.
- Browser storage is per origin. Different local hosts/ports can have different progress; use a clean browser context or deliberate restart when checking initial mission state.
- Vite's base is **`/ops-crimson-eagle/`**. Use `import.meta.env.BASE_URL` for public asset URLs and service-worker registration. Keep manifest paths relative and verify the production build under this subpath.
- The service worker registers only in production. Update its cache version and precache list when changing cached shell/art assets, and check for stale caches when a preview shows old visuals.
- `.github/workflows/deploy.yml` builds with npm and publishes `dist/` to GitHub Pages on pushes to `main`. A successful local build or push alone does not verify a completed deployment.
- Keep generated build/test output and local credentials out of Git. `.gitignore` excludes `dist/`, `output/`, dependencies, environment files, and local hosting configuration. Commit source assets and their provenance, not temporary QA captures.

## Working and verification

Use Node.js 22.12+ and the committed npm lockfile:

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Dev and preview URLs include `/ops-crimson-eagle/`. `build` runs TypeScript checking before Vite. There is no separate lint script.

- Inspect the working tree before editing and preserve unrelated user changes. Keep file ownership separate when delegating.
- `src/content/content.test.ts` covers scenario validation/provenance. `src/sim/index.test.ts` covers simulation invariants. `src/integration.test.ts` flies every mission with a **test-only** command driver, checking completion within the five-minute target and landing fuel reserve. Do not expose that driver as gameplay autopilot.
- `src/sim/terrain.test.ts` covers shared relief and mesh interpolation; `src/render/vegetation.test.ts` and `landUse.test.ts` cover vegetation tiers, route clearances, and deterministic rural scenery. Keep tests focused on gameplay safety and stable procedural placement.
- Run the relevant existing checks for a change. For simulation/content changes, run `npm test`; for TypeScript/UI/assets, run `npm run build`. Add regression tests when they verify meaningful behavior rather than merely repeating the implementation.
- For visual or interaction changes, inspect the actual local app at desktop and narrow phone widths. Exercise the affected action, keyboard/touch path, pause/resume, and mission/campaign switching as relevant. Screenshots and automated browser checks do not establish physical-device behavior.
- Check staging with `git diff --cached --check` before committing. Report what changed, what was actually verified, and any remaining limitation without claiming unperformed tests or deployments.

## Reference documentation

- [Research notes](docs/research-notes.md): scenario sources and evidence boundaries.
- [Aircraft](docs/aircraft-geometry-references.md), [ships](docs/ship-geometry-references.md), and [maps](docs/map-geometry-references.md): model and geographic references.
- [Campaign artwork](docs/campaign-artwork.json): current satellite illustration sources and generation prompts.
- [Visual refinement](docs/visual-refinement.md): visual implementation notes.
- [Graphics quality](docs/graphics-quality.md): rendering budgets, generated material provenance, diagnostic limits and physical-device acceptance checks.
- [Verification](docs/verification.md) and [status](docs/status.md): dated snapshots, not proof of current checks. Recheck source and tests before repeating their counts or completion claims. Older asset notes may describe superseded artwork.
