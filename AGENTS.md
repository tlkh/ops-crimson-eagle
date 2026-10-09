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
- Generated campaign images are illustrations, not observations of actual fires. Preserve source URLs and generation provenance in [campaign-artwork.json](docs/campaign-artwork.json).

## Architecture and ownership

| Location | Responsibility |
| --- | --- |
| `src/main.ts` | Application lifecycle, input aggregation, fixed-step loop, scene/UI coordination, audio, serialized saves |
| `src/types.ts`, `src/sim/types.ts` | Shared content, commands, and simulation state |
| `src/content/index.ts` | Campaign and mission definitions |
| `src/content/provenance.ts`, `validate.ts` | Scenario evidence and startup content validation |
| `src/sim/index.ts` | Headless gameplay: flight, phases, fuel, objective actions, bucket, water, fire, outcomes |
| `src/sim/bucket.ts` | Shared bucket geometry, surface heights, and water-contact helpers |
| `src/sim/collision.ts` | Terrain interpolation and registered world obstacle collision data |
| `src/render/index.ts` | Three.js scene lifecycle, camera, and visual updates |
| `src/render/aircraft.ts`, `ships.ts`, `world.ts` | Aircraft, ships, terrain, vegetation, settlements, and world collider registration |
| `src/render/bucket.ts`, `groundCrew.ts` | Sling/load visuals and ground handling animation |
| `src/render/water.ts`, `fire.ts`, `atmosphere.ts` | Water, fire, smoke, and atmospheric effects |
| `src/render/campaignFleet.ts` | Cached menu portraits rendered from the actual game aircraft and ships |
| `src/ui/index.ts`, `flightHud.ts`, `src/style.css` | Campaign/mission screens, controls, cues, map, instruments, and responsive styling |
| `src/audio.ts`, `src/persistence.ts` | Synthesized audio and browser save storage |
| `public/` | Static artwork, app icons, manifest, and service worker |

Keep gameplay authoritative in the simulation. Render code consumes state; it must not independently decide fill levels, water hits, collision outcomes, or mission progression. Keep the simulation usable without a browser or renderer.

## Simulation and geometry invariants

### Time and coordinates

- Fixed simulation step: **1/60 second**. The main loop bounds elapsed time, step count, and backlog. Preserve pause/terminal-state behavior and clear one-shot commands after consumption.
- Y is up; the aircraft faces local **-Z** at heading zero. Ship length follows Z and beam follows X. Positive yaw turns left; HUD heading wraps the negated yaw into degrees. Do not assume gameplay X/Z are geographic compass axes.
- `mission.ship` anchors ship geometry and map markers. Japan's actual spawn/landing target is **20 m along +Z** from that marker, matching its painted aft guide. Preserve the offset rather than moving the whole ship or mission marker.
- Aircraft origin at a ship landing is Y=0; the visible deck surface is approximately **-2.525 m**, matching tyre clearance. Ground/shore landing heights must account for the gear instead of putting the aircraft origin on the surface.

### Bucket and water

- `state.bucket` is the **center of the open rim**, not the bucket bottom. Shared dimensions belong in `src/sim/bucket.ts`; do not duplicate inconsistent constants in render or UI code.
- Current dimensions: body height **1.48 m**, lift point **0.85 m above the rim**, hook **1.76 m below aircraft origin**, maximum sling length **22 m**.
- The rope is a one-sided length constraint: gravity and momentum move the bucket, tension limits its distance when taut, and it can slacken when resting. Avoid snapping the bucket to a permanently vertical offset.
- Ground clearance samples the bucket footprint against the applicable terrain, deck, apron, or pad. Maintain agreement between visible surfaces and simulation heights so neither bucket nor aircraft clips through them.
- Water contact uses the bucket body bottom against the lake surface within its circular boundary. Filling also requires an attached bucket, an explicit fetching action, and sufficiently low horizontal bucket speed; load remains limited by maximum gross mass.
- Released water travels as simulation packets and affects fire on impact. Keep the rendered stream, capacity bar, water mass, and fire response synchronized with that state.
- Keep bucket rigging separate from the aircraft model. Preserve the simple bucket attachment without restoring the removed protruding rods.

