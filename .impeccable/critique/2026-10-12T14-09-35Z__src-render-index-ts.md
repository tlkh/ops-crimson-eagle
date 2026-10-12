---
target: Review 3D game visuals toward AAA Ace Combat presentation
total_score: 13
max_score: 20
na_heuristics: 3,5,7,9,10
p0_count: 0
p1_count: 3
target_identity: "file:/Users/tlkh/GitHub/operation-crimson-eagle/src/render/index.ts"
target_fingerprint: "sha256:f7de92c1dedac55b38ab8360b7808d8b95ff1e2abaadf2403b1bc3553e910d78"
target_path: /Users/tlkh/GitHub/operation-crimson-eagle/src/render/index.ts
timestamp: 2026-10-12T14-09-35Z
slug: src-render-index-ts
---
Method: dual-agent (A: gpt_6_sol_visual_direction · B: gpt_6_luna_render_evidence), with main-agent live inspection and synthesis.

# Ops Crimson Eagle — 3D visual review

Reviewed 12 October 2026. Scope: current local Three.js game, both campaigns, High-quality deck, lake, forest, fire, ship and night fixtures. The target is an Ace Combat-inspired presentation adapted to low-altitude helicopter firefighting and browser/mobile constraints. No gameplay or renderer changes were made.

## Verdict

The game has a capable rendering foundation, but currently reads as a procedural flight prototype. The largest gap is coherent art direction and environmental scale. Haze, water reflections, textured materials and cinematic processing already exist; adding more effects without reshaping their appearance will produce limited gains.

Bandai Namco's official Ace Combat 8 page emphasizes layered cloudscapes and detailed aerial presentation: https://www.bandainamcoent.com/games/ace-combat-8 . This is a visual reference, not a promise of console parity or a recommendation to change engine.

## Strengths

- Recognizable campaign-specific aircraft and ships, deck markings, sling geometry, and connected mission geography give the game a specific identity.
- Time-of-day lighting, environment maps, water reflections, terrain/vehicle textures, burn history and quality tiers already form a useful foundation.
- The helicopter, bucket and task locations remain readable, an important constraint for further visual work.

## Prioritized improvements

### P1 — Forest and ground scale

Observed daylight forest views show repeated small crowns and long thin trunks over large smooth green areas. Roads read as pale strips. Terrain and canopy do not provide enough intermediate-scale detail to sell low-altitude flight.

Build several crown silhouette families and denser-looking canopy clusters around existing trees. Combine broad habitat color patches, medium-scale soil/grass transitions, near surface detail, and localized canopy/contact darkening. Use varied tree heights and understory outside flight and landing clearances. Preserve seeded placement and colliders; any newly solid objects require matching collision. Do not add distant mountains inconsistent with the setting simply to imitate a fighter-jet game.

Entry points: src/render/vegetation.ts:224 (near/mid/far crown shapes), src/render/groundSurface.ts, src/render/landUse.ts, src/render/distantScenery.ts. Far crown geometry currently reduces to one shared rounded cluster at vegetation.ts:251.

### P1 — Aircraft framing and material readability

Observed deck and lake views make the helicopter relatively small and dark against a very large water/ground plane. Material detail contributes little at this framing. Broadside ships also become dark silhouettes.

Tune transit framing to show more horizon and stronger aircraft presence, with separate smoothly blended working/landing framing that keeps the full sling and contact point readable. Preserve stable, precise controls. Tune sky/ground fill and sun separation first. Follow with a carefully authored aircraft mesh and UV set: panel scale, roughness variation, seals, exhaust discoloration, cabin depth, rotor hubs, convincing glass, and restrained wear. Keep exact aircraft proportions, liveries and landing geometry. Do the same selectively for the ship deck and superstructure seen during approach.

Entry points: src/render/index.ts:300-325 (44 m chase distance, downward bucket aim, 53–62° FOV), aircraft.ts, ships.ts and vehicle material helpers.

### P1 — Lighting and atmosphere hierarchy

Observed daylight frames have similar muted green/grey values in aircraft, terrain and haze. Clouds provide limited volume. Night retains readable deck markings but broad areas merge into darkness.

Author a small set of mission lighting looks: humid morning, directional daylight, late-afternoon smoke, and controlled night recovery. Keep near subjects clear while layering haze into distance. Balance sun, ambient and environment lighting as a unit. Give cloud masses brighter edges and darker interiors; add restrained moving cloud shadowing. Try richer layered impostors first; reserve a measured low-resolution volumetric experiment for desktop High. Preserve tropical geography and simulation-time transitions.

