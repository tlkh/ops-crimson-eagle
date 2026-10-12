# Campaign geography foundation

Shared, authored road and settlement data lives in `src/content/geography.ts`. Mission objectives, unlocks, aircraft and handling retain their compact-sortie design; map spacing and ambient scenery are authored gameplay geography.

## Coordinates and ownership

Geography uses local gameplay metres: `t` follows the campaign's fixed inland axis and `s` is lateral. `src/content/terrainFrame.ts` keeps its origin fixed at `(0, 0)` and derives its direction and coastline offset from fixed, original campaign axis anchors. Moving the active lake or shore marker cannot rotate or translate the coastline. These are not geographic compass coordinates, surveyed roads, or real settlement layouts. Missions share lake and shore anchors while the ship moves by a few metres and changes heading slightly. Do not derive terrain or scenery placement from the mission's moving ship pose. Deck contact, landing targets and crew use the rotated ship frame instead.

The shared definition supplies village, hamlet, and farmstead centres, six named operational access points, and connected paved, gravel, and dirt routes. Roads carry explicit graph nodes, edges and junction arms; every at-grade crossing must use a shared node. Curves retain exact junction and destination anchors, and duplicate overlapping stems are invalid. Keep the `main-paved`, `sector-access-*` and `response-access-*` identifiers stable because ambient engines and crews consume them.

`src/content/geographySites.ts` supplies field entrances, the coastal working yard and Japan's airbase gates to both the road graph and their renderers. Ordinary rural termini receive a small building cluster and turning space; field, coastal, gate and fire-response ends use their destination assets. Building frontage follows the local road tangent, with doors facing short terrain-following driveways. Accept each building and its access together, leaving woodland gaps between properties. Placement remains deterministic and clear of every mission's flight routes.

## Rendering and safety

`src/render/landUse.ts` consumes the shared network instead of authoring a second set of roads. The world renderer and rendered briefing terrain therefore use the same roads. Road vertices are sampled without moving authored junctions. Junction aprons use incident arm directions and widths, including branches of the same road class. Vegetation exclusions follow the network continuously; road surfaces conform to the rendered terrain, while drainage crossings use bridge decks and approaches with registered structure colliders. Property and driveway clearings stay narrow enough to retain vegetation on both shoulders between buildings.

Each campaign’s lake uses its own unequal lobes and coves. The rendered water, terrain cutout and collision shoreline share `src/sim/lakeShape.ts`; the central circular refill area remains fully inside that outline.

Keep road shoulders clear of refill water and substantial obstacles clear of every mission's flight legs. Changes to solid scenery require a `worldRevision` increment. Existing checkpoint validation checks aircraft and attached-bucket positions against the constructed world, restarting only obstructed checkpoints while retaining campaign progress.

Burn eligibility and vegetation placement query `ExclusionLookup`, a spatial index over the same circular exclusions. Its exact distance checks preserve the clearance margins while avoiding a full scan of the dense road buffers for every generated sample.

World-owned scenery removes its objects before the scene's generic cleanup runs. Its disposal routines must therefore release `InstancedMesh` instance buffers as well as shared geometry and materials, including land-use palms, forest batches, and coastal details.

## Japan airbase

`src/render/airbase.ts` extends the existing Rahadi Oesman support area with an authored perimeter, open checkpoint entrances, support facilities and access roads connected to the shared campaign network. The layout is representative gameplay scenery, not a surveyed reconstruction of the airport.

The airbase uses the shared `src/content/airbaseLayout.ts` frame: local +X points inland and local +Z follows the coastline. The shore pad remains at local `(0, 0)`. Runway, taxiways, fences, gates, lighting, bucket-contact surfaces and collision bounds use this same rotated frame. Vegetation and terrain relief use explicit facility and approach footprints, replacing the former circular 900 m clearance. Fence sections and their colliders must follow the same terrain, stop at entrances, and stay outside the irregular refill shoreline. Access-road buffers exclude trees without making the road or its surrounding terrain immune to burn history.

Both freshwater lakes are 200 m farther inland than the original layout. Each fire retains its original lake-relative direction with 25% greater separation. The road redesign preserves those objectives and the rotated airbase. Singapore's network follows its village, hamlet and agricultural destinations; Japan's coastal collector links the waterfront and open airbase gates to inland settlements. External gate approaches belong to the shared road network, while the airbase renderer owns roads inside its perimeter.

