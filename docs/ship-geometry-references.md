# Ship geometry review — 9 October 2026

The ships are authored, closed procedural meshes in `src/render/ships.ts`. Their external silhouettes and major arrangements follow the references below; they are not engineering models or a claim about a particular deployment fit. No reference photographs are bundled as game assets.

## Primary evidence

- [RSN ship equipment page](https://www.navy.gov.sg/our-forces/ships/): Endurance class 141 m length, 21 m beam; RSS Persistence pennant 209; forward 76 mm gun. Its aerial image was not retrievable during this review, so it was not used as unseen visual evidence.
- [PIONEER, First Chinook Landing on LST, 7 January 2005](https://defencepioneer.sg/pioneer-articles/first-chinook-landing-on-lst): Persistence's 70 × 21 m flight deck and actual Chinook operation. The linked deck photograph was inspected.
- [PIONEER, Hitting the Beach, 27 September 2022](https://defencepioneer.sg/pioneer-articles/hitting-the-beach%21): inspected ship-specific photograph of a CH-47F delivering a vehicle to Persistence. It shows the grey deck, hollow circle with numeral 2, central tracks, transverse guide, white edge lines, outboard folded safety nets, and 209 across the stern. Photograph: [photo 2](https://defencepioneer.sg/images/mindefpioneerlibraries/default-source/articles/ont/2022/27-sep-2022/27sep22_photo2.jpg?sfvrsn=68faf3ab_2).
- [MINDEF upgrade reply, 17 February 2015](https://www.mindef.gov.sg/news-and-events/latest-releases/2015mar11-media-queries-00032/): Persistence had received the class upgrade including hangar support and upgraded ASIST. This is not evidence for every current antenna.
- [JMSDF Ōsumi-class equipment page](https://www.mod.go.jp/msdf/equipment/ships/lst/osumi/): 178 × 25.8 m; Kunisaki is 4003; two 20 mm CIWS. Inspected the [ship-specific official photograph](https://www.mod.go.jp/msdf/equipment/ships/lst/osumi/img/main_4003.jpg).
- [JMSDF Kunisaki pamphlet](https://www.mod.go.jp/msdf/cjbf/kunisaki_pumphlet.pdf), page 3: inspected annotated appearance drawing and deck photographs. Supports starboard island, two elevators, aft flight deck, mast/radars, crane, side ramp and two CIWS. Photo/diagram source attribution: 海上自衛隊ホームページ (JMSDF website).

## Supplementary first-hand visual evidence

- [James M. Gose / jimmyweee, Persistence passing the Singapore Strait, 26 June 2007](https://commons.wikimedia.org/wiki/File:Singapore_Strait_Passing_warship.jpg), CC BY 2.0, original photographer's image hosted on Wikimedia Commons. Inspected for hull rake, central full-width bridge, side boat bays, davit frames, tall mast and aft flanking exhausts. Its age is explicit: antennas and fine fittings are approximate; the model does not claim a verified 2026 fit.

## Geometry and material interpretation

The station hulls use B/2, a raked narrow bow, almost straight aft sides, flat transom, closed well-dock gate and a continuous deck. The upper hull flares slightly above the waterline and tucks inward below it. The boot stripe and red underwater paint follow those hull stations rather than appearing as rectangular slabs. Side pennants are painted digits. Repeated rail and fitting geometry is merged by material to keep the draw-call cost low.

Large hull and flight-deck surfaces use small, deterministic canvas paint maps generated at runtime. Their low-contrast plate joins, salt streaks and non-slip deck variation are authored approximations to the visible surface character; they do not reproduce or redistribute any reference photograph. Those surfaces retain UVs during static batching. Steel fittings use different roughness and grey values, while landing paint remains crisp and readable.

Persistence has a central full-width forward bridge, closed aft hangar shutter, recessed side boat bays with stowed craft and davit framing, flanking exhausts, mast/radar shapes, forward gun, and a 70 m aft flight deck with hollow landing circles, tracks and 209 stern marking. The bridge and hangar have modest rake and inset rooflines instead of sheer box faces, with a full-height forward pedestal supporting the bridge wings. The outer boat recesses use recessed inboard back panels, so they no longer hide the stowed boats behind a solid dark box. Kunisaki has the long, narrower flat deck and starboard mid-forward island, tiered bridge with continuous dark glazing, mast, funnel, crane, two elevator outlines, side ramps and aft landing guides. The former filled white landing discs were removed.

## Deliberate limits

The ship group stays at the mission marker, with stern +35 m for Persistence and +40 m for Kunisaki and bow in -Z. Kunisaki's two aft deck guides are centred at local Z -12 m and +20 m. The JGSDF aircraft now starts and recovers at the +20 m guide; the mission ship marker remains at Z 0 for the map and route layout. Contact and guidance use the marked landing point. The visual deck is y=-2.55, meeting the aircraft tyres at approximately y=-2.52 when the simulation places its origin at y=0; the existing sea is y=-9. This preserves the fuselage/deck clearance correction.

Major measured length and beam are preserved; vertical fitting dimensions, detailed station shapes and small features are photo-estimated. Both aft operating areas retain an unobstructed rotor envelope around their landing points. Kunisaki's deck guide placement and the abbreviated stern `03` are approximations to the inspected small reference photographs, not surveyed paint plans. Radar faces, boat fittings, safety nets and small vents are simplified for mobile rendering. Ramp gates and lifts are closed static representations. Hull seams and weathering are procedural visual cues, not surveyed plate patterns. Internals, rigging and changing operational equipment are not reconstructed.

Validation for the latest ship material and geometry pass: TypeScript and Vite production build pass. Integrated browser appearance and collision behavior are checked with the complete scene separately.

## Side-profile correction pass

The 9 October 2026 portrait comparison re-opened and visually inspected the official `main_4003.jpg`, page 3 of the Kunisaki pamphlet, and James M. Gose's original Persistence photograph above. The actual starting-page renders were compared with these images. The largest errors were structural rather than surface detail: vertical stems, a floating Persistence bridge, solid boxes hiding its boats, short outboard funnels/davit frames, overly long Kunisaki bridge glazing, and mast supports that did not meet the deckhouse.

The revised hull has a retreating underwater stem; Persistence gains a rising forecastle, while Kunisaki has a low forward mooring deck. Persistence now has a continuous forward bridge support, taller open side bays and davits, tapered outboard exhaust stacks, a separate forward radar tower, and a tapered main mast on a connected pedestal. Its gun has an elevated barrel above the forecastle. Kunisaki has a compact forward bridge with glazing aligned to its walls, a lower aft deckhouse, an explicitly supported mast, and the forward CIWS on its lower pedestal. Both have restrained roof rails, clearly fitted painted pennants, and much quieter hull seams/weathering. Static geometry remains merged by material.

These corrections preserve the measured overall length/beam, stern offsets, landing-deck height and unobstructed aft landing areas. The required gameplay sea/deck separation fixes aft freeboard at 6.45 m; it is not a measured reconstruction of either ship's loaded waterline. Forecastle sheer, bridge dimensions and fittings are still photo-estimates, and the broadside portrait cannot prove internal or hidden-side detail. The close-to-broadside render particularly foreshortens athwartship radar yards. No claim of exact 2026 equipment fit is made from the 2007 Persistence photo.

The starting-page portraits now use a low, long-lens broadside camera, a visible sea horizon and updated lighting. They still render the actual gameplay models, with their true relative aircraft/ship scale. Pennant canvases match their physical aspect ratios to avoid stretched digits.

Collision envelopes follow the revised bridge tiers, outboard boat bays, funnels and taller masts. Persistence's raised forecastle samples tyre/body contact against its sloped surface; the aft landing zones retain their existing heights. Regression checks cover the taller mast, forecastle clearance and flight above Kunisaki's lower aft island without an invisible tall wall.

Verification: `npm test` passes all 51 tests, including all twelve complete mission paths. The corrected ships compile with `npm run build` (TypeScript and Vite); both revised starting-page portraits were visually inspected.
