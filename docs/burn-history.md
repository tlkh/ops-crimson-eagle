# Burned landscape

Each sortie has deterministic authored fire history, generated from its seed,
fire target and wind. It is a visual composition, not simulated fire spread or
a reconstruction of an actual incident. Damage extends roughly 2–3 target radii
upwind, with uneven lobes, singed edges and irregular unburned islands.

`src/render/burnField.ts` generates one 256×256 linear RGBA field: severity,
age (one means older), active-edge weighting and eligible land. CPU bilinear
samples and GPU texel centers agree. The world builds the field once, excluding
water, protected land-use zones and the actual support-pad/airport footprints.
The airport's 900-metre tree-clearance circle is deliberately **not** a burn
exclusion: two authored fire targets lie within that circle.

The terrain material blends charcoal, ash and singed foliage directly onto the
existing ground, without changing its vertices or adding a decal pass. Damage
is already visible on arrival and does not disappear when the fire cools.
Temporary wetness follows surface-heat decreases and simulation time; it does
not alter the history field. A scene rebuilt from a checkpoint reconstructs the
same damage; transient wetness starts dry.

Existing vegetation samples the same field after seeded placement. Partially
damaged crowns turn brown; heavily damaged crowns give way to one instanced
batch of forked, tapered bare branches. Every original trunk and collider stays
in place across visual tiers. Fire/drop/route exclusions remain clear, so grass
or airport-edge missions can have few or no burned standing trees. No new solid
debris or obstacles are added. Ground-cover tinting uses the same classification.

Active flames and embers stay inside 94% of the original suppression radius.
Their pool is ordered three edge sources to one interior hotspot, preserving
coverage when quality reduces the pool. Older inactive ground can supply sparse
low smoke. Cooling drives steam only on eligible active sites. Securing the fire
removes its flames while retaining terrain and tree damage. Simulation outcomes,
water impacts, saves and world revision are unchanged.

The field uses 256 KiB of texture memory, has no downloaded assets and is disposed
with the ground material. Bare branches use 96 triangles per tree and one extra
draw call; removal of the former ground-scar mesh offsets that call. Branches do
not cast extra shadow passes. Diagnostic counts expose damaged trees, charred
trees and branch triangles. The checked SG-05 scene has 23 damaged trees,
18 charred trees and 1,728 branch triangles.

The development fixture supports `view=burn-trail`, a zero-based `mission`
parameter, and `stage=burning|surface_suppressed|secured`. Its controls can change
fire state without changing production gameplay or writing saves. Use matched
views before/after suppression, both campaigns and low quality to check that
damage persists. Frame timings from this fixture on a desktop are not evidence
of sustained mobile-device performance.

Verification on 2026-10-10: all 170 tests and the production build passed.
Browser checks covered active/secured scars, both campaigns, a night scene,
the airport-adjacent Japan target and 390×844 Battery mode. An SG-01 desktop
browser sample at phone width reported 33.3/33.6 ms frame-interval p50/p95,
13 damaged trees and 9 charred trees; no physical phone was measured.
The production briefing and sortie renderer also loaded cleanly under
`/ops-crimson-eagle/`, with no shader or texture warnings in the checked console.
