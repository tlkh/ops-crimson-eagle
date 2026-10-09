# Singapore and Japan Chinook Firefighting Game Codex Brief

**Working title:** Straits Firelift  
**Brief date:** 9 October 2026  
**Product:** A complete single-player 3D web game designed for phones first  
**Playable options:** Singapore (fictional) and Japan (real operation, reconstructed missions)  
**Campaign dates:** Singapore — 9 October 2026; Japan — Ketapang phase, 23–29 September 2026  
**Release scope:** Two selectable campaigns, six missions each, twelve missions total

## 1 Your assignment

Build a playable, polished browser game with exactly two selectable single-player options: **Singapore (fictional)** and **Japan (real)**. In each option the player flies a Chinook from a naval landing ship offshore Indonesia, collects water using a suspended bucket from designated freshwater lakes, suppresses wildfires, and returns safely to the ship.

Singapore pairs an RSAF CH-47F with an RSN Endurance-class LST in a fictional October 2026 relief campaign. Japan recreates the documented September 2026 JGSDF CH-47 operation from JMSDF JS Kunisaki off Ketapang, using a representative CH-47JA preset. The Japanese operation is real; individual playable missions, detailed routes and refill lakes are reconstructed as specified below. [S24] [S25] [S26]

The result must be an actual game with a complete launch, transit, refill, firefighting, return and debrief loop. Make the helicopter enjoyable to control with two thumbs while retaining believable weight, inertia, external-load handling, fuel consumption and mission range.

Use this brief as the implementation specification. Inspect the existing repository and its instructions first. Reuse a sound existing foundation when present; otherwise use the stack specified below. Make routine implementation decisions and finish the complete first release. Validate each playable milestone before adding more content. Keep a concise implementation status in the repository so work can continue across sessions.

Priorities, in order:

1. A satisfying complete firefighting loop.

2. Reliable two-thumb controls and sustained mobile performance.

3. Consistent aircraft mass, water, fuel, geography and simulation time.

4. Recognisable Singaporean and Japanese Chinooks, distinct naval ships and Indonesian environments.

5. Clear missions, useful feedback and replayability.

6. Additional visual detail once the above works.

Deliver the application, source, editable configuration, asset provenance, tests, deployment instructions and an honest verification report. The scope is a complete small game; the first release does not require multiplayer, combat, a global flight simulator, a backend or a live satellite feed.

## 2 Product experience

The player chooses either a Singaporean or Japanese helicopter crew supporting Indonesian incident commanders and ground teams. The aircraft’s power is impressive, but the challenge is placing useful water accurately while managing the load, weather, visibility and fuel needed to get home.

### Two playable options

Present exactly two large cards before campaign selection:

| Card | Visible subtitle | Aircraft and base | Theatre and character |
|---|---|---|---|
| **Singapore (fictional)** | Fictional relief mission · 9 October 2026 | RSAF CH-47F; RSN Endurance-class LST | Seruyan / Danau Sembuluh, Central Kalimantan; longer offshore-to-lake transit and lake-centred suppression |
| **Japan (real)** | Real operation · reconstructed missions · 23–29 September 2026 | JGSDF CH-47, represented by a CH-47JA preset; JS Kunisaki, LST-4003 | Ketapang, West Kalimantan; ship departure, shore bucket handling and local firefighting |

Both options are available from the start. Selecting one loads its complete aircraft, ship, theatre, dates and mission set. Keep each pairing fixed. Training, replay and difficulty sit inside the chosen option. The player controls one helicopter in one active mission; there is no multiplayer dependency or playable command of the wider task force.

Use the same core handling, touch controls and difficulty rules in both options. Distinction comes from the equipment profiles, deck geometry, geography, operating sequence and mission content. Do not apply arbitrary nationality-based performance bonuses. The Japanese representative-variant choice and historical limits are explained in sections 3 and 5.

Use a calm, purposeful humanitarian tone. The ship is the home base, the lakes are working resources used by local communities, and the forests and settlements are places to protect. Ground teams contribute visibly to success.

The default camera is an elevated third-person chase view that keeps the aircraft, sling load and approaching terrain legible. The player should feel the difference between departing with an empty bucket and lifting approximately five tonnes of water. A good drop changes visible flames and the tactical map immediately; residual peat heat can still require further attention.

Target session lengths:

| Activity | Desired wall-clock play time |
|---|---:|
| Guided training mission in a labelled fictional practice area | 8–12 minutes |
| Standard operational sortie in either option, using accelerated transit where useful | 20–30 minutes |
| Longer advanced sortie | 30–45 minutes |
| Resume an existing mission | Within 15 seconds after required cached assets load |

These are playtesting targets. Preserve coherent simulation time when adjusting mission length. Save progress frequently so a phone user can stop at any point.

## 3 Dated setting and historical evidence

Use information verified by **9 October 2026**, while retaining each campaign’s actual scenario date. The October haze context applies to Singapore’s fictional campaign; it must not be silently applied as the weather on a Japanese September mission.

### Singapore — fictional October campaign

Present this sentence in the Singapore introduction and About screen:

> A fictional humanitarian mission inspired by Indonesia’s October 2026 wildfire and haze conditions.

The official NEA portal’s update at 10:38 AM on 9 October describes hotspots in Kalimantan and central/southern Sumatra, with moderate to dense regional smoke haze and observation gaps caused by smoke and cloud. ASMC’s current page displays Alert Level 3. These establish the regional setting, rather than the precise boundaries of individual fires. [S01] [S02]

BNPB’s 1 October report, describing conditions updated through 30 September, documents continuing fire response in Central Kalimantan and South Sumatra. A South Sumatra government report published on 5 October describes an aerial fire patrol and response meeting in Ogan Komering Ilir on 4 October. BMKG’s 6–12 October outlook supports a mix of persistent dry conditions and possible local heavy rain. [S03] [S04] [S05]

The Singapore campaign’s October 2026 deployment, mission fires, permitted refill areas, emergency landing areas and operational clearances are fictional. Do not claim that a named lake was burning, that Singapore deployed this task force in October 2026, or that a selected lake is an approved real helicopter water source.

### Japan — real September operation

Use the documented **Ketapang phase, 23–29 September 2026**, as Japan’s playable setting. Japan’s MOD ordered three JGSDF CH-47 helicopters to deploy aboard Kunisaki on 28 August. By 21 September, one CH-47 was aboard Kunisaki off Ketapang while two were based at Kijing Port. MOD explicitly confirms that a CH-47 launched from the ship offshore Ketapang and began firefighting there on 23 September. [S23] [S24] [S25]

The broader Japanese firefighting response ran from **16 to 29 September 2026**. It had ended by this brief’s 9 October cutoff. Present the Japanese choice as a reconstruction of that recent operation, not an October deployment still fighting fires. [S26]

The 2 October Joint Staff account reports 56 water releases totalling approximately 280 tonnes across the full response, and describes repositioning Kunisaki to find workable flying conditions as smoke changed. This is context for the campaign; it is not a target that one player must reproduce or a claim of 56 separate sorties. [S27]

Use this player-facing wording:

> Based on Japan’s real September 2026 firefighting deployment to Indonesia. Playable missions, exact routes, ship positions, weather and freshwater refill lakes are reconstructed for the game.

Official sources establish the deployed aircraft family, ship, region and dates. They do not establish the precise bucket model, dip sites, every aircraft serial, exact anchorage, fire polygons or the game’s individual objectives. Keep these distinctions visible in the briefing and source notes. The Japanese training mission is explicitly practice, not an asserted historical sortie.

Keep the current-event summary short. Do not invent live PSI/AQI readings, disaster casualty counts, company culpability, or precise satellite-derived fire perimeters. Bundle a separately dated context snapshot for each option, so both remain playable without a network connection.

## 4 Geography and the two theatres

### Singapore — Seruyan and Danau Sembuluh

Use **Seruyan and Danau Sembuluh in Central Kalimantan** as the Singapore operational theatre.

The provincial tourism department documents Danau Sembuluh and its surrounding communities, while the official Sembuluh Satu village page explicitly describes freshwater fisheries associated with the lake. These support the landscape and freshwater setting, but do not establish current water depth, navigable clearances or safe dipping locations. [S06] [S07]

Build a recognisable environment in southern Central Kalimantan: a broad low-lying coastline, river mouths, inland waterways, a large lake, forest, disturbed vegetation, peatland patches, roads and lakeside settlements. Include boats and fishing areas as scenery and refill exclusions. Use plausible habitat-protection objectives without asserting that a particular animal rescue occurred.

Use the following points for initial strategic layout and range estimation:

| Reference | Latitude | Longitude | Meaning |
|---|---:|---:|---|
| Approximate Sembuluh lake reference | -2.7051 | 112.3671 | Gazetteer reference, not a surveyed refill site |
| Kuala Pembuang airport reference | -3.3781417 | 112.5416167 | Published airport reference converted from DMS |
| Proposed fictional offshore LST waypoint | -3.5000 | 112.5500 | Designer-selected starting point to validate against coastline geometry |

The lake point comes from a GeoNames record named Danau Pelajau that includes Danau Sembuluh among its alternate names. The airport reference comes from Indonesia’s aviation authority. Treat the airport as a geographic reference; any in-game diversion clearance is fictional. [S08] [S09]