Entry points: src/render/timeOfDay.ts, atmosphere.ts, heightFog.ts, environmentLighting.ts, nightLighting.ts. Current height fog can blend up to .48 (heightFog.ts:7); this is a tuning lever, not by itself a diagnosed bug.

### P2 — Water and firefighting effects

Observed sea views show conspicuous repeated bright wave ridges. Lake and sea need clearer differences in apparent wave scale. Fire appears as separated flame cards over a broad uniform scar, with simple smoke shapes.

Calm the lake, break up directional sea highlights and damp distant specular intensity. Improve shore depth/color transitions and make rotor wash a localized, broken pattern. Cluster flame sizes along irregular active edges, improve smoke density and wind shear, and add grounded char/ember transitions. Strengthen the water-drop sequence with stream breakup, impact mist, wet darkening and localized steam. Existing simulation packets and burn state must continue to drive all effects. Do not expand actual flame activity beyond the suppression radius or let cooling erase burn history.

Entry points: src/render/water.ts, fire.ts, bucket.ts and proximityParticles.ts.

### P2 — Motion and final image quality

Flight RPM still draws fully opaque blades alongside the blurred rotor disc (src/render/index.ts:280-292), making spinning blades visibly strobe in sampled frames. The cinematic pass applies edge blur and vignette; it is not a full temporal image-quality solution.

Prototype an RPM-dependent transition toward swept blade arcs/discs while preserving visible slow blades during handling. Test the change in motion rather than approving a still. Reduce gratuitous edge softness; establish stable edges and terrain texture filtering first. Consider restrained highlight bloom and localized contact shadows only after the look is established. High currently shares a 1440-pixel long-edge scene cap (quality.ts:29-32); an opt-in sharper desktop tier can be evaluated after profiling.

## Delivery order

1. Polish one representative 30-second sequence: deck departure, low flight, lake pickup, and fire drop. Establish reference stills for dawn, daylight and night. Tune framing, exposure, haze, wave contrast and rotor appearance before expanding geometry.
2. Improve the aircraft and visible ship surfaces; rebuild canopy and terrain variation. Compare the same captures before and after.
3. Upgrade smoke, flames, water impact and desktop atmospheric depth, with bounded quality tiers.
4. Roll the approved look across both campaigns and test actual phone hardware. Preserve 60 Hz simulation, pause behavior, physical visibility/collision agreement, disposal and reduced motion.

The existing scene already reports millions of submitted triangles and hundreds of draws across passes. Live readings varied with view and reflection/shadow updates. They are not a sustained benchmark, and running several review tabs can affect timing. Do not attach a blanket performance promise to these recommendations. Target sustained 60 FPS desktop and 30 FPS mobile, and budget upgrades using GPU/frame-time captures on actual target devices.

## Scoped heuristic assessment

This is a 3D visual Experience review, not a full gameplay/usability audit. 0–4 scores describe the inspected visual presentation only.

| Heuristic | Score | Evidence |
| --- | --- | --- |
| Visibility of status | 3 | Bucket, flames and day/night changes are visibly legible; no full HUD audit. |
| Match to real world | 2 | Aircraft/ship identity is specific; forest, fire and water scale weaken realism. |
| User control | n/a | Full flight interaction not exercised. |
| Consistency | 3 | Campaigns share coherent rendering and identifiable equipment. |
| Error prevention | n/a | Not a flight-safety test. |
| Recognition | 3 | Main mission objects are recognizable. |
| Efficiency | n/a | Not an input/workflow audit. |
| Aesthetic hierarchy | 2 | Subject/background separation and terrain detail are weak. |
| Error recovery | n/a | Not evaluated. |
| Help/documentation | n/a | Outside visual scope. |
| Total | 13/20 | Visual rubric only; not an AAA quality score. |

## Independent evidence and audience checks

The automated design detector returned two UI-only findings and zero rendering findings. The selected-mission stripe is intentional state feedback; the flagged image receives its src dynamically. Neither supports a 3D graphics defect. Browser inspection and source inspection supplied the substantive evidence. A static design detector cannot judge Three.js material or atmospheric quality.

An action-game player will notice sparse landscape detail and weak aircraft prominence first. A phone player needs stable frame pacing and a readable bucket contact point more than an expensive volumetric pass. A player sensitive to motion needs restrained camera movement, no compulsory shake and preserved reduced-motion behavior.

The proposal leaves full gameplay usability, physical-device performance, temporal aliasing measurement and complete sortie testing as implementation acceptance work. No automated tests or production build were run for this review.
