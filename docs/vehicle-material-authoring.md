# Aircraft and ship surface maps

Aircraft and ship surface maps are procedural CanvasTextures authored in
`src/render/aircraft.ts` and `src/render/ships.ts`. They use no copied or
downloaded imagery, so there are no external image licences or source URLs.

The aircraft atlas keeps the existing RSAF olive-grey and JGSDF three-colour
paint patterns and the closed solid-green aft finish. Fine panel joins,
fasteners, access panels, subdued paint variation and exhaust soot are painted
into the colour map; normal, roughness and ambient-occlusion maps add restrained
surface breakup. Cockpit panels remain opaque dark glass with moderate
metalness, allowing the prefiltered scene environment to add broad highlights
without transmission or refraction.

Ship hull and flight-deck maps are seeded, so each campaign renders consistently.
Their colour maps add subtle plate joins and weathering, while separate normal,
roughness and AO maps pick up welds and non-slip deck plates. The deck guide
markings and hull numbers remain on their established geometry and are not
baked into the material maps.

The prefiltered reflection skies in `src/render/environmentLighting.ts` are
generated at runtime from four authored shader palettes (night, dawn, day and
dusk). They do not use HDRI files or external artwork. PMREM generation runs
once for a renderer. As mission lighting changes, a reusable fullscreen pass
blends those linear CubeUV atlases continuously; it runs only when the blend
weights change meaningfully. Reflection intensity and azimuth follow mission
lighting as well, without capturing the scene again.