The proposed LST-to-lake reference distance is approximately **90.7 km straight-line**, calculated with the haversine formula using Earth radius 6,371 km. This is a design calculation between an approximate lake point and a fictional ship point. Actual mission route lengths must come from the authored waypoints and include detours and approaches.

### Japan — Ketapang and shore support

Build a separate theatre around **Ketapang, West Kalimantan**, with a western coastline, lowland fire sectors, a reconstructed inland freshwater lake, JS Kunisaki offshore and Rahadi Oesman airport as a shore support point. Do not reuse the Sembuluh map or move Sembuluh to West Kalimantan.

The airport’s own 23 September report documents support for CH-47 landings, bucket installation/handling and cable arrangement. Use that evidence to inform a reconstructed playable sequence: ship departure, airport rigging stop, refill/fire cycles, airport unrigging stop and ship recovery. The source does not establish that this exact sequence occurred on every real sortie. [S31]

| Reference | Latitude | Longitude | Provenance |
|---|---:|---:|---|
| Rahadi Oesman airport reference | -1.8161111 | 109.9619444 | Official ARP, converted from 01°48′58″S, 109°57′43″E; not a surveyed helicopter handling pad [S32] |
| Proposed Kunisaki gameplay station | -1.9500 | 109.8000 | Authored offshore position; validate against coastline and sea geometry |
| Reconstructed inland refill lake centre | -2.2000 | 110.1600 | Entirely authored freshwater lake for gameplay; no claim that a real lake or historical dip site occupies this point |

The two authored points above are concrete blockout placements, not historical coordinates. Keep them in a visibly labelled reconstruction layer. Use a generic name such as **Ketapang refill lake — reconstructed**. The available primary deployment sources do not identify the actual waterbody used by the Japanese crews, so do not claim verified freshwater-lake pickup in the real operation. Preserve freshwater-lake gameplay through this disclosed adaptation.

Using the same haversine convention, the proposed ship-to-airport leg is approximately **23.36 km**, and airport-to-lake approximately **48.03 km**. These are straight-line design estimates; validate the actual routed distances, turns and clearance. Author early fire sectors around 1–3 km from the lake so several local refill cycles fit the session target. Longer sectors belong in advanced missions. Specific fire boundaries, protected sites and weather are authored.

Keep the player in the one ship-based helicopter represented in the Ketapang phase. The other two Japanese helicopters may be mentioned in the briefing; additional flyable aircraft or a Kijing/Pontianak campaign are outside the first release.

### World scale and map construction

Use one world metre per metre. Store latitude/longitude for geographic features and convert them into a documented local coordinate system. Preserve kilometre-scale separations.

For Singapore, build a bounded corridor covering ship, coast and lake, approximately 120 km north–south with enough lateral room for the intended routes. For Japan, build an independently bounded Ketapang corridor covering ship, airport, refill lake and fire sectors, initially around 70 km north–south and 65 km east–west. Retain full metre scale in both. Render only nearby detail; large coordinate extents do not imply uniformly detailed meshes or nationwide fire simulations.

Use a low-resolution base terrain and coastline plus streamed higher-detail sectors at the ship, lakes and mission targets. Prefer bundled, simplified, properly attributed geographic data. If detailed licensed data cannot be obtained, author a simplified geographical reconstruction and label its precision honestly. Retain the approximate placement and route scale of sourced features. Keep Japan’s authored lake explicitly separate from the real geographic layer.

Validate before locking the map:

- The LST waypoint lies in the sea, away from shoreline geometry.

- Lake refill zones lie within a validated freshwater polygon.

- Authored depths and open-water clearances are sufficient for the game’s bucket geometry.

- The full return route fits the fuel model in the mission’s forecast wind.

- Ground height queries and visible terrain agree.

- Fictional fires and communities are distinguishable from evidence-backed geographic layers in the scenario data.

Never obtain map coordinates by measuring an ASMC screenshot; its maps are illustrative. Never turn a satellite hotspot marker into a literal burning polygon. [S01] [S02]

### Training and future theatres

Each option has one guided training mission in a small **explicitly fictional coastal practice area** with a nearby freshwater lake, so the first refill occurs quickly. Use that option’s aircraft and ship. Singapore training teaches deck rigging/recovery; Japan training also teaches the airport handling transition using a labelled practice shore pad. Do not label a nearby training lake as Danau Sembuluh or call Japan training a recorded historical mission.

Keep **Ogan Komering Ilir and Danau Teluk Gelam, South Sumatra**, as the first expansion candidate. The current OKI response is well documented and Teluk Gelam is a documented lake, but it is well inland. Validate its coast-to-lake route and fuel feasibility before adding a playable mission. Do not move the lake beside the sea to shorten the flight. [S04] [S10]

The first release requires **two operational theatres and two tutorials**, one of each per playable option. Any later theatre is additional campaign content within these options, rather than a third nationality card.

## 5 Aircraft and ship references

### Singapore equipment

Use the RSAF CH-47F appearance and the RSN Endurance-class LST. The CH-47F reached full operational capability in 2024, and MINDEF explicitly documents a CH-47F refuelling aboard an RSN LST. [S11]

Use these aircraft values as public reference anchors:

| Parameter | Reference value |
|---|---:|
| Basic aircraft weight | 11,148 kg |
| Maximum takeoff weight | 22,680 kg |
| Published maximum speed | 170 knots, approximately 315 km/h |
| Published range | More than 400 nautical miles, approximately 741 km |
| Overall length | 30.14 m |
| Rotor diameter | 18.29 m |
| Height | 5.68 m |

These values come from the RSAF-specific MINDEF fact sheet. Its speed and range headlines are not loaded-bucket performance guarantees. Use its gross-mass limit rather than importing a different Chinook variant’s specifications. [S12]

Use a **5,000-litre bucket**. This scale has a direct Singapore precedent: MINDEF documents an RSAF Chinook using a 5,000-litre heli-bucket during the 2015 firefighting deployment to Sumatra. That historical mission is a reference for equipment scale, not evidence of the fictional 2026 deployment or its ship-based arrangement. [S13]

Model a ship approximately **141 m long and 21 m wide**. RSN publishes those Endurance-class dimensions. PIONEER documents a Chinook landing on RSS Persistence and describes a cleared flight deck of approximately 70 by 21 m. [S14] [S15]

Use “RSN LST” or an identified Endurance-class ship consistently. If using RSS Persistence, its pennant number is 209. Keep one clear helicopter operating area. [S14]

### Japanese equipment

Use **JGSDF CH-47JA** geometry, Japanese markings and a separately configured performance preset to represent the deployed CH-47. The operational releases identify the family as CH-47 without a suffix. The choice of a JA representative model is an explicit reconstruction decision; do not assert that the cited deployment release identifies a particular JA serial or configuration. The JGSDF equipment page documents the JA variant and its enlarged fuel tanks. [S24] [S25] [S28]

| Parameter | Japanese reference value |
|---|---:|
| Approximate aircraft self-weight | 11,500 kg |
| Maximum gross weight | 22,680 kg |
| Published maximum speed | Approximately 270 km/h |
| Published cruise speed | Approximately 260 km/h |
| Published range | Approximately 1,040 km |
| Overall length | 30.18 m |
| Rotor diameter | 18.29 m |
| Height | 5.69 m |

Use the JGSDF equipment page for the JA dimensions and performance headlines. The approximate 11,500 kg self-weight comes from a MOD comparison booklet; it is an initial model reference, not the weighing record of the deployed helicopter. These figures do not establish loaded-bucket performance, precise usable fuel capacity or an operational burn table. [S28] [S29]

Model **JS Kunisaki, LST-4003**, as a distinct **Ōsumi-class** ship, approximately **178 m long and 25.8 m wide**. JMSDF publishes these class dimensions and identifies Kunisaki’s pennant. Build its island/superstructure, flight-deck layout and markings from ship-specific references. The overall beam is not a measured usable landing-deck width, and the Endurance deck dimensions must not be copied across. [S30]

Use a **5,000 L gameplay water-load cap** for Japan. RRI’s contemporary report accompanying its interview with the Indonesian defence liaison describes five-tonne water loads, consistent with the operation-wide MOD total. The exact bucket manufacturer, model, nominal capacity and valve configuration are not established here. Use a generic suspended-bucket representation and label the rigging, line length, fill rate and release behaviour as game calibration. [S33] [S27]

Use separate aircraft, ship and bucket profile IDs for the two options, even where some game tuning is intentionally shared. Both should remain credible Chinooks, without artificial upgrade trees or national stat bonuses.

### Visual requirements

The Chinook must have the distinctive tandem-rotor silhouette, two three-bladed counter-rotating rotors, the correct broad proportions, landing gear, rear ramp shape, engines, hook and visible bucket. Do not add a tail rotor. Use public photographs to validate each chosen livery and major external features, including the Japanese aircraft’s JA-style enlarged sponsons. Source imagery is a reference, not automatically a licensed game asset.

Animate rotor spin without strong strobing or aliasing. Use a blended rotor-disc representation at operating speed and geometric blades at low speed.

