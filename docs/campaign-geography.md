# Campaign geography foundation

Phase one of the campaign progression work introduces shared, authored road and settlement data in `src/content/geography.ts`. It does not change mission objectives, unlocks, aircraft, handling, or fire locations.

## Coordinates and ownership

Geography uses local gameplay metres: `t` follows the campaign's ship-to-inland axis and `s` is lateral. The first mission supplies the fixed reference frame. These are not geographic compass coordinates, surveyed roads, or real settlement layouts. All current missions in each campaign share the same ship, lake, and shore anchors; preserve that invariant when extending content.

The shared definition supplies existing village, hamlet, and farmstead centres, six named operational access points, and connected paved, gravel, and dirt routes. Sector access points reserve the foundation for later sector-specific assets; the full new building/vegetation families and revised mission mechanics belong to subsequent phases.

## Rendering and safety

`src/render/landUse.ts` consumes the shared network instead of authoring a second set of roads. The existing world renderer and rendered briefing terrain therefore use the same roads. Road vertices are sampled without moving authored junctions. Vegetation exclusions follow the network continuously; road surfaces conform to the rendered terrain, while drainage crossings use bridge decks and approaches with registered structure colliders.

Keep road shoulders clear of refill water and substantial obstacles clear of every mission's flight legs. Changes to solid scenery require a `worldRevision` increment. Existing checkpoint validation checks aircraft and attached-bucket positions against the constructed world, restarting only obstructed checkpoints while retaining campaign progress.

Burn eligibility and vegetation placement query `ExclusionLookup`, a spatial index over the same circular exclusions. Its exact distance checks preserve the clearance margins while avoiding a full scan of the dense road buffers for every generated sample.

World-owned scenery removes its objects before the scene's generic cleanup runs. Its disposal routines must therefore release `InstancedMesh` instance buffers as well as shared geometry and materials, including land-use palms, forest batches, and coastal details.

## Verification

Geography tests cover network connectivity and land/lake clearance. Land-use tests cover rendered roads, bridges, obstacle clearance, and consistency across missions. Run the full simulation suite and production build after changes, and inspect the actual scene at flight altitude and in a narrow viewport. Browser screenshots do not establish physical-device performance.
