# Campaign geography foundation

Phase one of the campaign progression work introduces shared, authored road and settlement data in `src/content/geography.ts`. It does not change mission objectives, unlocks, aircraft, handling, or fire locations.

## Coordinates and ownership

Geography uses local gameplay metres: `t` follows the campaign's fixed inland axis and `s` is lateral. `src/content/terrainFrame.ts` keeps its origin fixed at `(0, 0)` and derives its direction from the shared shore or lake anchor. These are not geographic compass coordinates, surveyed roads, or real settlement layouts. Missions share lake and shore anchors while the ship moves by a few metres and changes heading slightly. Do not derive terrain or scenery placement from the mission's moving ship pose. Deck contact, landing targets and crew use the rotated ship frame instead.

The shared definition supplies existing village, hamlet, and farmstead centres, six named operational access points, and connected paved, gravel, and dirt routes. Sector spurs lead to small roadside staging clusters beyond the fire approaches. Unshared road ends are identified against every other road segment, so a branch joining the middle of a road is treated as a junction. Existing settlement ends retain their clusters; other termini receive paired rural buildings within 70 m, connected by short burnable driveways. Keep their placement deterministic and clear of all missions’ flight routes.

## Rendering and safety

`src/render/landUse.ts` consumes the shared network instead of authoring a second set of roads. The existing world renderer and rendered briefing terrain therefore use the same roads. Road vertices are sampled without moving authored junctions. Vegetation exclusions follow the network continuously; road surfaces conform to the rendered terrain, while drainage crossings use bridge decks and approaches with registered structure colliders.

Each campaign’s lake uses its own unequal lobes and coves. The rendered water, terrain cutout and collision shoreline share `src/sim/lakeShape.ts`; the central circular refill area remains fully inside that outline.

Keep road shoulders clear of refill water and substantial obstacles clear of every mission's flight legs. Changes to solid scenery require a `worldRevision` increment. Existing checkpoint validation checks aircraft and attached-bucket positions against the constructed world, restarting only obstructed checkpoints while retaining campaign progress.

Burn eligibility and vegetation placement query `ExclusionLookup`, a spatial index over the same circular exclusions. Its exact distance checks preserve the clearance margins while avoiding a full scan of the dense road buffers for every generated sample.

World-owned scenery removes its objects before the scene's generic cleanup runs. Its disposal routines must therefore release `InstancedMesh` instance buffers as well as shared geometry and materials, including land-use palms, forest batches, and coastal details.

## Japan airbase

`src/render/airbase.ts` extends the existing Rahadi Oesman support area with an authored perimeter, open checkpoint entrances, support facilities and access roads connected to the shared campaign network. The layout is representative gameplay scenery, not a surveyed reconstruction of the airport.

The airbase uses the existing apron frame: local X runs across the runway and local Z follows it. Preserve the shore pad at local `(0, 0)` and the existing runway and taxiways. Fence sections and their colliders must follow the same terrain, stop at entrances, and stay outside the irregular refill shoreline. Access-road buffers exclude trees without making the road or its surrounding terrain immune to burn history.

The development graphics preview includes `airbase` and `airbase-facilities` views for the JSDF campaign. `lake-overview` and `road-end` views inspect the shoreline and the selected mission’s roadside destination. Use these alongside the actual mission screen to check perimeter continuity, road junctions, approach clearance, and visibility at desktop and phone sizes.

## Verification

Geography tests cover network connectivity and land/lake clearance. Land-use tests cover rendered roads, bridges, obstacle clearance, and consistency across missions. Run the full simulation suite and production build after changes, and inspect the actual scene at flight altitude and in a narrow viewport. Browser screenshots do not establish physical-device performance.

### 10 October 2026 verification

The mission-variation update passed 210 tests and the TypeScript/Vite production build. A browser fixture constructed the rendered world and flew all 12 sorties with the test-only pilot; all completed in 168–277 simulated seconds. Desktop and 390 × 844 browser checks covered mission summaries, the removed heading button, lake outlines, road-end clusters and airbase access. Keyboard pause/resume and radio toggles worked, and the 25 m/55 m recordings loaded and decoded. These are local browser checks, not physical-device or deployment verification.