Each ship must have its own recognisable hull, superstructure, flight deck, collision geometry, parking location and helicopter clearance zones. Singapore bucket handling and refuelling take place on its deck. Japan uses the authored airport bucket-handling sequence and a clean ship approach. Do not invent Chinook hangar stowage, automatic rotor folding or an aircraft-carrier elevator. Routine service/refuelling animations are gameplay abstractions, not reconstructed deck procedures.

Original, clearly recognisable procedural models are acceptable if suitable licensed models are unavailable. Replace crude blockout geometry before the polished release. Keep an asset manifest with source, licence, author, modifications and scale.

## 6 Mass and aircraft performance model

### Explicit game calibration

The following are **separate game profiles**. Aircraft reference masses and gross limits are sourced in section 5; crew/rigging allowances, dispatch fuel and fuel consumption are game calibration. Public references do not establish the precise 2026 fuel configuration or operating burn tables of either aircraft. The approximate Japanese self-weight also requires explicit model interpretation as an empty-aircraft baseline, so document that convention and count every added allowance once.

| Component | Singapore CH-47F game profile | Japan representative CH-47JA game profile |
|---|---:|---:|
| Aircraft baseline mass | 11,148 kg | 11,500 kg, approximate reference |
| Crew and portable mission equipment allowance | 600 kg | 600 kg |
| Empty bucket, line and rigging allowance | 250 kg | 250 kg |
| Default and first-release maximum dispatch fuel | 3,100 kg | 3,100 kg |
| Full water payload | 5,000 kg | 5,000 kg |
| Default fuel and full bucket gross mass | **20,098 kg** | **20,450 kg** |
| Default fuel and empty bucket gross mass | 15,098 kg | 15,450 kg |
| Configured maximum gross mass | 22,680 kg | 22,680 kg |
| Remaining gross-mass margin with default fuel and full water | 2,582 kg | 2,230 kg |

The 3,100 kg fuel allowance is a selected mission load and first-release dispatch cap, **not a claim about either aircraft’s physical tank capacity**. In Japan’s clean ship-to-airport leg, the bucket remains ashore and its 250 kg is absent from aircraft gross mass; with default fuel the clean gross mass is 15,200 kg. On attaching the empty rig, gross mass becomes 15,450 kg before allowing for fuel already burned. Save the bucket’s actual location and attachment state.

Use approximately 1 kg per litre for freshwater. Track fuel in kilograms and water in litres, converting water volume to mass exactly once.

The maximum first-release dispatch fuel and a full bucket fit within both baselines. Do not create an artificial rule forcing the player to sacrifice water for fuel at every launch. The important tradeoffs are working time, climb and hover margin, handling, weather and route length.

The safe planned fill is bounded by bucket capacity, available source water and the mass/power allowance for the current conditions. Evaluate the fully emerged suspended load; buoyancy during immersion must not hide an unsafe load. Show why a planned fill is limited. Hard gross-mass limits and available-power limits are separate checks. In assisted mode, reject an infeasible pickup or initiate controlled withdrawal before the planned limit, with enough allowance for water collected while lifting out.

### Flight model

Use a custom, stable, fixed-step flight model with:

- Full 3D position, velocity and attitude.

- Tilted rotor thrust, gravity and air-relative drag.

- Finite pitch, roll and yaw response.

- Sideways, backwards and stationary flight.

- Wind drift and seeded gusts.

- Load-dependent acceleration and power demand.

- A visible, dynamically responsive suspended load.

- Damped assisted controls that still respect available lift.

Use SI units internally. Distinguish true airspeed from ground speed. Wind changes ground speed and water drift; it must not be added as a second arbitrary movement force on top of an already wind-relative drag model.

Start with a bounded attitude controller, approximately 25 degrees maximum bank/pitch in the assisted mode, 0.5–1.0 second response smoothing, and enough inertia that releasing the stick does not stop the helicopter immediately. These are tuning targets, not aircraft handling specifications.

The vertical component of thrust must decrease when the aircraft banks. Gross mass must influence available climb rate. Hover assist may damp drift but cannot create unlimited lift.

Simplify the two-rotor aerodynamics into a single net force and torque model while retaining the correct visual rotors. Detailed blade-element aerodynamics, engine-start checklists and complex failure modelling are outside the first release.

### Load dynamics

While the rig is attached, use one helicopter body and one bucket point mass connected by a unilateral fixed-length cable constraint. Cable tension, suspended-load drag and suspended-load feed-forward apply only in that attached state. During Japan's clean ferry legs, the stored shore rig has no force or mass coupling to the helicopter; it remains a separate supported world object. Attaching or removing it updates the coupling, mass budget and performance envelope together.

The helicopter body carries aircraft, crew and fuel mass. The bucket body carries bucket/rigging and water mass. Apply gravity to each body and equal-and-opposite cable tension. Do not put bucket mass into the helicopter body and then apply its full suspended weight again.

The controller may use total gross mass for lift feed-forward, while the physical bodies retain their separate masses. Document this convention.

Make the load swing after acceleration, braking and turns. Let sustained wind displace the sling. Use damping and a bounded constraint solver to prevent unstable oscillation.

Filling and release change mass progressively. Released water inherits the bucket’s velocity; it should not give the helicopter an unexplained rocket-like impulse. Use a stable simplified immersion/buoyancy transition so lifting the full bucket feels heavy without explosive solver forces.

Target a clearly perceptible reduction in full-bucket climb and acceleration versus the same aircraft with an empty bucket. Calibrate and record the measured difference rather than claiming certified Chinook performance.

## 7 Fuel, range and transit

### Initial tuning targets

| Flight regime | Nominal airspeed | Reference fuel burn |
|---|---:|---:|
| Singapore clean ferry, bucket physically removed | 270 km/h | 1,050 kg/h |
| Japan clean ferry, bucket physically removed | 260 km/h | 1,050 kg/h |
| Either option: transit with empty bucket attached | 140 km/h | 1,000 kg/h |
| Either option: local transit with full bucket | Around 110 km/h | 1,250–1,300 kg/h |
| Either option: heavy hover and dipping | Appropriate to manoeuvre | 1,300–1,500 kg/h |
| Either option: mixed departure, shore handling and recovery allowance | Variable | 1,100 kg/h |

The shared loaded-flight values are deliberately disclosed starting calibration. They are not verified operating tables, nor evidence that the two variants have identical real performance. Keep all anchors in independently editable profiles and verify each implemented route.

Interpolate fuel burn smoothly with airspeed, mass and power demand; use these as calibration anchors. Document the interpolation and tune complete missions against the implemented model.

Use an assisted attached-bucket speed cap around **148 km/h**, labelled a conservative game envelope. Do not describe it as a verified RSAF or JGSDF external-load limit. Give a clear overspeed cue before the cap and reduce commanded acceleration smoothly.

There is no in-flight bucket-stow button. Empty and full suspended buckets both use the attached-load envelope. Clean ferry is optional/reference scope for Singapore; it is required for Japan’s ship-to-airport and airport-to-ship legs when the rig is physically left ashore. Never grant clean speed simply because an attached bucket is empty.

Use **500 kg as the game’s planned landing reserve**. It is a disclosed game policy, not an asserted RSAF or JGSDF regulation.

For Singapore, the clean calibration check 3,100 / 1,050 × 270 gives approximately 797 km to theoretical fuel exhaustion in still air. Japan’s selected 3,100 kg mission load at 260 km/h gives approximately 768 km by the same simplified calculation. Neither result is a bucket range or reserve-compliant mission radius. Japan’s published approximately 1,040 km range is a separate reference headline under other conditions; do not tune the dispatch fuel or burn merely to make every published maximum occur simultaneously. [S28]

### Singapore route example

For the proposed 90.7 km one-way ship-to-lake route:

| Budget item | Illustrative fuel |
|---|---:|
| Two 90.7 km empty-bucket transits at 140 km/h and 1,000 kg/h | 1,296 kg |
| 30 minutes of local work at an average 1,300 kg/h | 650 kg |
| Ten minutes total departure and recovery allowance at 1,100 kg/h | 183 kg |
| Planned landing reserve | 500 kg |
| Required departure fuel | Approximately 2,629 kg |
| Margin with 3,100 kg departure fuel | Approximately 471 kg |

This is a conservative still-air endurance/planning example, not the required duration of a standard mission. Recompute using actual waypoints, wind, load state, approach time and the implemented burn model. A longer detour or adverse weather can consume the margin.

For a standard mission, author approximately 8–12 minutes of local firefighting and 3–6 minutes of departure, approach and recovery, plus about 9.7 minutes of total transit at 8×. This gives roughly 21–28 wall-clock minutes. The same route at 4× adds about 9.7 minutes; disclose the longer session and preserve save/resume. Keep the larger fuel-planning allowances available as contingency, not mandatory waiting.

The ship is not visited after each water drop. A sortie consists of the outward transit, several lake-to-fire cycles, then a return when objectives or fuel require it.

### Japan route example

Plan Japan independently using the authored Ketapang layout. At default load, ferry clean between Kunisaki and the airport, attach the bucket ashore, fly empty to the reconstructed lake, perform local water cycles, return via the lake corridor to the airport, remove the rig and recover clean to Kunisaki.

