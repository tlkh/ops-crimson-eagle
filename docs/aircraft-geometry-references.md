# Chinook exterior geometry reference notes

Updated 9 October 2026. The procedural exterior in `src/render/aircraft.ts` represents the RSAF CH-47F and the JGSDF CH-47JA. It is a game-resolution reconstruction from published dimensions and photographs, not a manufacturer CAD model or a specific registered airframe.

## Sources inspected

- [Boeing H-47 Chinook](https://www.boeing.com/defense/military-rotorcraft/h-47-chinook): overall dimensions; 18.3 m rotor diameter, roughly 15.6 m fuselage, 30.1 m rotor-operating length, 5.7 m height. The current page describes Block II, so only family-level exterior dimensions were used, not a claim that these game aircraft are Block II.
- [Kawasaki CH-47J/JA](https://www.khi.co.jp/mobility/aero/helicopters/ch_47j.html): manufacturer describes the enlarged JA fuel tanks and gives 30.2 m operating length, 18.3 m width and 5.7 m height. Its [JGSDF photograph](https://www.khi.co.jp/mobility/aero/helicopters/img/ch_47j_im03.jpg) was downloaded for direct visual inspection, not shipped as a game asset. It establishes the nose radome, flat cockpit glazing, tall aft pylon, engine location, fuel tanks, circular windows and green/brown camouflage.
- [Singapore MINDEF, full operational capability announcement](https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_nr/): confirms RSAF CH-47F and supplies operational photographs. The image CDN did not yield usable photos in this environment.
- [PIONEER / Singapore MINDEF, RSAF capability article](https://defencepioneer.sg/pioneer-articles/rsaf-to-continue-to-invest-in-capabilities---tech--chief-of-air-force): its [large operational photograph](https://defencepioneer.sg/images/mindefpioneerlibraries/default-source/articles/people/2022/14-feb-%283%29-2022/14feb22_news3_photo4.jpg?sfvrsn=76464a62_2) was inspected directly. The side view shows enlarged tanks on the RSAF F, circular cabin windows, forward twin wheels, aft single wheels, nose radar, chin sensor, engine intakes facing forward at the aft pylon and rear-facing metal exhausts.

## Corrections made

- Replaced the long ellipsoid with a rounded, nearly constant cargo-cabin section, sloping chin and upswept rear closure.
- Shortened the fuselage and separated the tandem mast centres by 11.85 m; the 18.29 m rotor discs produce the documented approximately 30.14 m operating envelope. Both rotors have three blades and counterrotate.
- Added the low forward and distinctly taller aft transmission pylons, plus the longitudinal driveshaft fairing.
- Moved both engines from the cabin roof to the sides of the aft pylon; added forward intakes and rear exhausts.
- Replaced rectangular cabin windows with circular portholes. Used flat, separately framed windscreen, pilot-side and lower nose panes.
- Rebuilt the fuel tanks as rounded, tapered sponsons. Both export variants have enlarged tanks, matching the inspected photographs. Their approximate 4.8 m width should not be confused with Boeing's baseline 3.8 m fuselage-width figure.
- Corrected the undercarriage to four legs with twin forward wheels and single aft wheels; added the cargo hook and a closed cargo ramp that tapers upward and inward toward the tail.
- Used olive RSAF paint and a broad disruptive green/brown JGSDF pattern with red/white roundels. Omitted invented registration numbers, squadron insignia and bright rescue-orange stripes. Exact camouflage boundaries and small markings are interpretive.
- Merged stationary geometry by material to keep rendering cost suitable for a mobile browser. The animated rotor/disc API is unchanged.
- Capped the loft ends, especially the rear transmission pylon, after a rear-view browser screenshot exposed a see-through opening. The aft closure now reads as solid behind the rotor mast.

## Accuracy limits

Only overall published dimensions are dimensionally constrained. Cross sections, local panel positions, pylon widths and equipment sizes are photograph-based estimates. The cargo ramp is a fixed closed exterior; no interior or articulated loading system is modelled. No rotor articulation, rivet-level detailing or exact aircraft-specific equipment fit is claimed. Rotor blur is a rendering effect, not an aerodynamic model. Official source photographs are references only and are not redistributed in the shipped game.

## Rear-view and livery refinement, 9 October 2026

A further pass directly inspected the large PIONEER RSAF photograph linked above and Kawasaki's JGSDF photograph. The [MINDEF CH-47F fact sheet](https://www.mindef.gov.sg/news-and-events/latest-releases/11apr24_fs/) independently confirms the 30.14 m operating length, 18.29 m rotor diameter and 5.68 m height. Its migrated image endpoint was unavailable, so the PIONEER photograph was the Singapore visual reference. A DVIDS JGSDF deck-landing reference was located but could not be opened, and is not counted as inspected visual evidence.

Changes concentrate on the normal rear chase-camera view:

- The aft pylon now has a wider, less pinched rear face, a fully closed cap, restrained access-cover/grille detail and a continuous painted surface. End-cap normals are separated from the side shell.
- The rear cargo closure uses painted, capped surfaces and a narrow seam rather than a contrasting tan slab or visible hole. The lower fuselage rises and narrows into the closed ramp.
- Rear exhausts have open-ended metal sleeves, rolled rims, sleeve bands and recessed dark faces. Their sleeves no longer end in solid bright circular caps. Small aft protection housings are included on the RSAF variant, informed by the operational photo.
- Wheel locations and tyre contact height remain unchanged at approximately -2.52 m, preserving the ship-deck clearance correction.

Two separate authored texture/material sets are generated when each campaign's aircraft is created:

1. **RSAF CH-47F:** muted olive-grey paint, subtle panel joints/fasteners, low-contrast paint variation and a roughness map; low-visibility English service lettering on the long-range tanks.
2. **JGSDF CH-47JA:** tan-dominant paint with broad sage-green and near-black-green disruptive fields, matching the relative colour balance and large patch scale in the supplied side, overhead and aft-quarter references; the same restrained surface treatment and roughness map; white-edged red national discs and Japanese service lettering. The broad, irregular camouflage fields replace the previous sinusoidal vertex-colour stripes.

Each set uses one 1024-square colour atlas and one 128-square roughness atlas. Geometry supplies explicit UVs, including closed end faces, and material batching preserves those UVs. Markings remain separately mapped meshes. The atlases are authored shapes and paint detail; no official photograph is embedded or redistributed. No aircraft serial, unit marking or exact lion insignia is fabricated. The viewed aircraft photos show side/oblique views, so rear panel dimensions, small latch locations and exact camouflage boundaries remain representative interpretations, not a measured rear orthographic reconstruction. Normal camera-view visual QA is performed separately by the integrating agent. The TypeScript/Vite production build passes after this pass.

The subsequent user-provided photographs showed the first JGSDF atlas was too green and its pattern too fine. The fuselage atlas uses a tan base and fewer larger organic green fields, with sparse near-black-green accents along tan/green boundaries. Edge wrapping keeps the side camouflage continuous. The later user request makes the tapered aft fuselage, closed rear cap and aft pylon solid green, without a tan rear patch. JGSDF non-skinned trim remains green. The supplied photographs were used only as visual references, not copied into game assets.

## Final focused rear-reference pass

The additional user-supplied rear photograph informed the tall aft pylon and the recessed exhaust nozzles with cross braces. The later side-profile drawing and the user's explicit direction establish the game configuration: **closed ramp and tapered tail**. The fuselage narrows from 1.42 m to 0.70 m half-width and its lower line rises from about -1.3 m to -0.31 m near the rear cap; the aft pylon's rear roof slopes down to meet it. The end cap is solid, so terrain cannot show through. The tapered loft itself forms the closure; offset ramp panels and loose edge pieces were removed after a side-view inspection. Following the latest rear-view feedback, the aft pylon and tapered rear closure use a solid green material; the S-shaped tan/dark motif and subsequent tan patch are gone. Exhaust mouths have small cross braces and recessed centres. Landing gear has visible upper fairings, load struts and diagonal braces joining each axle to the body. Tyre contact height remains -2.52 m, so the ship deck clearance is unchanged. These are still game-resolution photo estimates, not measured rear orthographic data.

At flight RPM, fast-flight rendering uses translucent swept rotor discs without distinct blade meshes; the physical blades remain visible during slow deck rotation. A later close-up revealed that the four thin rods apparently protruding through the JGSDF roof were actually the separate bucket's support straps. The bucket had been labelled as staged ashore but positioned at the helicopter while unattached. Its initial and ongoing simulation position now stays at the shore handling site; rendering also derives that position from the shore marker so older saved sorties do not show the rods.

The rotor blur now uses a feathered radial transparency texture with short curved sweep marks. Its stronger flight opacity makes both discs legible against sea and deck from the chase camera without restoring the high-speed blade meshes. Slow deck rotation keeps the distinct blades visible over a lighter disc.

## Roof and landing-gear cleanup

The two freestanding 0.48 m centreline roof rods and a round roof lump were removed from both game variants. They were unsupported details that looked like oversized aerials from the chase view. The low synchronising-driveshaft fairing remains. Four spherical gear-leg joints were replaced with compact under-fuselage mounts, slimmer oleo struts, diagonal braces and small hub forks. The model now has one wheel at each of its four landing legs, matching Boeing's description of [CH-47F four-wheel landings](https://www.boeing.com/features/2026/04/ch-47f-chinook-completes-first-supervised-autonomy-landing); wheel bottoms remain at -2.52 m to retain ship-deck alignment. The shapes were checked in temporary rear, side and overhead views against the published [Kawasaki CH-47J/JA imagery](https://www.khi.co.jp/mobility/aero/helicopters/ch_47j.html) and earlier user-supplied photographs. Strut dimensions and equipment fit are still game-resolution approximations.