The development graphics preview includes `airbase` and `airbase-facilities` views for the JSDF campaign. `lake-overview` and `road-end` inspect the shoreline and the selected mission's roadside destination. `roads-overview`, `settlement`, `road-junction` and `coastal-access` inspect the connected layout and roadside assets. `destination&site=<destination-id>` targets a shared field entrance or airbase gate. Use these alongside the actual mission screen to check perimeter continuity, road junctions, approach clearance, and visibility at desktop and phone sizes.

## Vegetation and ambient response

Each campaign targets 26,000 woody plants and 7,000 understory instances. Both road shoulders receive tree samples every 32 m, with continuous road and junction clearance checked through a segment spatial index. Singapore favors darker swamp/broadleaf foliage; Japan has lighter secondary growth and more palms. Seeds, trunk positions and colliders stay stable across missions and quality tiers.

Every fire has four hose crew and a staged engine beside its response spur, plus two walking roadside crew. A second engine patrols the main paved road at 5 m/s, follows bridge decks and ramps, and turns at the ends. `src/sim/fireResponse.ts` supplies the shared simulation-time poses and engine collision bounds; `src/render/fireResponse.ts` draws the instanced people, vehicles and short hose streams. Hose work stops when the fire is secured while roadside patrols continue. These visuals do not suppress the fire or affect scoring.

World construction reserves all six response sites and complete walker paths before planting vegetation, so changing missions does not move trees. Engine collision queries stay inactive for unprepared custom missions. Preview scenes initialize visible actors at time zero; the `fire-crews` and `road-traffic` fixtures inspect close details, pause behavior and quality tiers.

## Verification

Geography tests cover network connectivity and land/lake clearance. Land-use tests cover rendered roads, bridges, obstacle clearance, and consistency across missions. Run the full simulation suite and production build after changes, and inspect the actual scene at flight altitude and in a narrow viewport. Browser screenshots do not establish physical-device performance.

### 10 October 2026 verification

The mission-variation update passed 210 tests and the TypeScript/Vite production build. A browser fixture constructed the rendered world and flew all 12 sorties with the test-only pilot; all completed in 168–277 simulated seconds. Desktop and 390 × 844 browser checks covered mission summaries, the removed heading button, lake outlines, road-end clusters and airbase access. Keyboard pause/resume and radio toggles worked, and the 25 m/55 m recordings loaded and decoded. These are local browser checks, not physical-device or deployment verification.

### 11 October 2026 scenery verification

The combined workspace passed 243 tests (`npm test -- --maxWorkers=3`) and the TypeScript/Vite build. The existing bundle-size warning remains. A local browser constructed each mission's complete world and flew all 12 with the test-only pilot: every sortie succeeded in 181.8–298.1 simulated seconds, with 1,226.7 kg or more fuel remaining. This included the generated terrain, vegetation, structures and ambient engine colliders.

Desktop and 390 × 844 browser checks covered both campaign menus, rendered briefing maps, launch, pointer joystick input, and keyboard pause/resume under `/ops-crimson-eagle/`. Daylight fixtures showed both foliage palettes, the rotated airbase, response crews and road traffic; Battery graphics retained the people, engines and visible tree trunks. Paused fixture time stayed at 30.0 seconds and advanced after resume. These checks used a local browser, not a physical phone or a deployed site. Temporary captures are in ignored `output/playwright/`.

### 11 October 2026 road layout verification

The subsequent road redesign passed all 263 tests in 50 files with `npm test -- --maxWorkers=3`, plus the TypeScript/Vite production build. Checks cover explicit crossing nodes, connected destinations, 30° minimum junction angles, four-arm limits, all seven rendered fields per campaign, paired building/driveway placement, open airbase gates, continuous vegetation clearance, and terrain-conforming junction surfaces. The existing bundle-size warning remains.

A fresh browser run constructed each complete mission world and flew all 12 sorties with the test-only pilot. Every sortie succeeded in 181.8–298.1 simulated seconds with at least 1,226.7 kg fuel remaining. Desktop and 390 × 844 local browser checks covered campaign switching, briefing maps, launch, pointer input, and keyboard pause/resume. Close views checked both campaigns' hamlets, the simplified Japan village junction, field access, coastal yard, and seaward/northern airbase gates. This verifies local browser behavior, not deployment or physical-phone performance. World revision 8 and service-worker cache v23 cover the new solid scenery.