| Budget item | Illustrative fuel |
|---|---:|
| Two 23.36 km clean ship/airport legs at 260 km/h and 1,050 kg/h | 189 kg |
| Two 48.03 km empty-bucket airport/lake legs at 140 km/h and 1,000 kg/h | 686 kg |
| 30 minutes of local work, including travel back to the lake corridor, at 1,300 kg/h | 650 kg |
| Ten minutes total ship/airport approach and handling allowance at 1,100 kg/h | 183 kg |
| Planned landing reserve | 500 kg |
| Required departure fuel | Approximately **2,208 kg** |
| Margin with 3,100 kg departure fuel | Approximately **892 kg** |

This is a still-air design calculation, not a historical fuel record. It assumes no intermediate refuelling. Charge actual fuel during airborne and engine-running handling phases; do not add the table’s allowance again as a separate deduction. Recompute after authoring detours, holding, wind and bucket work.

At 8×, the combined outer transit legs take about **6.5 wall-clock minutes**, before approaches. Target around 8–14 minutes of local work and 4–7 minutes of approaches/handling, giving approximately 19–28 minutes for standard sorties. At 4×, outer transit adds about 6.5 minutes. Use assistance only on suitable cruise segments; the shore stops, filling and drops remain at 1×. The 30-minute local-work budget is contingency capacity, not mandatory waiting.

### Return guidance

Continuously show:

- Fuel remaining in kg.

- Estimated fuel at the ship after the planned return and recovery.

- Planned reserve and margin above or below it.

- Estimated working time remaining.

- Return distance and ETA.

Recalculate after route changes, wind changes and load changes. Include the attached bucket’s drag envelope even when empty. For Japan, predict fuel through the airport unrigging stop and the final clean ferry to Kunisaki; reaching the airport is not the same as recovering aboard the ship. If returning with water, include its handling and a permitted disposal location before bucket recovery.

Warn on predicted arrival reserve, not just a fixed percentage of dispatch fuel. Provide “Return to ship” guidance and the selected campaign’s intermediate handling/diversion waypoints. Japan’s real airport-support role is documented, while precise in-game landing permissions and diversion outcomes remain authored. Let an early safe return or defined shore diversion produce partial completion instead of forcing a crash.

### Accelerated cruise

Provide optional **1×, 4× and 8× assisted transit**. The standard mobile experience may default to 8× once safe cruise is established.

At 140 km/h, the Singapore example one-way transit takes about 38.9 simulation minutes, or 4.9 wall-clock minutes at 8× before approaches. Make the active time multiplier visible.

Use the same fixed simulation steps for aircraft, fuel, fire, weather and objectives. Do not increase the physics timestep or freeze fires during cruise. At 30 rendering fps, 8× requires about 16 fixed 1/60-second steps per rendered frame; a conventional five-to-eight-substep cap is insufficient. Select an achievable effective multiplier before accumulating new simulation time, preserve completed ticks and bound catch-up work. If the device cannot sustain the chosen rate, reduce to 4× or 1× and show the effective rate rather than silently losing simulation time.

Enable accelerated transit only when the aircraft is stable, the bucket is empty or physically detached and stored at its handling site, the route is clear and the aircraft is well away from the deck, terrain hazards, refill areas and active drops. Return to 1× before a marked approach boundary, with enough stopping distance. Manual control immediately cancels acceleration.

Pause freezes the entire simulation. Accelerated transit advances it. Keep these behaviours distinct.

## 8 Bucket filling and water delivery

### Equipment and pickup

For both game profiles, begin with a fixed longline with a **22 m hook-to-bucket attachment length** and explicit bucket dimensions. Derive bucket-bottom clearance from those dimensions; do not treat the line length as the aircraft’s required altitude.

The helicopter fills by hovering and descending until the suspended bucket is immersed, then climbing clear. General helicopter-bucket training documentation supports this hover-and-dip mechanic. [S16]

A lake’s visual appearance alone is insufficient for refilling. Define freshwater refill polygons and immersion volumes, plus exclusions around shore vegetation, boats, fishing infrastructure and settlements.

Suggested initial game values:

| Setting | Starting value |
|---|---:|
| Water capacity | 5,000 L |
| Partial fills | Lift the bucket out before it is full |
| Maximum horizontal bucket speed while filling | 2 m/s |
| Stable immersion time for an empty-to-full fill | Approximately 8 seconds |
| Nominal full-fill rate at ideal immersion | 625 L/s |
| Release flow | Approximately 1,250 L/s; a full bucket takes 4 seconds |

The fill rate is game tuning. Begin partial filling as immersion permits; pause when the bucket leaves the volume or moves too fast. Preserve partial fills. Clamp the final increment exactly to physical capacity and available source volume. A partially filled open bucket continues filling while immersed; withdrawing it, including through the standard assistance described above, controls the collected amount.

Display bucket clearance, fill progress, load and a clear “too fast”, “not immersed”, “outside refill area” or “insufficient lift margin” cue. Add a brief captioned crew call when clear to lift.

Ocean water does not refill the bucket because this mission specifies freshwater sourcing. Do not state that helicopter buckets are physically incapable of using seawater.

### Release

For the initial release, use a single tap to start a complete dump of the water currently aboard. The valve remains open until empty, using the initial constant-flow game approximation of 1,250 L/s. A 2,500 L load takes about two seconds, a 3,750 L load three seconds and a full load four seconds. This avoids requiring a third finger while flying.

Use this one-tap, complete-dump behaviour as an accessible game approximation in both options. Do not assert that either deployment’s historical bucket had this exact valve or prohibit more capable real hardware by implication. A later controllable-valve configuration can add repeated start/stop pours when its equipment behaviour is explicitly modelled.

Permit hover drops and moving drops. The best delivery balances footprint, concentration, wind drift and obstacle clearance. Provide a forgiving assisted practice target, then teach the player to judge the release point.

The aiming aid must be calculated from the bucket’s actual position and velocity, release duration, wind and terrain. Represent the predicted footprint as an approximate area, not a guaranteed laser-accurate hit point.

Use game-specific clearance guidance. A practical initial target is a bucket outlet 20–35 m above the relevant ground or canopy surface with a slow, controlled approach. Calculate aircraft and rope clearance separately. Do not present these values as operating instructions for real flights.

### Water simulation and conservation

Keep authoritative water packets separate from visual spray. Start around ten packets per simulation second during release. Each packet carries litres, position and velocity. Integrate gravity, drag and wind, with swept ground/obstacle intersection so packets cannot tunnel through terrain.

On impact, distribute deposited litres using a normalized footprint over terrain cells. Track water that hits structures, open water or irrelevant ground separately from useful suppression. Model a bounded airborne loss fraction that increases with unsuitable height and wind.

Conservation must hold:

```text
releasedLitres =
  depositedLitres
  + airborneLossLitres
  + remainingAirborneLitres
```

Deposited water includes both useful and wasted deposition. Scoring must not count the same water twice.

A 5,000 L drop spread evenly over 1,000 square metres provides only 5 mm of application before losses. Design local suppression targets at an appropriate scale. One drop must not erase hectares of intense fire.

Use cheap visual particles to show the water curtain, spray and impact. Reducing particle quality must not change where authoritative water lands or how much fire it suppresses.

## 9 Fire, peat and environmental behaviour

### Fire model

Implement a small CPU fire grid over active mission areas. A good starting point is 10 m cells and no more than approximately 32,768 active/threatened cells, divided into sparse tiles. This is a rendering/gameplay scale, not a satellite resolution.

Each cell should contain at least:

```text
fuelRemaining
heat
surfaceWetness
surfaceBurnState
peatHeat
peatMoisture
terrainClass
protectedZoneId
```

Use stable update order and a seeded gameplay PRNG. Spread responds to neighbouring heat, fuel, wind direction, dryness, slope and wetness. Water and explicit cleared breaks interrupt surface spread. Smoke is driven by burning/smouldering state rather than independently animated without relation to the simulation.

Start with two mission-relevant fire classes:

1. Surface vegetation fires that can be locally extinguished by sufficient accurate water.

2. Peat-associated fires whose visible flames can diminish while residual heat remains.

Peat can smoulder underground for long periods, so visible flame removal must not automatically mean permanent extinguishment. [S17]

Use the states **burning**, **surface suppressed**, **being secured**, **secured** and **burnt out** with clear definitions. A burnt-out forest is not a successful protection outcome.

### Ground crew abstraction

Ground crews are NPC support. After the player sufficiently cools a designated area and opens a safe access corridor, a visible consolidation timer can begin. During consolidation, sustained wetness and low heat allow progress; renewed spread interrupts it.

Ground crews then secure the assigned local area, preventing re-ignition there under the mission rules. Explain this as a gameplay abstraction for follow-up work. Do not imply that minutes of aerial water permanently restore an entire peatland’s hydrology.

The pilot chooses a target priority with one tap on the paused tactical map. Avoid adding detailed squad micromanagement.

### Weather and visibility

Use authored and seeded weather profiles with wind, gust strength, visibility, temperature and optional local showers. Store each profile with its campaign date and provenance. Japan’s September missions may portray smoke-limited operations supported by the contemporary reports, but their exact winds, rain timing and visibility values are reconstructed; do not copy the October BMKG outlook as a September observation. [S27]

