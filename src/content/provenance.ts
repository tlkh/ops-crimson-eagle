import type { CampaignId, Vec3 } from '../types';
import { campaigns } from './index';

export type ContentSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  observedAt: string | null;
  retrievedAt: string;
  supports: string[];
  limitations: string[];
};

/** Public sources listed in the 9 October 2026 project brief; dates are left null when that brief gives none. */
export const sourceRegister: ContentSource[] = [
  { id: 'S01', title: 'Regional haze situation', publisher: 'ASEAN Specialised Meteorological Centre', url: 'https://asmc.asean.org/home/', publishedAt: null, observedAt: '2026-10-09', retrievedAt: '2026-10-09', supports: ['Regional haze context and displayed alert level'], limitations: ['Illustrative regional maps and hotspots do not define playable fire perimeters.'] },
  { id: 'S02', title: 'Haze portal update', publisher: 'Singapore National Environment Agency', url: 'https://www.haze.gov.sg/', publishedAt: null, observedAt: '2026-10-09T10:38:00+08:00', retrievedAt: '2026-10-09', supports: ['Regional conditions reported at 10:38 AM on 9 October 2026'], limitations: ['Observation gaps were reported from smoke and cloud; this is not a local fire map.'] },
  { id: 'S03', title: 'Disaster situation report, 1 October 2026', publisher: 'Indonesia National Disaster Management Authority (BNPB)', url: 'https://bnpb.go.id/berita/perkembangan-situasi-dan-penanganan-bencana-di-tanah-air-1-oktober-2026', publishedAt: '2026-10-01', observedAt: '2026-09-30', retrievedAt: '2026-10-09', supports: ['Continuing response in Central Kalimantan and South Sumatra'], limitations: ['The report describes regional response; it does not verify game mission fires.'] },
  { id: 'S04', title: 'South Sumatra OKI fire response report', publisher: 'South Sumatra Provincial Government', url: 'https://satudata.sumselprov.go.id/publikasi/berita/atasi-akar-masalah-karhutla-gubernur-sumsel-gandeng-kades-tnipolri-dan-perusahaan-di-oki', publishedAt: '2026-10-05', observedAt: '2026-10-04', retrievedAt: '2026-10-09', supports: ['Aerial patrol and response meeting in Ogan Komering Ilir'], limitations: ['South Sumatra context is not the location of the Singapore tutorial or Ketapang campaign.'] },
  { id: 'S05', title: 'Indonesia weekly weather outlook, 6–12 October 2026', publisher: 'BMKG', url: 'https://www.bmkg.go.id/cuaca/potensi-hujan-sepekan/prakiraan-cuaca-indonesia-sepekan-periode-06-12-oktober-2026-awal-oktober-masih-didominasi-kondisi-kering-waspadai-hujan-lebat-lokal', publishedAt: null, observedAt: '2026-10-06/2026-10-12', retrievedAt: '2026-10-09', supports: ['Dry conditions with potential local heavy rain'], limitations: ['A regional outlook does not establish mission-specific weather; all game weather is authored.'] },
  { id: 'S06', title: 'Danau Sembuluh and Bangkal traditional area', publisher: 'Central Kalimantan Tourism Department', url: 'https://visit.kalteng.go.id/kawasan-desa-adat-bangkal-dan-danau-sembuluh/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Lake setting and surrounding communities'], limitations: ['Does not establish water depth, aircraft clearance or an approved dip site.'] },
  { id: 'S07', title: 'Freshwater fisheries profile', publisher: 'Sembuluh Satu official village site', url: 'https://sembuluhsatu.digitaldesa.id/potensi/perikanan-air-tawar', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Freshwater fisheries associated with the lake community'], limitations: ['The page date is unavailable; it does not survey a helicopter refill zone.'] },
  { id: 'S08', title: 'Danau Pelajau gazetteer entry', publisher: 'GeoNames', url: 'https://www.geonames.org/1627852/danau-pelajau.html', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Approximate lake reference coordinate and Danau Sembuluh alternate name'], limitations: ['Approximate gazetteer point, not a surveyed operational waypoint.'] },
  { id: 'S09', title: 'Kuala Pembuang airport record', publisher: 'Directorate General of Civil Aviation, Indonesia', url: 'https://hubud.kemenhub.go.id/bandara/209', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Airport geographic reference coordinate'], limitations: ['Airport is not an in-game diversion clearance or surveyed helicopter pad.'] },
  { id: 'S10', title: 'Danau Teluk Gelam directory entry', publisher: 'Indonesia Tourism Directory', url: 'https://www.direktoripariwisata.id/unit/3383', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Identity of a possible future expansion lake'], limitations: ['Expansion candidate only; not used as a first-release mission refill site.'] },
  { id: 'S11', title: 'RSAF CH-47F reaches full operational capability', publisher: 'Singapore Ministry of Defence', url: 'https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_nr/', publishedAt: '2024-04-11', observedAt: null, retrievedAt: '2026-10-09', supports: ['RSAF CH-47F and documented LST refuelling context'], limitations: ['Does not establish the fictional October 2026 deployment.'] },
  { id: 'S12', title: 'RSAF CH-47F fact sheet', publisher: 'Singapore Ministry of Defence', url: 'https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_fs/', publishedAt: '2024-04-11', observedAt: null, retrievedAt: '2026-10-09', supports: ['RSAF aircraft basic mass, dimensions, gross limit and published performance headlines'], limitations: ['Headlines are not loaded-bucket performance guarantees or an operating burn table.'] },
  { id: 'S13', title: 'Singapore Chinooks conclude Indonesia firefighting deployment', publisher: 'Singapore Ministry of Defence', url: 'https://www.mindef.gov.sg/news-and-events/latest-releases/2015oct24-news-releases-01712/', publishedAt: '2015-10-24', observedAt: null, retrievedAt: '2026-10-09', supports: ['RSAF precedent for a 5,000 L heli-bucket'], limitations: ['Historical equipment scale only; not evidence of the fictional 2026 ship-based campaign.'] },
  { id: 'S14', title: 'RSN ships overview', publisher: 'Republic of Singapore Navy', url: 'https://www.navy.gov.sg/our-forces/ships/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Endurance-class dimensions and ship identities'], limitations: ['Class dimensions do not define the exact usable deck polygon.'] },
  { id: 'S15', title: 'First Chinook landing on an LST', publisher: 'PIONEER', url: 'https://defencepioneer.sg/pioneer-articles/first-chinook-landing-on-lst', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Chinook landing precedent and approximate cleared LST deck dimensions'], limitations: ['A precedent for deck operation, not this campaign’s mission route.'] },
  { id: 'S16', title: 'Helicopter bucket training', publisher: 'NASA', url: 'https://www.nasa.gov/centers-and-facilities/kennedy/bambi-bucket-training-prepares-helicopter-crews-for-fighting-fires/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['General bucket immersion and water-delivery concepts'], limitations: ['Not a Chinook-specific performance reference.'] },
  { id: 'S17', title: 'Why peatlands matter', publisher: 'United Nations Environment Programme', url: 'https://www.unep.org/news-and-stories/story/why-peatlands-matter', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Peat persistence and habitat context'], limitations: ['General context; all specific fire patches are authored gameplay.'] },
  { id: 'S18', title: 'WebGLRenderer documentation', publisher: 'Three.js', url: 'https://threejs.org/docs/pages/WebGLRenderer.html', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Renderer implementation reference'], limitations: ['Not a scenario or geographic source.'] },
  { id: 'S19', title: 'Pointer Events specification', publisher: 'World Wide Web Consortium', url: 'https://www.w3.org/TR/pointerevents/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Pointer capture and touch input reference'], limitations: ['Not a scenario or geographic source.'] },
  { id: 'S20', title: 'WebKit features in Safari 26.0', publisher: 'WebKit', url: 'https://webkit.org/blog/17333/webkit-features-in-safari-26-0/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Safari platform capability context'], limitations: ['Not a scenario or geographic source.'] },
  { id: 'S21', title: 'KTX2Loader documentation', publisher: 'Three.js', url: 'https://threejs.org/docs/pages/KTX2Loader.html', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Compressed texture loader reference'], limitations: ['Not a scenario or geographic source.'] },
  { id: 'S22', title: 'Updates to storage policy', publisher: 'WebKit', url: 'https://webkit.org/blog/14403/updates-to-storage-policy/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Best-effort browser storage and eviction policy context'], limitations: ['Not a scenario or geographic source.'] },
  { id: 'S23', title: 'JGSDF deployment order, 28 August 2026', publisher: 'Japan Ministry of Defense', url: 'https://www.mod.go.jp/j/press/news/2026/08/28h.html', publishedAt: '2026-08-28', observedAt: null, retrievedAt: '2026-10-09', supports: ['Three JGSDF CH-47 helicopters assigned to Kunisaki'], limitations: ['Does not identify game routes or individual aircraft configuration.'] },
  { id: 'S24', title: 'Japanese aircraft arrival off Ketapang, 21 September 2026', publisher: 'Japan Ministry of Defense', url: 'https://www.mod.go.jp/j/press/news/2026/09/21a.html', publishedAt: '2026-09-21', observedAt: '2026-09-21', retrievedAt: '2026-10-09', supports: ['One CH-47 aboard Kunisaki off Ketapang; two based at Kijing Port'], limitations: ['Does not provide an exact ship station or fire polygon.'] },
  { id: 'S25', title: 'Ship-launched firefighting begins, 23 September 2026', publisher: 'Japan Ministry of Defense', url: 'https://www.mod.go.jp/j/press/news/2026/09/23a.html', publishedAt: '2026-09-23', observedAt: '2026-09-23', retrievedAt: '2026-10-09', supports: ['CH-47 launched from Kunisaki offshore Ketapang and began local firefighting'], limitations: ['Does not establish the authored missions, refill lake or every sortie sequence.'] },
  { id: 'S26', title: 'Conclusion of firefighting activities, 29 September 2026', publisher: 'Japan Ministry of Foreign Affairs', url: 'https://www.mofa.go.jp/mofaj/press/release/pressit_000001_04224.html', publishedAt: '2026-09-29', observedAt: '2026-09-29', retrievedAt: '2026-10-09', supports: ['Overall Japanese firefighting response dates of 16–29 September and end of local activities'], limitations: ['Does not establish the fictional closing mission target.'] },
  { id: 'S27', title: 'Chief of Joint Staff press conference, 2 October 2026', publisher: 'Japan Ministry of Defense, Joint Staff', url: 'https://www.mod.go.jp/js/about/message/2026/1002.html', publishedAt: '2026-10-02', observedAt: null, retrievedAt: '2026-10-09', supports: ['56 water releases totalling approximately 280 tonnes; smoke and ship repositioning context'], limitations: ['Operation-wide context, not a player mission quota or a count of separate sorties.'] },
  { id: 'S28', title: 'JGSDF aircraft equipment reference', publisher: 'Japan Ground Self-Defense Force', url: 'https://www.mod.go.jp/gsdf/equipment/air/index.html', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['CH-47JA dimensions, gross mass, published performance and enlarged tanks'], limitations: ['Does not identify the specific aircraft deployed to Indonesia or a loaded-bucket envelope.'] },
  { id: 'S29', title: 'Aircraft comparison booklet, September 2014, page 5', publisher: 'Japan Ministry of Defense, Kyushu Regional Defense Bureau', url: 'https://www.mod.go.jp/rdb/kyushu/topics/104yanagawa/260901.pdf', publishedAt: '2014-09', observedAt: null, retrievedAt: '2026-10-09', supports: ['Approximate CH-47JA self-weight reference of 11,500 kg'], limitations: ['Reference baseline, not the weighing record of the deployed aircraft.'] },
  { id: 'S30', title: 'Ōsumi-class ship reference', publisher: 'Japan Maritime Self-Defense Force', url: 'https://www.mod.go.jp/msdf/equipment/ships/lst/osumi/', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Kunisaki LST-4003 identity and published class dimensions'], limitations: ['Overall beam is not the measured usable flight-deck width.'] },
  { id: 'S31', title: 'Rahadi Oesman airport support for water-bombing, 23 September 2026', publisher: 'Directorate General of Civil Aviation, Indonesia', url: 'https://hubud.kemenhub.go.id/upbu/rahadi-oesman/kategori/kegiatan-kerja-sama/berita/bandara-rahadi-oesman-siap-dukung-operasi-water-bombing-karhutla-dengan-ch-47-bantuan-jepang-8h8xb', publishedAt: '2026-09-23', observedAt: '2026-09-23', retrievedAt: '2026-10-09', supports: ['CH-47 landings, bucket handling and cable arrangement at the airport'], limitations: ['Does not say this exact sequence occurred on every sortie.'] },
  { id: 'S32', title: 'Rahadi Oesman airport technical data', publisher: 'Directorate General of Civil Aviation, Indonesia', url: 'https://hubud.kemenhub.go.id/upbu/rahadi-oesman/data/bandara', publishedAt: null, observedAt: null, retrievedAt: '2026-10-09', supports: ['Official airport reference point coordinates'], limitations: ['ARP is not a surveyed helicopter handling-pad point.'] },
  { id: 'S33', title: 'Japanese Chinook firefighting in West Kalimantan, 21 September 2026', publisher: 'Radio Republik Indonesia', url: 'https://rri.co.id/nasional/2747256/helikopter-chinook-dari-jepang-bantu-pemadamanan-karhutla-di-kalimantan-barat', publishedAt: '2026-09-21', observedAt: null, retrievedAt: '2026-10-09', supports: ['Contemporary reporting of five-tonne water loads and visibility issues'], limitations: ['Exact bucket model is not verified.'] },
];

export const contextSnapshots = [
  {
    id: 'context_sg_2026_10_09',
    campaignId: 'sg_fictional_2026_10' as CampaignId,
    contextAsOf: '2026-10-09',
    summary: 'Regional haze reporting on 9 October 2026 described Kalimantan hotspots, smoke-related observation gaps and a mix of dry conditions with possible local rain. Singapore’s October campaign is fictional and uses this only as regional humanitarian context.',
    sourceIds: ['S01', 'S02', 'S03', 'S05'],
    explicitLimits: ['No scenario fire is represented as a satellite hotspot.', 'No lake or refill clearance is asserted to be operationally approved.', 'The ship, mission routes, fires and weather are authored gameplay.'],
  },
  {
    id: 'context_jp_2026_10_09',
    campaignId: 'jp_ketapang_2026_09' as CampaignId,
    contextAsOf: '2026-10-09',
    summary: 'Japan deployed JGSDF CH-47 helicopters aboard JS Kunisaki; an aircraft launched from the ship offshore Ketapang and firefighting began on 23 September. The broader response ran from 16 to 29 September and had ended by this snapshot date.',
    sourceIds: ['S23', 'S24', 'S25', 'S26', 'S27'],
    explicitLimits: ['The official sources do not identify this game’s exact ship station, refill lake, fire polygons or complete sortie sequences.', 'A CH-47JA is a representative game preset, not a verified deployed serial/configuration.', 'The playable missions are reconstructions; the training mission is fictional practice.'],
  },
];

export type AssetProvenance = {
  assetId: string;
  name: string;
  author: string;
  sourceIds: string[];
  license: string;
  modifications: string;
  scale: string;
  status: 'original_game_data' | 'authored_blockout' | 'reference_only';
};

/** No external mesh, image, map tile or fire dataset is copied by these scenario files. */
export const assetProvenance: AssetProvenance[] = [
  { assetId: 'content.singapore.play-space', name: 'Seruyan-inspired compact mission layout', author: 'Operation Crimson Eagle project', sourceIds: ['S06', 'S07', 'S08'], license: 'Original authored game data; linked sources retain their own terms and are not bundled assets.', modifications: 'Compressed ship-origin gameplay positions and fictional targets; not a georeferenced route or surveyed waterbody.', scale: 'Coordinates are metres in the local gameplay blockout; labels do not imply strategic route distances.', status: 'authored_blockout' },
  { assetId: 'content.japan.play-space', name: 'Ketapang compact mission layout', author: 'Operation Crimson Eagle project', sourceIds: ['S24', 'S25', 'S31', 'S32'], license: 'Original authored game data; linked sources retain their own terms and are not bundled assets.', modifications: 'Authored ship station, compressed local airport waypoint, refill lake and targets; only the airport support context and ARP reference are sourced.', scale: 'Coordinates are metres in the local gameplay blockout; no coordinate conversion to the real Ketapang corridor is claimed.', status: 'authored_blockout' },
  { assetId: 'content.mission-fires', name: 'Twelve authored mission fire patches and objectives', author: 'Operation Crimson Eagle project', sourceIds: [], license: 'Original fictional gameplay data.', modifications: 'All per-mission fires and protected objectives are authored for play; no satellite hotspot or historical incident polygon is copied.', scale: 'Local metres around each campaign’s lake reference point.', status: 'original_game_data' },
  { assetId: 'content.profile-anchors', name: 'Aircraft, ship and bucket public-reference anchors', author: 'Operation Crimson Eagle project', sourceIds: ['S11', 'S12', 'S13', 'S14', 'S15', 'S23', 'S28', 'S29', 'S30', 'S33'], license: 'Facts are attributed to linked public sources; no source photograph or model is included.', modifications: 'Gameplay mission allowances are kept separate from published equipment facts.', scale: 'Mass in kilograms, ship dimensions in metres, water load in litres.', status: 'reference_only' },
];

export type GeometryProvenance = 'geographic_reference' | 'simplified_reconstruction' | 'fictional_gameplay';
export type ScenarioGeometry = {
  id: string;
  label: string;
  provenance: GeometryProvenance;
  sourceIds: string[];
  localPoint?: { x: number; z: number };
  radiusM?: number;
  referencePoint?: { latitude: number; longitude: number };
  limitations: string;
};

export type ScenarioPackage = {
  campaignId: CampaignId;
  campaignVersion: string;
  displayName: string;
  evidenceMode: 'fictional_inspired' | 'documented_operation_reconstruction';
  operatorProfileId: string;
  aircraftProfileId: string;
  aircraftProfileVersion: string;
  shipProfileId: string;
  shipProfileVersion: string;
  bucketProfileId: string;
  bucketProfileVersion: string;
  theatreId: string;
  theatreVersion: string;
  missionIds: string[];
  contextSnapshotId: string;
  contextAsOf: string;
  operationDateStart: string;
  operationDateEnd: string;
  scenarioVersion: string;
  geographicOrigin: { label: string; referencePoint?: { latitude: number; longitude: number }; sourceIds: string[]; localCoordinateNote: string };
  realGeographyReferences: ScenarioGeometry[];
  documentedOperationFacts: { fact: string; sourceIds: string[] }[];
  reconstructedGameplayElements: string[];
  shipWaypoints: ScenarioGeometry[];
  shoreHandlingSites: ScenarioGeometry[];
  bucketStorageLocation: string;
  freshwaterPolygons: ScenarioGeometry[];
  refillZones: ScenarioGeometry[];
  obstacleAndExclusionZones: ScenarioGeometry[];
  authoredFirePatches: ScenarioGeometry[];
  protectedObjectives: { id: string; label: string; provenance: GeometryProvenance; sourceIds: string[] }[];
  weatherProfiles: { missionId: string; wind: { x: number; z: number }; provenance: 'fictional_gameplay'; sourceIds: string[]; description: string }[];
  groundCrewRules: string[];
  flightRoutes: { missionId: string; legs: { from: string; to: string; bucketState: 'attached' | 'detached'; provenance: 'fictional_gameplay'; sourceIds: string[] }[] }[];
  fuelPlanningPolicy: string;
  missionSeeds: { missionId: string; seed: number; scenarioDate: string }[];
  evidenceReferences: string[];
  profileProvenance: { profileId: string; sourceIds: string[]; gameCalibrationFields: string[] }[];
};

function asLocalPoint(marker: { x: number; z: number }): { x: number; z: number } {
  return { x: marker.x, z: marker.z };
}

function makeScenarioPackage(campaignIndex: number): ScenarioPackage {
  const campaign = campaigns[campaignIndex];
  const isSingapore = campaign.id === 'sg_fictional_2026_10';
  const sourceIds = isSingapore
    ? ['S01', 'S02', 'S03', 'S05', 'S06', 'S07', 'S08', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17']
    : ['S23', 'S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S31', 'S32', 'S33'];
  const lake = campaign.missions[0].lake;
  const shore = campaign.missions[0].shore;
  const lakeLocal = asLocalPoint(lake);
  const firePatches: ScenarioGeometry[] = campaign.missions.map((mission) => ({
    id: `${mission.id.toLowerCase()}-fire`,
    label: mission.fire.label,
    provenance: 'fictional_gameplay',
    sourceIds: [],
    localPoint: asLocalPoint(mission.fire),
    radiusM: mission.fire.radius,
    limitations: 'Authored playable fire patch; it does not represent a reported incident or satellite hotspot.',
  }));
  const routeLegs = campaign.missions.map((mission) => ({
    missionId: mission.id,
    legs: isSingapore
      ? [
          { from: 'ship', to: 'lake', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'lake', to: 'fire', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'fire', to: 'lake', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'lake', to: 'ship', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
        ]
      : [
          { from: 'ship', to: 'shore', bucketState: 'detached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'shore', to: 'lake', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'lake', to: 'fire', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'fire', to: 'lake', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'lake', to: 'shore', bucketState: 'attached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
          { from: 'shore', to: 'ship', bucketState: 'detached' as const, provenance: 'fictional_gameplay' as const, sourceIds: [] },
        ],
  }));

  return {
    campaignId: campaign.id,
    campaignVersion: '1.0.0',
    displayName: campaign.name,
    evidenceMode: campaign.evidenceMode,
    operatorProfileId: isSingapore ? 'operator.rsaf' : 'operator.jgsdf',
    aircraftProfileId: isSingapore ? 'aircraft.rsaf-ch47f' : 'aircraft.jgsdf-ch47ja-representative',
    aircraftProfileVersion: '1.0.0',
    shipProfileId: isSingapore ? 'ship.rsn-endurance' : 'ship.jmsdf-osumi-kunisaki',
    shipProfileVersion: '1.0.0',
    bucketProfileId: isSingapore ? 'bucket.sg-5000l-game' : 'bucket.jp-5000l-game',
    bucketProfileVersion: '1.0.0',
    theatreId: isSingapore ? 'theatre.seruyan-compact' : 'theatre.ketapang-compact',
    theatreVersion: '1.0.0',
    missionIds: campaign.missions.map((mission) => mission.id),
    contextSnapshotId: isSingapore ? 'context_sg_2026_10_09' : 'context_jp_2026_10_09',
    contextAsOf: '2026-10-09',
    operationDateStart: isSingapore ? '2026-10-09' : '2026-09-23',
    operationDateEnd: isSingapore ? '2026-10-09' : '2026-09-29',
    scenarioVersion: '1.0.0',
    geographicOrigin: isSingapore
      ? { label: 'Seruyan / Danau Sembuluh, Central Kalimantan', referencePoint: { latitude: -2.7051, longitude: 112.3671 }, sourceIds: ['S06', 'S08'], localCoordinateNote: 'The reference point describes the regional setting only. Mission metres below are a compact ship-origin blockout and are not converted from this latitude/longitude.' }
      : { label: 'Ketapang, West Kalimantan', sourceIds: ['S24', 'S25'], localCoordinateNote: 'The documented deployment region is real; ship, airport and lake local points below form a compact reconstruction and are not georeferenced route positions.' },
    realGeographyReferences: isSingapore
      ? [
          { id: 'georef-danau-sembuluh', label: 'Approximate Danau Sembuluh reference', provenance: 'geographic_reference', sourceIds: ['S06', 'S08'], referencePoint: { latitude: -2.7051, longitude: 112.3671 }, limitations: 'Approximate gazetteer reference and landscape context; not a surveyed refill point.' },
          { id: 'georef-kuala-pembuang-airport', label: 'Kuala Pembuang airport reference', provenance: 'geographic_reference', sourceIds: ['S09'], referencePoint: { latitude: -3.3781417, longitude: 112.5416167 }, limitations: 'Reference only; no in-game clearance or diversion pad is claimed.' },
        ]
      : [
          { id: 'georef-ketapang', label: 'Ketapang deployment region', provenance: 'geographic_reference', sourceIds: ['S24', 'S25'], limitations: 'Deployment region only; cited sources do not establish an exact ship station or fire boundary.' },
          { id: 'georef-rahadi-oesman-arp', label: 'Rahadi Oesman airport reference point', provenance: 'geographic_reference', sourceIds: ['S32'], referencePoint: { latitude: -1.8161111, longitude: 109.9619444 }, limitations: 'Published airport ARP; not a surveyed helicopter handling pad.' },
        ],
    documentedOperationFacts: isSingapore
      ? [
          { fact: 'Danau Sembuluh and surrounding communities provide the freshwater-lake and landscape setting.', sourceIds: ['S06', 'S07', 'S08'] },
          { fact: 'The RSAF operates the CH-47F; a 5,000 L firefighting bucket is a historical equipment-scale precedent.', sourceIds: ['S11', 'S12', 'S13'] },
        ]
      : [
          { fact: 'A JGSDF CH-47 launched from JS Kunisaki offshore Ketapang and firefighting began on 23 September 2026.', sourceIds: ['S24', 'S25'] },
          { fact: 'The broader Japanese firefighting response ran from 16 to 29 September 2026 and had ended by the 9 October context cutoff.', sourceIds: ['S26'] },
          { fact: 'Rahadi Oesman reported CH-47 landing, bucket handling and cable arrangement support.', sourceIds: ['S31'] },
        ],
    reconstructedGameplayElements: isSingapore
      ? ['October deployment and all missions are fictional.', 'The compact ship station, lake refill zone, fire patches, weather, routes and protected objectives are authored gameplay.', 'A historical 5,000 L bucket precedent informs only the gameplay capacity scale.']
      : ['Playable missions, exact routes, ship gameplay station, weather, refill lake, fire patches and protected objectives are reconstructions.', 'Airport rigging/unrigging is an authored sequence informed by documented airport support, not asserted for every historical sortie.', 'CH-47JA geometry is a representative preset and not an asserted deployed serial/configuration.'],
    shipWaypoints: [{ id: 'ship-start', label: campaign.shipName, provenance: 'fictional_gameplay', sourceIds: [], localPoint: { x: 0, z: 0 }, limitations: 'Ship is represented at the local origin for a compact playable layout; this is not a real anchorage coordinate.' }],
    shoreHandlingSites: shore
      ? [{ id: 'shore-handling', label: shore.label, provenance: 'simplified_reconstruction', sourceIds: ['S31', 'S32'], localPoint: asLocalPoint(shore), limitations: 'Authored compressed gameplay waypoint. Sources support airport location and equipment-handling context, not this local coordinate or exact sortie order.' }]
      : [],
    bucketStorageLocation: isSingapore ? 'Deck rig point aboard the selected Endurance-class LST (gameplay handling abstraction).' : 'Practice mission: labelled practice pad; operational missions: Rahadi Oesman representative support pad, using a reconstructed handling sequence.',
    freshwaterPolygons: [{ id: 'freshwater-play-zone', label: lake.label, provenance: 'fictional_gameplay', sourceIds: [], localPoint: lakeLocal, radiusM: lake.radius, limitations: isSingapore ? 'Freshwater character is supported for the lake setting, but this circular game zone and its pickup clearance are authored, not surveyed.' : 'Entirely authored reconstructed freshwater zone; no cited source identifies a historical firefighting dip lake here.' }],
    refillZones: [{ id: 'refill-zone', label: 'Gameplay bucket immersion zone', provenance: 'fictional_gameplay', sourceIds: [], localPoint: lakeLocal, radiusM: lake.radius, limitations: 'Game-only pickup zone. Bucket immersion, safe-clearance and water availability are governed by game rules.' }],
    obstacleAndExclusionZones: [{ id: 'lake-activity-exclusion', label: 'Authored boat and community activity keep-clear area', provenance: 'fictional_gameplay', sourceIds: [], localPoint: lakeLocal, radiusM: Math.round(lake.radius * 0.45), limitations: 'Gameplay abstraction only; not a surveyed fishing area, obstacle map or real safety buffer.' }],
    authoredFirePatches: firePatches,
    protectedObjectives: campaign.missions.map((mission) => ({ id: `${mission.id.toLowerCase()}-objective`, label: mission.protectedLabel, provenance: 'fictional_gameplay', sourceIds: [] })),
    weatherProfiles: campaign.missions.map((mission) => ({ missionId: mission.id, wind: { x: mission.wind.x, z: mission.wind.z }, provenance: 'fictional_gameplay', sourceIds: [], description: mission.description })),
    groundCrewRules: ['Game-calibrated ground crews may consolidate a surface-suppressed patch after repeated useful drops.', 'Crew progression cannot save an objective after its fire has already burned out.', 'No crew location or deployment is represented as a documented real incident.'],
    flightRoutes: routeLegs,
    fuelPlanningPolicy: 'Plan each authored route with a 500 kg game reserve. This is a disclosed game policy, not an asserted RSAF or JGSDF regulation; all waypoint legs are compressed gameplay geometry.',
    missionSeeds: campaign.missions.map((mission) => ({ missionId: mission.id, seed: mission.seed, scenarioDate: mission.date })),
    evidenceReferences: sourceIds,
    profileProvenance: [
      { profileId: isSingapore ? 'aircraft.rsaf-ch47f' : 'aircraft.jgsdf-ch47ja-representative', sourceIds: isSingapore ? ['S12'] : ['S28', 'S29'], gameCalibrationFields: ['crew allowance', 'dispatch fuel', 'fuel burn', 'handling response', 'loaded-bucket speed envelope'] },
      { profileId: isSingapore ? 'ship.rsn-endurance' : 'ship.jmsdf-osumi-kunisaki', sourceIds: isSingapore ? ['S14', 'S15'] : ['S30'], gameCalibrationFields: ['local deck collision and landing clearance geometry'] },
      { profileId: isSingapore ? 'bucket.sg-5000l-game' : 'bucket.jp-5000l-game', sourceIds: isSingapore ? ['S13', 'S16'] : ['S27', 'S33'], gameCalibrationFields: ['line length', 'fill rate', 'capacity implementation', 'release behaviour'] },
    ],
  };
}

export const scenarioPackages: ScenarioPackage[] = [makeScenarioPackage(0), makeScenarioPackage(1)];

// Keep Vec3 in the content contract for authoring tools that consume the same local metre convention.
export type LocalContentPoint = Pick<Vec3, 'x' | 'z'>;
