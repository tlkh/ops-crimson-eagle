# Map geometry reference review

Reviewed 10 October 2026. Implemented across `src/render/world.ts`, `groundSurface.ts`, `vegetation.ts`, `landUse.ts`, `coastalDetails.ts`, `distantScenery.ts`, and the shared terrain collision code.

## Evidence used

- [Central Kalimantan provincial tourism office: Bangkal and Danau Sembuluh](https://visit.kalteng.go.id/kawasan-desa-adat-bangkal-dan-danau-sembuluh/) describes a large lake landscape, surrounding settlements, fishing, local motorboats and sandy shore sections. It reports a 7,832.5 ha lake and a 35.68 km length. Those dimensions emphatically do not describe the game's 195 m Singapore refill radius. The revised scene uses modest stilt-floor homes, gabled roofs, a timber jetty, long motorboats and broken sand/reed-coloured lake margins as setting cues.
- [CIFOR: Ketapang Community Carbon Pools](https://www2.cifor.org/redd-case-book/case-reports/indonesia/ketapang-community-carbon-pools-west-kalimantan-indonesia/) describes secondary lowland peat swamp forests downstream of the Pesaguan and mineral-soil dipterocarp forests upstream. This supports low relief and broadleaf forest rather than mountain terrain or conifer silhouettes.
- [CIFOR: carbon stocks in Pematang Gadung](https://www.cifor-icraf.org/publications/pdf_files/Papers/PBasuki1601.pdf) places a coastal peat dome between the Pawan and Pesaguhan rivers. It informs the scene's flat peat landscape and drainage corridor; the rendered channel is not a traced or named real river.
- [Indonesia DGCA: Rahadi Oesman airport](https://hubud.kemenhub.go.id/bandara/56) lists a 60 × 30 m concrete helipad and asphalt apron. The authored shore waypoint now has a matching-size concrete working pad, connecting pavement and small service building. The second pass also uses its 224 × 51 m apron, 30 m runway width, two taxiway connections and terminal/control-tower cues. The runway length is compressed to 1,000 m from the verified 1,400 m listing (1,650 m built). Airport placement/orientation, building shapes and apron arrangement remain authored, not surveyed.

- [NASA: Heavy Smoke Blankets Borneo](https://science.nasa.gov/earth/earth-observatory/heavy-smoke-blankets-borneo-86847/) documents smoke from Borneo peat fires in October 2015. It informs the warm distant haze and softened horizon; neither campaign asserts this archived weather occurred on its authored 2026 mission dates.
- [NParks: Rhizophora apiculata](https://www.nparks.gov.sg/florafaunaweb/flora/3/2/3265) and [Cocos nucifera](https://www.nparks.gov.sg/florafaunaweb/flora/5/6/5618) inform the mangrove roots and palm fronds. The models are simplified regional cues, not species-level reconstructions.

## Current map implementation

- A shared 192 × 224 triangulated height grid drives the visible terrain and collision interpolation. Inland relief rises into broad rolling hills, up to roughly 60 m, while route shoulders, every fire zone, the refill lake, airport, and drainage corridor blend back to safe lowland heights.
- Three small generated ground patterns blend between grass, dark peat and pale sand. Biome colour and texture shift near the coast, lake and drainage channel without external image downloads.
- Seeded, instanced woodland places up to 20,000 collidable woody plants across six broad visual types: spreading broadleaf, emergent, secondary, swamp, coastal and palm. Understory, reeds, prop roots and fronds add smaller-scale structure. A reduced rendering tier preserves every tree and its collider while using simpler crowns.
- Curving roads and tracks, a drainage bridge, field and orchard patches, a hamlet, village, farmsteads and palm grove create several forms of settlement. Generated solid structures and woody trunks register collision bounds; open roads and crop surfaces do not.
- The intertidal slope now includes grouped mangroves, scrub, a shore yard, boat shed, fences and a path toward inland use. The authored lake remains fully usable at its simulation radius and keeps its irregular decorative edge.
- The Japanese shore waypoint retains the representative Rahadi Oesman apron, runway and service buildings. Two distant inland ridge layers and a low Japanese port skyline supply subtle world-anchored depth; they have no gameplay collision.
- Fixed campaign seeds keep land cover consistent between sorties. Route and objective clearances protect all twelve missions, and all generated solid obstacles feed the simulation's existing collision checks.

## Accuracy and gameplay limits

These are reference-informed regional compositions, not GIS terrain or photogrammetry. No terrain DEM, surveyed road or settlement plan, lake outline, real fire polygon, ship anchorage or actual helicopter dip permission is asserted. The roads, farms, skyline and ridges are invented scenery; the latter suggest distance rather than a mapped mountain range. Coastline, drainage, lake and settlement arrangement remains authored, and gameplay distances stay compressed for roughly five-minute sorties. The Singapore lake is a small Sembuluh-inspired sector, not a scale model of the whole lake; the Ketapang freshwater lake is reconstructed gameplay scenery. Content evidence labels remain unchanged.

Freshwater stays at y=0.025 m and the operational landing surfaces retain their simulation heights. The coast descends to the existing y=-9 m sea level. Collision uses the terrain mesh's triangle heights and the actual generated tree/structure placements. Physical phone GPU profiling remains unverified; desktop and narrow-browser checks do not establish device performance.