Begin training in clear conditions. Operational missions can add patchy haze, stronger crosswind, a wind shift and a local shower. Distinguish regional haze from near-fire smoke. Local drops may reduce local smoke while background haze remains.

Keep the flight path readable enough for the chosen difficulty. Smoke must not hide controls or turn every failure into an unreadable collision. Add terrain clearance cues and a mission map. Optional infrared-style target highlighting is an assist; it should not imply perfect underground fire detection.

Protecting settlements, ground-crew access and habitat buffers should be part of mission outcomes. Avoid a large wildlife AI system in the first release.

## 10 Ship operations and mission state

The selected ship is the persistent departure and recovery base for every operational sortie. Use a fixed geographic station during a mission, with gentle visual heave/roll represented consistently in collision transforms. Reposition only between missions. Japan can use different authored Kunisaki stations across its campaign, reflecting the documented value of ship mobility without claiming exact historical tracks. [S27]

Launch and recovery must account for the bucket. A suspended bucket cannot pass through the deck or disappear when the helicopter lands.

Use a shared mission-state engine with campaign-specific handling paths and visible states:

| Phase | Singapore sequence | Japan sequence |
|---|---|---|
| Parked / preparing | Aircraft and rig on the LST; crew handling and fuel/load confirmation | Aircraft on Kunisaki; bucket stored at shore handling site; fuel/load confirmation |
| Departing | Assisted deck manoeuvre establishes the empty bucket clear of ship geometry | Clean takeoff and ferry toward Rahadi Oesman |
| Shore rigging | Not required in the standard Singapore loop | Land at marked handling area; crew attach rig; assisted manoeuvre establishes the suspended empty bucket |
| Transit | Navigate to lake with empty bucket; optional accelerated cruise | Navigate airport-to-lake with empty bucket; optional accelerated cruise |
| Refilling / delivering | Immersion fill, lift and water drops | Immersion fill, lift and water drops |
| Returning | Reserve-aware route to the LST | Reserve-aware route to airport, including fuel for final ship recovery |
| Rig recovery | Empty bucket placed in designated deck handling area; crew detach/recover line | Empty bucket placed at airport handling area; aircraft lands; crew detach and store rig ashore |
| Final approach / landing | Aircraft settles onto cleared LST deck after rig recovery | Clean ferry from airport and touchdown on Kunisaki |
| Debrief | Containment, useful water, fuel and handling feedback | Same categories, scoped to Japanese mission and profile |

Implement explicit `bucketLocation` and `bucketAttachmentState` values. During clean Japan legs the rig is a shore object, not invisible airborne mass. Scripted crew transitions must maintain collision clearance and coherent mass/state updates. The Japan shore-pad layout, timings and exact sequence are gameplay reconstructions informed by documented airport support. [S31]

Represent difficult rigging actions through a short assisted animation or explicit handling transition at the appropriate deck or shore site. The player positions the aircraft and bucket; crew handling does not require extra simultaneous touches. Keep all transitions at 1× with clear progress, and charge the configured engine-running fuel. Standard mode assists placement; an optional challenge mode can demand more precision. Do not add a fictional flight winch solely to hide rigging.

Deck touchdown checks use position, attitude and velocity relative to the moving deck. Require all relevant gear contacts to be within the allowed landing region and avoid the superstructure. Validate Endurance and Kunisaki independently: landing polygons, gear contacts, rotor sweep, island/superstructure, approach paths and bucket-handling clearances are ship-profile data. The airport has its own ground-contact and exclusion geometry; it cannot accidentally satisfy a ship-landing objective.

Starting game tolerances may use less than 1.5 m/s lateral deck-relative motion, less than 1 m/s descent and less than 8 degrees pitch/roll, followed by a brief stable-contact interval. Tune for touch play. These are game thresholds, not ship operating limits.

A hard touchdown can produce a recoverable damage/score consequence; severe impact ends the sortie with a quick retry option. Use non-graphic failure presentation.

A successful sortie requires the objective’s specified containment outcome and a safe landing, or a clearly defined safe diversion/partial-success outcome. It must not end the moment the final water particle disappears.

## 11 Controls, camera and HUD

### Two-thumb control scheme

| Input | Default action |
|---|---|
| Left stick horizontal | Yaw rate |
| Left stick vertical | Assisted climb/descent command |
| Right stick horizontal | Left/right cyclic |
| Right stick vertical | Forward/back cyclic |
| Hover assist | Stabilize position and altitude within available power |
| Drop button | Start the single full dump |
| Camera button | Cycle chase, close chase and downward bucket view |
| Map button | Pause and open tactical planning |
| Pause button | Freeze mission and open menu |

The left vertical control is climb/descent assistance, not engine throttle. Releasing it commands zero vertical speed; releasing the right stick levels and damps the aircraft smoothly. Any manual flight input overrides hover assist or cruise autopilot.

Filling is automatic when physical conditions are met. Hover assist lets the player lift a thumb briefly to activate Drop or change camera without needing three simultaneous touches.

Also support keyboard/mouse through the same normalized command interface. Provide a configurable key guide and optional gamepad support after touch is complete.

### Touch implementation

Use Pointer Events with one owner per pointer ID and pointer capture on the sticks. Set `touch-action: none` on the game surface before interaction. Clear controls on pointer release, cancellation, lost capture, pause, visibility changes and orientation changes. The Pointer Events specification describes touch-action and pointer capture behaviour. [S19]

Default to fixed thumbsticks with optional floating placement. Include sensitivity, dead-zone, control-opacity and handedness settings. Use 48 CSS px minimum primary targets, with major flight buttons around 56–64 CSS px.

Respect safe areas, notches, the home indicator and browser chrome. Landscape is the primary flight layout; portrait provides a readable paused rotate prompt and usable menus. The game must work in an ordinary browser tab without requiring fullscreen or installation.

### Camera

Use a spring-damped chase camera with collision avoidance and restrained motion. Keep the bucket in view during approaches. Stabilize the horizon enough to reduce motion sickness.

Offer adjustable camera distance, field of view within sensible bounds, reduced motion, disabled shake and a persistent downward view during dipping. Do not require camera orbiting while both thumbs are flying.

### HUD

Show only the information needed for the current phase:

- Airspeed and ground speed with distinct labels.

- Height above relevant ground/water and bucket clearance.

- Water litres and fill percentage.

- Fuel kg and predicted landing reserve.

- Heading, next waypoint, distance and ETA.

- Wind arrow and strength.

- Hover/cruise-assist state and time multiplier.

- Fire objective progress and important crew calls.

Use metres, km/h, kilograms and litres by default, with an optional aviation-units display. Keep state and calculations in SI units.

The tactical map shows the selected ship by name, route, lake refill areas, fire sectors, protected zones, crew consolidation and diversion options. Japan additionally shows the airport and current rig-storage/handling location. Bind all labels to the active campaign, with no hard-coded RSN name in Japan. The map pauses this single-player game. Use shapes and labels as well as colour, including for wet, burning and secured cells; identify reconstructed refill lakes in map details.

Provide captions for operational audio. All important information must remain available with sound muted.

## 12 Missions, progression and scoring

Deliver **six missions per option, twelve total**: one tutorial plus five operational missions in Singapore, and one tutorial plus five operational missions in Japan. Both campaigns are selectable immediately; completing Singapore is not required to unlock Japan. Japanese mission names and objectives below are authored reconstructions within the documented operating period, not claims that these exact historical sorties occurred.

| ID | Option / mission | Main lesson and requirement |
|---|---|---|
| SG-01 | Singapore — Handling and first drop | Fictional practice area; launch, hover, fill, useful drop, deck rig recovery and landing |
| SG-02 | Singapore — First response | Complete offshore-to-Sembuluh sortie and contain a small surface fire with several local cycles |
| SG-03 | Singapore — Crosswind | Stabilise the load and suppress an advancing flank while preserving reserve |
| SG-04 | Singapore — Protect the access route | Keep a road and protected site viable until ground crews consolidate |
| SG-05 | Singapore — Persistent peat heat | Revisit residual heat and maintain conditions for crews to secure it |
| SG-06 | Singapore — Changing conditions | Manage a wind shift, competing targets and a safe return |
| JP-01 | Japan — Ship and shore handling | Explicit practice mission; clean ship departure, shore rigging, lake fill/drop, unrigging and ship recovery |
| JP-02 | Japan — Ketapang response | First complete reconstructed operational loop through Rahadi Oesman and the labelled refill lake |
| JP-03 | Japan — Working through haze | Maintain a readable approach, follow visibility cues and place useful water without losing the return route |
| JP-04 | Japan — Protect the ground team | Hold a fire boundary and keep an access corridor usable for Indonesian ground crews |
| JP-05 | Japan — Watch the peat | Follow up residual heat with repeated useful drops and ground consolidation |
| JP-06 | Japan — Changing smoke, new station | Launch from a different between-mission Kunisaki position; replan ferry, handling and reserve before final containment |

For JP-02 through JP-06, assign scenario dates within 23–29 September in chronological order. A selected day and its weather are authored mission scheduling, not a statement that the named task occurred on that date.

