# Operation Crimson Eagle

A single-player Chinook firefighting game prototype with two authored campaign options: a fictional Singapore relief scenario and a reconstruction of Japan’s documented September 2026 deployment to Indonesia. The Japan operation is real; individual missions and their routes are game reconstructions. See [Research notes and sources](docs/research-notes.md) for the evidence boundary, model assumptions and asset credits.

## Run locally

```sh
npm install
npm run dev
```

Vite prints the local URL. The project also defines `npm run test` for Vitest and `npm run build` for TypeScript checking plus a production build. After building, run `npm run preview` to serve that build locally. These commands describe the package scripts; see [Verification](docs/verification.md) for the results actually recorded for this checkout.

## Controls

The keyboard input currently wired in `src/main.ts` is:

| Key | Action |
| --- | --- |
| W / S | Climb / descend |
| A / D | Yaw left / right |
| Arrow keys | Cyclic left/right and forward/back |
| Space | Release water when near the fire |
| E | Nearby context action: attach, fetch water, release, or unrig |
| F | Face the current objective (turn only) |
| R | Set the return route |
| M | Open or close the tactical map |
| Escape | Pause or resume |

The flight screen implements two pointer-controlled thumb sticks: the left commands yaw and climb/descent, and the right commands cyclic. On-screen buttons handle nearby mission actions, facing the objective, setting the return route, map and pause. Sticks use pointer capture and release their command on pointer-up, cancellation or lost capture. Keyboard and touch controls are implemented in source; physical-phone behavior is not claimed unless a device run is recorded in [Verification](docs/verification.md).

Tap **Face objective** to turn toward the next waypoint; it does not fly the route. Attach, fetch and release controls appear only close to their relevant zones, and tapping one can make a short alignment correction inside that zone. **Set return** changes the route without flying it; Japan's recovery stops at the shore handling pad before the final ship leg. Generated rotor, wind and water audio starts after a play/resume gesture, and the text cues remain usable while muted.

The flight telemetry shows where the bucket is: on deck, at Japan's shore rigging pad, or its distance below and offset from the aircraft while slung. The tactical map marks the shore or slung bucket with a diamond.

## Scenario and simulation notes

Mission coordinates use a compressed local gameplay layout measured in metres. They are not latitude/longitude, surveyed map geometry or real flight distances. Singapore’s Danau Sembuluh reference identifies the setting only; game fires, refill permissions and routes are fictional. Japan’s documented deployment provides the historical setting, while the playable fire locations, refill lake, weather, ship stations and detailed sortie sequences are reconstructed. The Japanese CH-47JA is a representative game preset, not a claim about the deployed aircraft’s exact configuration.

Each authored mission currently has a five-minute target duration. Compact local routes are a deliberate short-session gameplay scale, not a representation of actual mission transit time.

The flight and fuel model is for gameplay. It assumes a 5,000-litre water load at 1 kg per litre and starts each campaign profile with 3,100 kg of fuel. These values, handling, burn rates and return estimates are not operational performance data or flight-planning guidance. More detail and source links are in [Research notes and sources](docs/research-notes.md).

The Chinook is lost on unsafe contact with terrain, trees, water, ships or modeled structures. The aircraft stops above the rendered ground at impact; controlled landings remain possible on the marked ship deck and Japanese shore pad.

The aircraft, ships, bucket, landscape, settlement and fire scene are project-authored Three.js procedural geometry. The refined Chinook, ships and lowland scenery are documented in [aircraft geometry references](docs/aircraft-geometry-references.md), [ship geometry references](docs/ship-geometry-references.md) and [map geometry references](docs/map-geometry-references.md). The static app icon is original project-authored SVG. No third-party model, map tile, photograph, imported texture or audio asset is listed in the current source tree. Scenario provenance is also tracked in [src/content/provenance.ts](src/content/provenance.ts); linked reference sources retain their own terms and are not bundled assets.

Current implementation status and remaining validation are tracked in [docs/status.md](docs/status.md).
