# Map geometry reference review

Reviewed 9 October 2026. Implemented in `src/render/world.ts` and `src/render/atmosphere.ts`.

## Evidence used

- [Central Kalimantan provincial tourism office: Bangkal and Danau Sembuluh](https://visit.kalteng.go.id/kawasan-desa-adat-bangkal-dan-danau-sembuluh/) describes a large lake landscape, surrounding settlements, fishing, local motorboats and sandy shore sections. It reports a 7,832.5 ha lake and a 35.68 km length. Those dimensions emphatically do not describe the game's 195 m Singapore refill radius. The revised scene uses modest stilt-floor homes, gabled roofs, a timber jetty, long motorboats and broken sand/reed-coloured lake margins as setting cues.
- [CIFOR: Ketapang Community Carbon Pools](https://www2.cifor.org/redd-case-book/case-reports/indonesia/ketapang-community-carbon-pools-west-kalimantan-indonesia/) describes secondary lowland peat swamp forests downstream of the Pesaguan and mineral-soil dipterocarp forests upstream. This supports low relief and broadleaf forest rather than mountain terrain or conifer silhouettes.
- [CIFOR: carbon stocks in Pematang Gadung](https://www.cifor-icraf.org/publications/pdf_files/Papers/PBasuki1601.pdf) places a coastal peat dome between the Pawan and Pesaguhan rivers. It informs the scene's flat peat landscape and drainage corridor; the rendered channel is not a traced or named real river.
- [Indonesia DGCA: Rahadi Oesman airport](https://hubud.kemenhub.go.id/bandara/56) lists a 60 × 30 m concrete helipad and asphalt apron. The authored shore waypoint now has a matching-size concrete working pad, connecting pavement and small service building. The second pass also uses its 224 × 51 m apron, 30 m runway width, two taxiway connections and terminal/control-tower cues. The runway length is compressed to 1,000 m from the verified 1,400 m listing (1,650 m built). Airport placement/orientation, building shapes and apron arrangement remain authored, not surveyed.

- [NASA: Heavy Smoke Blankets Borneo](https://science.nasa.gov/earth/earth-observatory/heavy-smoke-blankets-borneo-86847/) documents smoke from Borneo peat fires in October 2015. It informs the warm distant haze and softened horizon; neither campaign asserts this archived weather occurred on its authored 2026 mission dates.

## Implemented geometry

- A gently irregular coast with a sloped muddy intertidal transition to the sea; mottled lowland terrain, with subtle procedural ground grain.
- A lobed, asymmetrical lake and narrow earthy shore rather than concentric circles. The complete simulation refill disc remains visible water; extra shoreline lobes are decorative.
- A separate sinuous drainage corridor with muddy banks, plus a low coastal tree belt.
- Clustered broadleaf swamp canopies at several heights with clearings, replacing pointed conifer-like crowns. Approximately 11,500 trees use four instanced draws after the focused tree pass; coastal prop roots use one additional draw. There are no per-tree shadows.
- A compact linear settlement of raised homes with gabled roofs, connecting track, timber jetty and motorboats. All buildings/boats are authored, not replicas of identified properties.
- A representative airport around the existing Japanese campaign shore waypoint: concrete helipad, asphalt apron and runway, threshold/edge/centerline markings, two taxiway links, low terminal with shaded glazing and name sign, compact tower and service/rescue facilities. None blocks the operational helipad.
- Off-route low-amplitude 3D terrain undulations, flattened around all flight legs, fire/lake objectives and the airport. This gives depth without inventing a mountain range in coastal peat country.
- Four additional instanced vegetation draws: low scrub, waterside reeds, slender palm trunks and radial drooping fronds. These are regional visual categories, not a botanically surveyed inventory.
- World-space moving water normal ripples on sea and freshwater; water geometry stays at its original simulation heights.
- A gradient sky dome with a sun disc and aureole, a single instanced draw of soft cloud groups, slow drift, and distinct blue-green Singapore-theatre humidity / warmer Japanese-theatre smoke haze. Clouds and weather are illustrative.
- Fixed per-theatre random seeds keep land cover coherent across missions. Trees avoid every authored fire sector, the lake, river, settlement and shore handling area.
- Visual clearances along all authored flight legs keep tall, non-colliding trees out of the guided camera path; shorter growth remains near its edges.

## Accuracy and gameplay limits

These are reference-informed regional compositions, not GIS terrain or photogrammetry. No terrain DEM, satellite imagery, surveyed lake outline, real fire polygon, ship anchorage or real helicopter dip permission is asserted. Coastline/river/lake/settlement arrangement is authored; distances stay compressed so all missions retain their five-minute target. The Singapore lake is a small Sembuluh-inspired sector, not a scale model of the entire lake; the Ketapang freshwater lake is reconstructed gameplay scenery. Content evidence labels remain unchanged.

Freshwater is at y=0.025 m and operational ground stays roughly 0.4–0.6 m below the simulation's y=0 surface. Cosmetic coastal slopes descend to the existing y=-9 m sea level. Trees and buildings remain non-colliding scenery. A follow-up gameplay correction reduced the Singapore/Japan refill radii to 195/180 m and moved fictional fire sectors onto land beyond the visible shoreline. All twelve sorties finish within five minutes with the required fuel reserve under a scripted test-only pilot; the game itself offers manual controls plus short local alignment at action zones.

TypeScript and production build passed before integration. Root integration should rerun the mission suite and inspect both theatres in the browser. Mobile hardware profiling is still required.

## Second-pass validation and integration

`npm run build` passes (TypeScript and Vite). Call `world.update(timeSec, camera.position)` each render frame for ripple/cloud animation and sky recentering. Ground relief is cosmetic away from flight corridors; scenery remains non-colliding. Added vegetation and clouds use instancing rather than per-plant meshes. The focused tree pass uses about 1,150,000 crown triangles plus 391,000 wood triangles at the full 11,500-tree count, so physical mobile GPU profiling remains necessary. The airport structures add draw calls but no texture downloads. All texture grain/cloud/surface detail is original procedural content; referenced photographs are not redistributed. Root integration must inspect WebGL shader compilation and both theatre views in browser.


## Focused tree refinement

The third vegetation pass replaces the single ellipsoid crown with three shared templates: spreading lowland broadleaf, narrower vertically layered swamp canopy, and compact coastal crowns. Each template combines five uneven foliage masses, with small coherent silhouette perturbations and darker lower foliage. Visible three-way forks now support the crown. Heights, crown proportions, yaw and modest stand-level green variation break up repeated trees while retaining the established clearances and deterministic seed. These remain regional illustrative forms rather than individual species replicas.

References consulted:

- [NParks: Rhizophora apiculata](https://www.nparks.gov.sg/florafaunaweb/flora/3/2/3265): erect coastal mangrove form, dark bark, conical crown and conspicuous stilt roots. The compact coastal belt now has four sloping prop roots per tree where the bounded instance budget permits. Real mature mangroves can grow taller; the game retains shorter coastal vegetation for visibility.
- [NParks: Cocos nucifera](https://www.nparks.gov.sg/florafaunaweb/flora/5/6/5618): slender trunk and long pinnate fronds with ascending, spreading and drooping forms. The palm geometry now uses a bowed row of separated paired leaflets instead of four-vertex solid paddles. Twelve leaflet pairs are a deliberate distant-view simplification, not the real leaflet count.
- The existing CIFOR Ketapang habitat evidence continues to guide the broadleaf/peat-swamp setting. No conifers or temperate ornamental tree silhouettes are introduced.

Budget: four instanced broadleaf draws replace two; bounded coastal roots add one more. Five 20-triangle crown lobes plus a 34-triangle open trunk/fork template give 134 triangles per broadleaf tree (about 1.541 million for 11,500), versus the former 100 triangles per tree (about 1.15 million). Coastal roots are capped at 19,200 triangles. Seven 24-triangle palm fronds per palm total at most 30,240 triangles. Existing shrubs/reeds remain instanced. No textures are downloaded, no alpha-blended leaf overdraw or per-tree meshes are added. `npm run build` passed; root integration should check both theatre flight views and physical mobile performance remains unverified.

Production-view polish: trunk and foliage instance colours now explicitly convert the authored sRGB palette to linear space, matching the hex material colours. This corrects the washed-out cream/grey appearance under the existing bright hemisphere light. Bark is dark warm grey and foliage a subdued green. Independent lobe heights and per-tree crown aspect variation break up the flat umbrella repetition. Geometry counts and draw-call budget are unchanged.