Author Singapore operational fires near suitable sectors of Danau Sembuluh. Author Japanese operational fires around the labelled reconstructed Ketapang refill lake, with the airport handling stops in every standard operational loop. Keep early lake-to-fire distances around 1–3 km; tune drop requirements against actual cycle duration. Do not transplant fire polygons or mission coordinates between the two theatres.

Size early target areas so three to six competent drops can achieve the local objective. Do not make the first missions about extinguishing an entire regional disaster. Advanced missions can contain a larger fire by protecting a selected boundary while ground teams work elsewhere.

Mission deadlines must be based on simulation time and account for the real transit. They cannot expire automatically during a reasonable outward flight. Validate authored weather and routes together.

Progression unlocks later missions and optional challenge settings within each campaign; baseline flight assists remain available. Track completions and medals separately for Singapore and Japan. The helicopter does not gain implausible extra capacity or speed through upgrades. Cosmetic rewards and mastery medals are sufficient.

Suggested 100-point debrief weighting:

| Category | Weight |
|---|---:|
| Objective protection and containment | 45 |
| Useful water placement | 20 |
| Aircraft handling and safe recovery | 20 |
| Fuel/reserve management | 15 |

Efficiency is useful suppression divided by released water, with context for deliberate protective wetting. Do not reward dumping water aimlessly. Avoid counting the same secured objective repeatedly for score.

Prevent “wait until everything burns out” victories. Burned protected areas fail their objective even if no flames remain. Ground crew outcomes and secured-area states must survive saving and resuming.

Allow free practice, replay, pause, save/resume and restarting the current mission. No login, paid upgrades, advertisements, multiplayer or online leaderboard are required.

## 13 Technical architecture

### Stack

For a new repository, use:

- TypeScript with strict checking.

- Vite for development and production builds.

- Three.js directly for 3D rendering.

- Lightweight DOM/CSS for menus and HUD.

- IndexedDB for versioned mission saves.

- A focused unit-test runner for simulation logic.

- Playwright or an equivalent browser test tool for integration and layout checks.

Use current mutually compatible stable releases at implementation time and commit the lockfile. If the existing repository already uses React, retain it for interface components where useful, but keep per-frame simulation state out of React rendering.

Use Three.js WebGLRenderer and **WebGL2** as the first release’s tested rendering baseline. Current Three.js documentation states that this renderer requires WebGL2. [S18]

WebGPU is optional later. Safari has supported WebGPU since Safari 26, so do not justify the baseline by claiming all iPhones lack it. The reason for the baseline is a smaller rendering and testing surface for this game. [S20]

No backend is required. Serve static assets over HTTPS. Bundle the selected scenario and decoder assets with the application; do not rely on an external CDN during play.

### Module boundaries

| Module | Responsibility |
|---|---|
| `campaigns` | Exactly two package manifests; profile references, dates, evidence labels and mission lists |
| `sim/clock` | Integer ticks, pause, transit multiplier and replay |
| `sim/aircraft` | Attitude, forces, mass, fuel and performance |
| `sim/bucket` | Cable, load, immersion and release state |
| `sim/water` | Authoritative packets, collision and deposition ledger |
| `sim/fire` | Surface fire, peat state and wetness |
| `sim/weather` | Wind, gusts, visibility and rain |
| `sim/missions` | Campaign-specific handling routes, objectives, NPC consolidation and outcomes |
| `world` | Georeferencing, terrain, coast, lakes, obstacles, independent decks and airport ground queries |
| `render` | Scene, assets, lighting, LOD, effects and cameras |
| `input` | Touch, keyboard and optional gamepad adapters |
| `ui` | Menus, tutorial, HUD, map and accessibility |
| `persistence` | Campaign-scoped checkpoints/progression, versions, migrations and restore |
| `devtools` | Local telemetry, replay and debug overlays |

Keep `SimState` serializable and free of Three.js, DOM and audio objects. Rendering reads state and never determines mission outcomes. Resolve an active campaign manifest into immutable aircraft, bucket, ship, theatre and mission profiles at load time. Missing or incompatible references fail with a readable loading error. Shared simulation code must not assume an RSAF aircraft, an Endurance deck, a particular lake or deck-only rigging.

Authoritative terrain height, collision geometry, water masks and fire state must remain available independently of visible tiles and LOD. Unloaded scenery cannot create collision holes or suspend distant fires. Keep lightweight world-query data resident or deterministically queryable throughout the route.

### Clock and determinism

Use fixed 60 Hz aircraft, cable and water updates, with rendering interpolation. Start fire updates at 2 Hz and weather target updates at 1 Hz, scheduled from integer simulation ticks.

Use separate PRNG streams for gameplay and visual effects. Changing smoke density or graphics settings must not change fire spread or score.

The same saved scenario seed and tick-indexed inputs should reproduce mission outcomes on the same implementation. Use tolerances for floating-point motion across browser engines rather than promising bit-identical trajectories everywhere.

Use a documented coordinate convention such as x east, y up, z south. Keep authoritative world coordinates in JavaScript doubles. Use a render-origin offset or coordinated rebasing to preserve GPU precision across both theatres, including Singapore’s approximately 90 km one-way corridor. Apply the same transform to aircraft, bucket, water, terrain and camera.

At accelerated transit rates, simulate additional fixed steps. Profile before moving fire calculation to a Worker. A Worker is an implementation option when a measured CPU bottleneck warrants it; it must preserve tick ordering and save-state consistency.

## 14 Assets, art and mobile performance

Use a restrained semi-realistic visual style: convincing proportions, coherent materials, atmospheric lighting and readable silhouettes. Prioritise the aircraft, bucket, ship and nearby fire. Keep far scenery inexpensive.

Use GLB assets with LODs and shared materials. Consider KTX2/Basis textures; Three.js requires capability detection before its KTX2 loader selects/transcodes supported texture formats. Include decoder cost and files in the application budget. [S21]

Use instanced trees, rocks and repeated buildings; chunked terrain; one sun; simple ambient lighting; inexpensive animated lake/ocean normals; bounded smoke and spray pools. Avoid baseline volumetric raymarching, real-time planar reflections, costly screen-space effects and many transparent layers.

Suggested starting budgets apply to the **currently selected option**. Load only that option’s detailed aircraft, ship and theatre; share the common shell, code, audio and effects. The two-card menu should use lightweight previews. Do not require both campaign scenes in memory before first play.

| Metric | Baseline mobile target |
|---|---:|
| Sustained rendering | 30 fps |
| Steady frame pacing | Median at most 34 ms; p95 at most 40 ms |
| Long stalls after loading | Fewer than 1% of frames above 100 ms |
| Render buffer | Approximately 0.5–1.0 million pixels |
| Effective DPR | Usually 1.0; no more than 1.5, also enforce pixel cap |
| Draw calls | Prefer at most 100; peak at most 150 |
| Visible triangles | Approximately 200,000 or fewer |
| Dynamic shadows | One local 1024² map or cheaper low-mode contact shadow |
| Decoded resident textures | Target at most 96 MiB |
| Geometry buffers | Target at most 32 MiB |
| Game-owned CPU data | Target at most 64 MiB |
| Compressed application shell | At most 3 MB |
| Additional first-playable assets | At most 12 MB |
| Complete selected-theatre transfer | At most 35 MB |
| Chinook highest-detail mesh | Approximately 25,000 triangles |
| LST highest-detail mesh | Approximately 30,000 triangles |

These are engineering targets to verify, not claimed browser limits. Resource accounting covers game-owned allocations; do not pretend it measures the browser’s complete process memory.

Target current Safari on an iPhone 13-class device and Chrome on a Pixel 6a-class Android device, with better phones able to select 60 fps. Confirm exact devices and browser versions in the final verification report.

Use adaptive quality with hysteresis. Reduce resolution, smoke instances, shadows and distant detail when necessary. Never reduce simulation fidelity, change physics constants or delete active fire cells to improve frame rate.

Preload/precompile the expected first-mission materials where practical. Show real loading progress, retry failures, and avoid a long black screen.

Dispose of retired geometries, textures, event handlers and campaign-specific simulation resources. Save the outgoing mission before switching options, then unload its scene and load the selected package. Repeated restarts and Singapore/Japan switches must not grow retained resource counts continuously.

## 15 Browser lifecycle, offline use and saves

The game must handle mobile interruptions as normal behaviour.

On page hiding or loss of a safe interactive state:

1. Clear all control inputs.

2. Freeze simulation time.

3. Suspend audio.

4. Request a checkpoint save.

5. Return to a paused screen requiring an explicit Resume tap.

Also autosave periodically during play and after important transitions. Do not rely on a final asynchronous save when the OS closes the tab. Resume from the last successfully saved checkpoint if an interruption prevents the newest write.

Maintain **one resumable mission per campaign**, plus separate unlocks, medals and best results. Switching from Singapore to Japan must not overwrite Singapore progress. Save headers include `campaignId`, `missionId`, `scenarioVersion` and the referenced aircraft, ship, bucket and theatre profile versions. Save the rig’s storage location and any in-progress shore/deck transition. Restore only compatible states, or apply an explicit migration. Existing original-brief saves without a campaign ID may migrate to Singapore only when their schema identifies the original Singapore content. Graphics, audio, controls and accessibility preferences can remain global.