### Guidance, input, and collisions

- **Face objective** changes heading only; manual axis input cancels it. **Set return** changes the destination without flying the route. There is no route autopilot or hover-assist control.
- Context actions appear only near their respective zones. A bounded final alignment assist may position the aircraft for that action; do not extend it into automatic travel between objectives.
- The left joystick uses **yaw = -pointer X** and collective/climb = pointer Y after screen-Y normalization. Its knob follows the pointer visually. Keyboard A/D turn left/right; preserve the same direction for focused joystick keyboard controls.
- Reset active inputs on pointer release/cancel/lost capture, pause, blur, visibility changes, and orientation changes. Global shortcuts must not override focused UI controls.
- Unsafe contact with terrain, trees, ships, structures, or water causes an explosion and mission failure. Controlled landings on designated deck/shore areas are explicit exceptions. Fix geometry/contact math rather than disabling collision to hide clipping.
- Rendered terrain and collision use the same triangulated height grid. Trees and structures register colliders from their actual generated placement; keep these aligned when changing models or world generation. Collision caches depend on the `Mission` object identity.

## Rendering and UI conventions

- Reuse the gameplay models for menu fleet views. The portrait renderer is temporary and cached; dispose its GPU resources after capturing the image.
- Dispose replaced scenes, materials, geometry, textures, and listeners. Prefer reuse or instancing to creating objects every frame. Preserve WebGL context-loss recovery.
- Check aircraft changes from the player's rear chase view as well as side view. Preserve the closed, tapered rear and the requested green rear finish; do not reintroduce open-ramp gaps or stray roof/gear shapes.
- Keep equipment names readable without truncation, reserve image dimensions before asynchronous loading, and retain clear next-step mission cues.
- Respect reduced motion, maintain keyboard focus across menu transitions, and keep touch controls usable at phone sizes. Ground crew and gameplay effects should follow simulation time so they freeze when paused.
- Audio unlocks on a user gesture; essential feedback must remain understandable when muted.

## Saves, assets, and deployment

- IndexedDB database `operation-crimson-eagle`, store `checkpoints`, stores campaign-keyed snapshots with save version 1. Progress is separate in `localStorage` under `progress:<campaignId>`.
- Preserve campaign/mission IDs or provide a migration. Selection resumes only the matching non-terminal mission; snapshot saves are serialized to prevent older writes overwriting newer state.
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
- Run the relevant existing checks for a change. For simulation/content changes, run `npm test`; for TypeScript/UI/assets, run `npm run build`. Add regression tests when they verify meaningful behavior rather than merely repeating the implementation.
- For visual or interaction changes, inspect the actual local app at desktop and narrow phone widths. Exercise the affected action, keyboard/touch path, pause/resume, and mission/campaign switching as relevant. Screenshots and automated browser checks do not establish physical-device behavior.
- Check staging with `git diff --cached --check` before committing. Report what changed, what was actually verified, and any remaining limitation without claiming unperformed tests or deployments.

## Reference documentation

- [Research notes](docs/research-notes.md): scenario sources and evidence boundaries.
- [Aircraft](docs/aircraft-geometry-references.md), [ships](docs/ship-geometry-references.md), and [maps](docs/map-geometry-references.md): model and geographic references.
- [Campaign artwork](docs/campaign-artwork.json): current satellite illustration sources and generation prompts.
- [Visual refinement](docs/visual-refinement.md): visual implementation notes.
- [Verification](docs/verification.md) and [status](docs/status.md): dated snapshots, not proof of current checks. Recheck source and tests before repeating their counts or completion claims. Older asset notes may describe superseded artwork.
