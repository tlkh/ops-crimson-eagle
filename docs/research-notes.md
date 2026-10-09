# Research notes, assumptions and provenance

## Historical scope

The Singapore option is fictional, dated 9 October 2026, and inspired by the regional wildfire and haze context. Its incident sites, ship position, routes, refill clearances and mission events are authored for gameplay. Danau Sembuluh is a geographic and freshwater-setting reference, not an asserted approved helicopter dipping site.

The Japan option is based on the documented JGSDF CH-47 firefighting deployment aboard JS Kunisaki near Ketapang in September 2026. Official reporting establishes the deployment, ship, area and dates. The individual playable sorties, fires, detailed routes, lake, weather and ship stations are reconstructed. The represented CH-47JA preset is not an identified deployed serial or configuration. All theatre coordinates in the game are compressed local gameplay metres, not georeferenced routes or surveyed locations.

Mission and aircraft details can change as implementation is completed. The source register below supports historical and general reference context; it does not turn authored game geometry or simplified aircraft tuning into historical fact.

## Game assumptions

- Both campaign profiles start with 3,100 kg of fuel. The flight simulation uses simplified fuel burn and route estimates for playability; they are not published aircraft operating data.
- Current simulation tuning burns 320 kg/min without the bucket attached, 360 kg/min with an empty bucket attached, and up to 460 kg/min at full water load. These are prototype game rates, not real Chinook consumption figures.
- Each mission manifest sets a 300-second target. Compact route geometry supports a short authored session; that target is not measured completion time or historical transit time.
- Water capacity is 5,000 litres. The game assumes fresh water weighs 1 kg per litre and counts its mass with the suspended rig. Actual aircraft load limits, bucket performance, fuel reserves and approved routes are outside this prototype’s scope.
- Mission maps use compressed local coordinates and authored targets. A map marker’s distance is a gameplay value, not a real-world distance.
- Japan’s airport handling stop is informed by a contemporary support report, but the game’s precise pad, timing and sequence are reconstructed.
- Peat heat and crew consolidation are gameplay abstractions. They do not model full landscape hydrology or replace ground response.

## Asset provenance

`public/icon.svg` is superseded original project-authored vector artwork. The current title mark, app icons and two illustrative campaign-card landscapes were generated for this project with built-in ImageGen; their uses and final prompt set are recorded in [generated UI assets](art-assets.md). The Chinook in `src/render/aircraft.ts`, the LSTs in `src/render/ships.ts`, the lowland scenery in `src/render/world.ts`, and the bucket and fire scene in `src/render/index.ts` are project-authored Three.js procedural geometry. See [aircraft geometry references](aircraft-geometry-references.md), [ship geometry references](ship-geometry-references.md) and [map geometry references](map-geometry-references.md) for the visual research and accuracy boundaries. The repository contains no third-party aircraft model, photographic texture, map tile, sound recording or font asset. Scenario provenance is also held in `src/content/provenance.ts`. If external media or datasets are added, record the direct source, creator, licence and use here before release.

## Source register

Sources selected for this prototype were listed in the implementation brief as checked on 9 October 2026. These direct institutional references support the campaign context and general mechanics:

| Source | Use and limit |
| --- | --- |
| [Japan MOD: CH-47 launch from Kunisaki near Ketapang, 23 September 2026](https://www.mod.go.jp/j/press/news/2026/09/23a.html) | Confirms ship-launched firefighting began near Ketapang. It does not establish the game’s individual sorties or refill lake. |
| [Japan MOD: CH-47 deployment and Kunisaki off Ketapang, 21 September 2026](https://www.mod.go.jp/j/press/news/2026/09/21a.html) | Deployment context and ship/area reference. |
| [Japan MOFA: conclusion of the Indonesia firefighting activity](https://www.mofa.go.jp/mofaj/press/release/pressit_000001_04224.html) | Supports the operation’s 16–29 September 2026 dates. |
| [Japan Joint Staff: 2 October 2026 press briefing](https://www.mod.go.jp/js/about/message/2026/1002.html) | Overall response totals, smoke constraints and ship repositioning context; not a per-sortie record. |
| [Singapore MINDEF: RSAF CH-47F operational capability](https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_nr/) and [aircraft fact sheet](https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_fs/) | Aircraft identity, public specifications and LST refuelling context. Published headlines are not this game’s validated external-load performance. |
| [Singapore MINDEF: 2015 Indonesia firefighting operation](https://www.mindef.gov.sg/news-and-events/latest-releases/2015oct24-news-releases-01712/) | Historical Singapore Chinook and 5,000-litre bucket precedent; not evidence of the fictional 2026 campaign. |
| [Central Kalimantan tourism department: Danau Sembuluh](https://visit.kalteng.go.id/kawasan-desa-adat-bangkal-dan-danau-sembuluh/) and [Sembuluh Satu village: freshwater fisheries](https://sembuluhsatu.digitaldesa.id/potensi/perikanan-air-tawar) | Landscape and freshwater-setting references, not dipping approvals or surveyed hazards. |
| [Rahadi Oesman airport support report](https://hubud.kemenhub.go.id/upbu/rahadi-oesman/kategori/kegiatan-kerja-sama/berita/bandara-rahadi-osman-siap-dukung-operasi-water-bombing-karhutla-dengan-ch-47-bantuan-jepang-8h8xb) | Documents airport support and bucket handling; not every historical sortie sequence or the game’s exact pad. |
| [NASA helicopter bucket training report](https://www.nasa.gov/centers-and-facilities/kennedy/bambi-bucket-training-prepares-helicopter-crews-for-fighting-fires/) | General hover-and-dip firefighting context, not Chinook performance. |
| [UNEP: why peatlands matter](https://www.unep.org/news-and-stories/story/why-peatlands-matter) | General context for persistent peat fires; the game’s heat model is an abstraction. |
| [W3C Pointer Events](https://www.w3.org/TR/pointerevents/) | Reference for pointer input, capture and touch-action behavior if used by the implemented mobile controls. |