Reset the wall-clock accumulator on resume. Do not simulate the entire background interval in one frame.

Start or resume audio from Play/Resume interaction. Handle muted or blocked audio without breaking the game. Add rotor/load, wind, water and fire layers, plus brief captioned crew calls. Limit simultaneous voices and provide independent volumes.

Handle WebGL context loss by pausing and preserving state. Recreate resources or restore the latest checkpoint, with a readable recovery screen.

After the core game is stable, add a manifest and service worker. Cache the common shell and each downloaded campaign separately. Show “Singapore available offline” or “Japan available offline” only after all that package’s required assets are stored. Apply updates between missions, retaining one coherent asset/data version for each resumable save. Downloading Japan is not a prerequisite for offline Singapore play, or vice versa.

Browser storage can be evicted; WebKit documents best-effort storage and eviction policies. Handle a missing save or cache cleanly. Provide save export/import if feasible within the first-release work. [S22]

Do not require live geolocation, microphone, camera, device-motion permissions or user accounts. Touch controls are the default. Avoid external analytics dependencies.

## 16 Scenario data and provenance

Keep aircraft tuning, gameplay settings and mission content in versioned data, not scattered constants.

Keep a top-level registry with exactly two manifests: `sg_fictional_2026_10` and `jp_ketapang_2026_09`. Use `evidenceMode: fictional_inspired` for Singapore and `evidenceMode: documented_operation_reconstruction` for Japan. Each campaign/scenario package should include:

```text
campaignId
campaignVersion
displayName
evidenceMode
operatorProfileId
aircraftProfileId + version
shipProfileId + version
bucketProfileId + version
theatreId + version
missionIds
contextSnapshotId
contextAsOf
operationDateStart / operationDateEnd
scenarioId
scenarioVersion
scenarioDate
title
geographicOrigin
realGeographyReferences
documentedOperationFacts
reconstructedGameplayElements
shipWaypoints + provenance
shoreHandlingSites + provenance
bucketStorageLocation
freshwaterPolygons + provenance
refillZones
obstacleAndExclusionZones
authoredFirePatches + provenance
protectedObjectives
weatherProfile + provenance
groundCrewRules
flightRoute + per-leg attachment state
fuelPlanningPolicy
missionSeed
evidenceReferences
```

For every evidence reference, store:

```text
sourceId
title
publisher
url
publishedAt
observedAt
retrievedAt
supports
limitations
```

Use null for unknown dates. Distinguish observation, publication and retrieval dates. The date on a website footer is not automatically the date of the event.

Store evidence-backed operation facts and geographic references separately from mission geometry. Tag each geometry object as `geographic_reference`, `simplified_reconstruction` or `fictional_gameplay`, with its own source IDs when applicable. A real-operation campaign label does not turn its reconstructed lake, authored fire perimeter or designed ship waypoint into a verified historical feature. Profile fields also need provenance: source reference, approximate public reference, or game calibration.

Bundle two replayable context snapshots: Singapore’s October 2026 regional context and Japan’s September 2026 deployment record, both researched as of 9 October. A later build-time update script can refresh public references without silently changing saved historical scenarios. The game must not need credentials or a fire API to start. Never put API secrets in the client bundle.

Validate data schemas on build and on loading saves. Reject invalid ranges, impossible routes, duplicate objective IDs, incorrect campaign/profile pairings, dates outside the campaign window and out-of-bounds geometry with useful errors.

## 17 Implementation sequence

### Milestone 1 Two complete greybox loops

Create the shared engine, fixed clock, normalized inputs, exactly two option cards and both package manifests. Build one complete Singapore practice slice and one complete Japanese practice slice with distinct placeholder aircraft/ship profiles and handling geometry.

In both slices, complete ship takeoff, immersion-based progressive fill, one useful drop, measurable suppression, rig recovery, ship landing and debrief. Japan must include the clean ferry and shore rigging/unrigging stops. Include pause, restart, save/resume and switching options without losing the other checkpoint.

Pass both complete loops and the two-thumb interaction check before expanding either campaign. This is the first gate against hard-coded Singapore assumptions.

### Milestone 2 Load and fuel simulation

Implement both mass/fuel profiles, cable behaviour, load-dependent flight, correct clean/attached transitions, route-aware reserve prediction and campaign-scoped save/load.

Add tests for water conservation, load response, bucket state transitions and landing relative to the deck.

### Milestone 3 Operational geography

Add the Sembuluh and Ketapang theatres, airport support geometry, validated sea/freshwater game polygons, full-scale routes, local sectors and accelerated cruise. Keep the Japanese authored refill lake visibly labelled as a reconstruction.

Demonstrate a complete operational route in each theatre with correct time, bucket state and fuel accounting. Confirm that the first operational missions remain achievable in their authored wind.

### Milestone 4 Firefighting depth

Add wind-sensitive footprints, surface and peat states, protected areas and ground crew consolidation. Complete all five operational missions per campaign, giving ten operational missions plus the two tutorials.

Playtest useful drop sizes, mission durations and early-return outcomes.

### Milestone 5 Mobile presentation and resilience

Finish both aircraft and ships, their environments, cameras, sound, HUD, two tutorials, graphics presets, campaign-specific offline caches and lifecycle recovery.

Profile sustained play on real phones where available. Fix touch interruption, overdraw, shader and resource-leak issues.

### Milestone 6 Delivery

Produce a reproducible production build, preview, source documentation and verification report. Explain any missing real-device evidence precisely. The game can be functionally complete while hardware performance validation remains explicitly pending; do not claim measurements that were never made.

## 18 Acceptance criteria

### Core playability

- Exactly two playable option cards appear: Singapore (fictional) and Japan (real), with the required date and reconstruction subtitles.
- A new player can complete either tutorial using two thumbs.

- Every operational sortie starts from its selected ship and can return to it; Japan’s standard loop includes the shore handling stops.

- Freshwater pickup depends on actual bucket immersion.

- A complete lake-to-fire-to-lake cycle works repeatedly.

- Full and empty loads feel and behave differently.

- Water visibly changes fire state and mission progress.

- The game supports partial completion and safe early return.

- The player can complete and replay all twelve missions: six per option.

- No placeholder buttons or essential dead-end screens remain.

### Simulation and data tests

| Test | Required result |
|---|---|
| Frame-rate independence | The same tick-indexed inputs at 30 and 60 rendering fps produce equivalent simulation results |
| Pause | Five real minutes paused changes no fuel, fire, weather or mission time |
| Transit multiplier | A fixed simulated route at 1×, 4× and 8× uses equivalent time, fuel and fire evolution |
| Mass bookkeeping | Default fuel/full-water masses are 20,098 kg for Singapore and 20,450 kg for Japan; rig and water are counted once |
| Load response | Full bucket has lower measured performance margin under the same conditions |
| Gross-mass enforcement | No fill or departure exceeds configured hard limits |
| Fill validity | No filling from sea, outside polygons, above water or at excessive bucket speed |
| Partial fill | Leaving the water preserves the volume already collected |
| Release conservation | Released/deposited/lost/airborne totals close within max(1 L, 0.1% of released volume) |
| Drop behaviour | Wind shifts the footprint; higher/faster drops change coverage and concentration coherently |
| Peat persistence | Surface suppression can leave residual heat; securing requires mission follow-up |
| Protected objectives | Letting a protected area burn out cannot count as saving it |
| Return estimate | Each route, wind and attachment state affect predicted ship-landing fuel; Japan includes airport handling and final clean ferry |
| Save/load | Correct campaign/profile, tick, PRNG, position, fuel, water, rig location, fire, weather and objectives survive restore |
| Deck landing | Endurance and Kunisaki each use their own deck/rotor-clearance geometry; adjacent water, ground or airport cannot satisfy ship landing |
| World origin | Rebase or render-origin changes do not jump the sling, droplets or terrain collision |
| Scenario validation | Invalid geographic/state references are rejected before play |
| Campaign switching | Outgoing checkpoint/progression is retained; selected aircraft, ship, world and dates load without cross-campaign leakage |
| Rig transitions | At the game handling site, attachment changes gross mass, speed envelope and cable coupling together; a detached shore rig exerts no force on the aircraft, with no teleport through geometry |
| Evidence labels | Japan’s real deployment is distinct from authored missions/refill lake; September and October dates are not conflated |
| Profile migration | Identifiable legacy Singapore saves migrate correctly; incompatible profile versions give a recoverable error |

Use meaningful headless tests for numerical/state rules and a small number of browser flow tests. Avoid a large suite of assertions that merely copy implementation constants.

### Mobile browser checks

- Two independent sticks work without scrolling or pinch zoom.

- Pointer cancellation never leaves a stuck control.

- Safe areas are respected in both landscape directions.

- Rotation, browser chrome resizing, app switching and screen lock recover cleanly.

- Audio blocking or mute does not conceal essential cues.

- Graphics-context loss returns to a recoverable state.

- A fully cached mission runs offline in each downloaded option; offline availability labels are accurate per campaign.

- Ten restarts and ten Singapore/Japan switches do not produce continuously growing retained resources or lost campaign progress.

- Menus remain readable in portrait.

- One complete operational sortie in each option is playable without a mouse, keyboard or gamepad.

### Performance validation

