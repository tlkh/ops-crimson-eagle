# Implementation status — 9 October 2026

## Built

- Two selectable campaigns and twelve authored missions, with success-gated progression.
- Distinct Singapore deck and Japan shore-handling paths, each with next-step mission cues and a full ship-return outcome.
- Fixed-step flight, swinging sling, progressive lake fill, timed full dump, water-impact ledger, fuel, surface/peat heat and ground-crew securing.
- Reference-informed procedural Chinook, Persistence and Kunisaki geometry, Indonesian lowland scenery with varied broadleaf/mangrove/palm tree forms, bucket and fire; touch and keyboard controls; tactical map, pause, debrief and generated audio. Aircraft, ship and map accuracy boundaries are documented separately.
- Campaign-scoped IndexedDB checkpoints, interruption pause, static production build with relative asset paths and a basic offline shell cache.
- A simplified generated title mark, opaque install icons and two illustrative campaign images. The menu and flight HUD have larger readable targets, a closer-fit tactical map, keyboard-contained pause/debrief dialogs and portrait camera framing.

## Verified

- `npm test`: 41 passing tests, including test-only manual-style completion of all twelve mission scenarios in at most five simulated minutes with at least 500 kg fuel at landing, proximity actions, yaw-only facing, a visible shoreline clearance check, and the marked JGSDF deck start/recovery.
- `npm run build`: passes TypeScript and Vite production build.
- Production preview: both campaign menus and a mission scene loaded in the in-app browser; Singapore deck rigging and Japanese shore rigging, lake fill and a useful drop were observed in the browser. After stopping the preview server, the cached shell reopened and both campaigns launched offline.
- Simulated 844 × 390 landscape and 390 × 844 portrait layouts were visually checked. The local production preview reloaded after an offline-cache update.
- The integrated geometry build passed all 31 tests and production build; both Singapore and Japan scenes loaded in the browser with the revised aircraft, closed tapered tail, campaign paint, coast and forest visible.
- Both revised ship launch decks loaded in the browser. A visible aircraft/deck intersection was corrected by aligning the deck surface with the landing tyres; the latest visual pass also checked both vessels from oblique exterior views.
- The focused tree pass passed all 31 tests and the production build; both theatre views loaded without console errors. The Singapore flight view shows darker, less uniform crowns and trunks, and the Japanese shore approach shows the revised forest belt.
- The UI pass passed all 31 tests and the production build. The in-app browser was checked at 722 × 988, 390 × 844, 320 × 568 and 844 × 390; the campaign menu, training scene, tactical map and pause flow were inspected. Escape returned focus to Pause after closing the dialog. Physical installed-app behavior remains unverified.
- The latest JGSDF pass starts and recovers on Kunisaki's marked aft guide, paints the tapered rear and pylon solid green, and replaces fast-flight blade streaks with a swept disc. A fresh deck start was checked in a separate browser origin, with no console warnings or errors.
- The four apparent roof rods were the shore bucket's support straps rendered at the helicopter. Fresh and saved JGSDF sorties now place the unattached bucket at its shore handling site. The roof was clear in the production preview after rebuilding and reloading; all 32 tests and the build passed.
- Rotor blur uses a darker feathered disc with curved sweep marks. Both discs were visibly legible in the JGSDF deck preview, with no console errors; all 32 tests and the production build passed.
- The mission HUD now names the next step and distance. Attach, fetch and release controls appear only on final approach; a tap can make a short local correction. Face objective turns yaw without flying the route, Return selects a destination, and hover assist is removed. A fresh Singapore deck start and post-attachment cue were inspected at desktop and portrait width. All 35 tests and the production build pass.
- The bucket sling now uses a dimensional high-contrast cable anchored to the modeled belly hook, with chase framing that keeps the hanging load clear of the center action controls. The HUD gives the bucket's vertical and horizontal offset in flight or its range at the Japanese shore pad; the tactical map marks the bucket in both places. Singapore's attached flight view and Japan's shore pickup cues were visually checked in the local production preview.
- Terrain, tree and palm instances, ship hull/rail/superstructures, sea/lake surfaces and major settlement/airport structures now have collision checks. Unsafe contact fails the sortie and triggers a timed explosion before the debrief; terrain impact clamps the aircraft above the triangulated visible surface. Controlled marked deck and shore contacts remain valid. The collision suite and all twelve full-route tests pass (41 total tests); a hard ship-deck impact and failure dialog were checked in the desktop preview.

- The water/ship/atmosphere pass adds 512-pixel planar reflections refreshed only for the active water surface, wind-driven wave normals and glints, subtle hull waterline disturbance, height-dependent twin-rotor wash and bucket-contact ripples. Ships have flared station hulls, following waterline paint, weathered deck/hull maps and refined upperworks. Four instanced fire particle draws provide smoke, flames, embers and cooling steam; clouds, local downwind haze and aircraft-following shadows complete the scene. Both ship exteriors, sea/lake hover effects, fire and suppression were visually checked in temporary views; both campaign launch views were checked, including the final JGSDF production build. All 41 tests and the production build pass.

## Remaining release validation and depth

- No physical iPhone or Android sustained-play measurements, thermal data or two-thumb human playtest are recorded.
- The browser check did not fly an entire sortie from launch to debrief; the full loops are covered by deterministic simulation tests.
- Fire is currently a compact mission-area heat model, not the brief's sparse 10 m multi-cell spread grid. Water uses packet impacts and a conservation ledger, without a detailed terrain-cell footprint.
- Offline caching is a common static shell cache. Independent campaign downloads, cache-completeness labels, export/import saves and versioned save migration are not implemented.
- No external asset licence dependency exists; procedural graphics and generated audio can be further refined after phone performance testing.
- The terrain is a compressed, reference-informed composition, not surveyed GIS geography; the aircraft is a photo-based game model, not manufacturer CAD.