Run at least 20 minutes and one complete operational sortie, whichever is longer, **in each option**, including smoke, full-bucket movement, drops, map use, an 8× transit segment, a tested 4× fallback and return to the correct ship. Include Japanese airport rigging and unrigging. Record device, operating system, browser build, campaign, preset, frame-time statistics and any thermal degradation.

At least one older supported iPhone and one representative Android phone should be checked before claiming the mobile performance target is met. Browser emulation can validate layout and interactions, but it cannot establish actual phone GPU or thermal performance.

Stop optional testing once the defined risks and release gates are resolved. Fix a demonstrated issue rather than repeatedly broadening the test scope.

## 19 Required delivery

Provide:

1. A runnable repository and production build.

2. Clear install, development, test, build and preview commands.

3. A working preview appropriate to the environment.

4. The complete first release with exactly two selectable options and twelve missions: one tutorial and five operational missions per option.

5. Separately editable campaign, aircraft, ship, bucket, theatre, weather, mission and scenario profiles.

6. Asset and geographic-source credits with licence information.

7. A short flight/fuel model explanation identifying game assumptions.

8. The dated Singapore October context and Japanese September operation snapshots, with source register and explicit reconstruction notes.

9. A verification report with tested devices and concrete remaining limitations.

10. A concise final handover explaining how to play and what was completed.

For a new Vite project, expose conventional commands such as `npm run dev`, `npm run test`, `npm run build` and `npm run preview`. Keep deployment compatible with static hosting and relative asset paths. Follow the deployment destination and authorisation established in the implementation session.

Do not call the game complete based solely on a successful build. Demonstrate the full launch, refill, suppression and ship-return loop in both selectable options, plus the Japanese shore-handling transitions.

## 20 Source register

All sources below were checked for this brief on 9 October 2026. Stable equipment and geography references retain their own publication dates. Public-source facts and design assumptions are separated throughout the brief.

| ID | Source | What it supports |
|---|---|---|
| S01 | [ASMC regional haze situation][S01] | Regional conditions, alert display, hotspot and map limitations |
| S02 | [NEA haze portal][S02] | Regional update shown at 10:38 AM on 9 October 2026 |
| S03 | [BNPB situation report dated 1 October 2026][S03] | Provincial response, with observations through 30 September |
| S04 | [South Sumatra government OKI response report][S04] | 4 October aerial patrol/meeting, published 5 October |
| S05 | [BMKG forecast for 6–12 October 2026][S05] | Dry conditions, smoke and potential local rain |
| S06 | [Central Kalimantan tourism department on Danau Sembuluh][S06] | Lake, landscape and surrounding communities |
| S07 | [Official Sembuluh Satu freshwater fisheries page][S07] | Freshwater character; page date is not usable |
| S08 | [GeoNames lake reference][S08] | Approximate point and alternate names |
| S09 | [Indonesian aviation authority Kuala Pembuang record][S09] | Geographic airport reference |
| S10 | [Tourism directory for Danau Teluk Gelam][S10] | Expansion-lake identity and location |
| S11 | [MINDEF CH-47F operational capability announcement][S11] | Contemporary aircraft and documented LST refuelling |
| S12 | [MINDEF RSAF CH-47F fact sheet][S12] | Aircraft dimensions, weights and published performance headlines |
| S13 | [MINDEF 2015 Indonesia firefighting conclusion][S13] | Historical 5,000 L bucket precedent |
| S14 | [RSN ships overview][S14] | Endurance-class size and ship identities |
| S15 | [PIONEER first Chinook landing on an LST][S15] | Actual deck landing and published deck dimensions |
| S16 | [NASA helicopter bucket training][S16] | General hover/dip and water-delivery mechanics; not Chinook performance |
| S17 | [UNEP on peatlands][S17] | Persistent underground smouldering and habitat context |
| S18 | [Three.js WebGLRenderer documentation][S18] | WebGL2 renderer baseline |
| S19 | [W3C Pointer Events specification][S19] | Pointer capture and touch-action |
| S20 | [WebKit Safari 26 features][S20] | WebGPU availability in Safari 26 |
| S21 | [Three.js KTX2Loader documentation][S21] | Compressed texture support detection/transcoding |
| S22 | [WebKit storage policy][S22] | Storage persistence and eviction limitations |
| S23 | [Japan MOD deployment order, 28 August 2026][S23] | Three JGSDF CH-47s assigned to Kunisaki |
| S24 | [Japan MOD Ketapang arrival, 21 September 2026][S24] | One CH-47 aboard Kunisaki off Ketapang and two at Kijing |
| S25 | [Japan MOD ship-launched firefighting, 23 September 2026][S25] | CH-47 launch from Kunisaki offshore Ketapang and start of local firefighting |
| S26 | [Japan MOFA conclusion, 29 September 2026][S26] | Overall firefighting dates of 16–29 September and end of local activities |
| S27 | [Japan Chief of Joint Staff press conference, 2 October 2026][S27] | 56 releases / approximately 280 tonnes; smoke constraints and value of ship repositioning |
| S28 | [JGSDF aircraft equipment reference][S28] | CH-47JA dimensions, gross mass, headline speed/range and enlarged tanks; not deployed serial identification |
| S29 | [Japan MOD aircraft comparison booklet, September 2014, page 5][S29] | Approximate CH-47JA self-weight of 11,500 kg; not an individual aircraft weighing record |
| S30 | [JMSDF Ōsumi-class ship reference][S30] | Kunisaki LST-4003 identity and 178 m × 25.8 m class dimensions |
| S31 | [Rahadi Oesman airport operational support report, 23 September 2026][S31] | CH-47 landing, bucket handling and cable arrangement at the airport; not every sortie sequence |
| S32 | [Rahadi Oesman official airport technical data][S32] | Published ARP coordinates; not a helicopter handling-pad survey |
| S33 | [RRI reporting with Indonesian defence-liaison interview, 21 September 2026][S33] | Contemporary account of five-tonne water loads and visibility issues; exact bucket model unverified |

[S01]: https://asmc.asean.org/home/
[S02]: https://www.haze.gov.sg/
[S03]: https://bnpb.go.id/berita/perkembangan-situasi-dan-penanganan-bencana-di-tanah-air-1-oktober-2026
[S04]: https://satudata.sumselprov.go.id/publikasi/berita/atasi-akar-masalah-karhutla-gubernur-sumsel-gandeng-kades-tnipolri-dan-perusahaan-di-oki
[S05]: https://www.bmkg.go.id/cuaca/potensi-hujan-sepekan/prakiraan-cuaca-indonesia-sepekan-periode-06-12-oktober-2026-awal-oktober-masih-didominasi-kondisi-kering-waspadai-hujan-lebat-lokal
[S06]: https://visit.kalteng.go.id/kawasan-desa-adat-bangkal-dan-danau-sembuluh/
[S07]: https://sembuluhsatu.digitaldesa.id/potensi/perikanan-air-tawar
[S08]: https://www.geonames.org/1627852/danau-pelajau.html
[S09]: https://hubud.kemenhub.go.id/bandara/209
[S10]: https://www.direktoripariwisata.id/unit/3383
[S11]: https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_nr/
[S12]: https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_fs/
[S13]: https://www.mindef.gov.sg/news-and-events/latest-releases/2015oct24-news-releases-01712/
[S14]: https://www.navy.gov.sg/our-forces/ships/
[S15]: https://defencepioneer.sg/pioneer-articles/first-chinook-landing-on-lst
[S16]: https://www.nasa.gov/centers-and-facilities/kennedy/bambi-bucket-training-prepares-helicopter-crews-for-fighting-fires/
[S17]: https://www.unep.org/news-and-stories/story/why-peatlands-matter
[S18]: https://threejs.org/docs/pages/WebGLRenderer.html
[S19]: https://www.w3.org/TR/pointerevents/
[S20]: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
[S21]: https://threejs.org/docs/pages/KTX2Loader.html
[S22]: https://webkit.org/blog/14403/updates-to-storage-policy/
[S23]: https://www.mod.go.jp/j/press/news/2026/08/28h.html
[S24]: https://www.mod.go.jp/j/press/news/2026/09/21a.html
[S25]: https://www.mod.go.jp/j/press/news/2026/09/23a.html
[S26]: https://www.mofa.go.jp/mofaj/press/release/pressit_000001_04224.html
[S27]: https://www.mod.go.jp/js/about/message/2026/1002.html
[S28]: https://www.mod.go.jp/gsdf/equipment/air/index.html
[S29]: https://www.mod.go.jp/rdb/kyushu/topics/104yanagawa/260901.pdf
[S30]: https://www.mod.go.jp/msdf/equipment/ships/lst/osumi/
[S31]: https://hubud.kemenhub.go.id/upbu/rahadi-oesman/kategori/kegiatan-kerja-sama/berita/bandara-rahadi-osman-siap-dukung-operasi-water-bombing-karhutla-dengan-ch-47-bantuan-jepang-8h8xb
[S32]: https://hubud.kemenhub.go.id/upbu/rahadi-oesman/data/bandara
[S33]: https://rri.co.id/nasional/2747256/helikopter-chinook-dari-jepang-bantu-pemadamanan-karhutla-di-kalimantan-barat
