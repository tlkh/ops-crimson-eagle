# Real-gameplay trailer capture

This development-only entrypoint renders the shipping Three.js scene from successful, fixed-step simulated sorties. It does not load through the main application or enter the production Vite bundle. The pilot is adapted from the test-only integration driver; its only inputs are flight commands. It never assigns positions, water amounts, fire heat, or outcomes.

## Updated storyboard — 12 October 2026

Implemented in `capture.ts` for the 12 October 2026 trailer set. The edit is 45 seconds at 30 fps, with landscape and portrait compositions rendered from the current local gameplay source and assets.

| Time | Picture and action | Overlay copy |
| --- | --- | --- |
| 00:00–00:08 | Open on the Chinook lowering its bucket into the lake, then cut to the water release and visible fire suppression. Keep the bucket and falling water unobstructed. | **Do your part to protect Singapore from the haze** |
| 00:08–00:12 | Dawn split-screen: show the Singaporean and Japanese Chinooks flying away from their respective ships in two distinct clips. Singapore: RSAF CH-47F / RSS Persistence. Japan: JGSDF CH-47 / JS Kunisaki. | **Play as Singaporean or Japanese crews forward deployed to fight the peat fires**. Smaller panel labels identify each crew and ship. |
| 00:12–00:16 | Dusk split-screen: cut to two distinct clips of the Chinooks fighting peat fires. Use SG-04 and JP-04, whose authored sorties begin at dusk. | Continue the shared split-screen message and crew labels. |
| 00:16–00:23 | Singapore highlight: show the Chinook lifting vertically from the LST with its attached bucket. Start with the bucket on deck, show the sling becoming taut and bucket clearing the deck, then continue the climb. Use a three-quarter side view that keeps the helicopter, full sling, bucket and deck visible. | Eyebrow: **Campaign 01 / Seruyan Regency, Central Kalimantan**. Title: **RSAF Deployment**. Supporting line: **Fictional campaign**. |
| 00:23–00:35 | Japan highlight: flight toward the airbase (00:23–00:27), bucket rigging on the ground (00:27–00:31), then vertical lift-off with the attached bucket (00:31–00:35). Show the rigging action at normal speed; if needed, cut forward between distinct stages rather than accelerating it. | Eyebrow: **Campaign 02 / Ketapang Regency, West Kalimantan**. Title: **JSDF Deployment**. Supporting line: **Reconstructed from an actual mission**. |
| 00:35–00:45 | Closing montage: distinct daylight flight (00:35–00:38), dusk firefighting (00:38–00:41), and night flight/return (00:41–00:45). Use SG-04's second drop for the closing dusk shot so it does not repeat the first SG-04 drop shown in the split-screen. End on a clean, readable aircraft silhouette with room for the call to action. | **Play now at tlkh.github.io/ops-crimson-eagle** + **Do your part to protect Singapore from the haze**. Keep both lines legible through the montage and hold them before the final fade. |

### Layout and editorial rules

- Landscape showcase: Singapore on the left, Japan on the right. Portrait showcase: Singapore above, Japan below, with the shared campaign message centered in the band between panels. Use independently framed cameras for each panel, keeping rotor tips and ship context visible; avoid cropping a finished landscape shot into a portrait panel.
- Keep overlays mainly in the upper or lower thirds so they remain readable alongside the gameplay. Reserve the portrait split's center band for the shared campaign message and keep panel labels inside their own panels. Wrap the longer copy and location eyebrows deliberately for portrait; never truncate place names or cover the aircraft/bucket action.
- Keep every source window unique, including footage in split-screen panels and dissolve tails. The showcase departures and campaign-specific bucket departures must use separate events or non-overlapping source windows with visibly different compositions.
- Keep the closing shots visibly different in action, lighting and camera angle. The SG-04 split-screen first drop and the closing second drop must use different non-overlapping source windows and camera compositions.
- Japan's reconstruction line describes authored gameplay inspired by a real deployment, not historical footage or a verified flight-by-flight record. Retain the representative aircraft preset note in supporting credits.
- Campaign eyebrows use **Campaign 01** for Singapore and **Campaign 02** for Japan.
- The split-screen compositor keeps separate scene views and packet replay histories for the two campaigns. Source-window checks cover both panels. Camera cuts are primed before encoding so new textures can load; preview checks sample the beginning, middle and end of every shot.

## Reproduce

Requires Node 22.12+, Chrome, FFmpeg/ffprobe, and a locally available `playwright` package. If needed, install the capture dependency without changing the project manifest/lockfile:

```sh
npm install --no-save --package-lock=false playwright
npm run dev -- --host 127.0.0.1 --port 5173
```

With Vite running, use another terminal:

```sh
TRAILER_OUTPUT_DIR=output/trailers/2026-10-12 node scripts/trailer/render.mjs --preview
TRAILER_OUTPUT_DIR=output/trailers/2026-10-12 node scripts/trailer/render.mjs
TRAILER_OUTPUT_DIR=output/trailers/2026-10-12 node scripts/trailer/mix.mjs
```

`TRAILER_OUTPUT_DIR` selects the output folder; its default is `output/trailers`. `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` can select an existing installation. `--landscape` and `--portrait` limit capture to one format. Chrome runs in an isolated headless profile. The capture URL includes the configured `/ops-crimson-eagle/` base. Set `TRAILER_URL` if Vite uses another port.

## Edit and capture

- `pilot.ts`: records selected sorties at 30 fps, stepping the actual simulation twice per frame, and rejects unsuccessful sorties. Builds the real world before flying so scenery colliders are registered. Yaw commands turn toward the current destination. After rigging, the capture-only pilot climbs vertically until the bucket clears its supporting surface before departing horizontally.
- `packetReplay.ts`: preserves live water-packet identities across archived frame clones without mutating the recordings. The bucket renderer uses identity to distinguish falling packets from real impacts; raw snapshot clones otherwise cause false splash rings every frame. Replay resets at cuts/seeks and warms up two seconds of visual history before capture.
- `capture.ts`: event-based 45-second shot list using SG-01, JP-01, JP-02, SG-04, JP-04, and JP-05 recordings. The dawn departure pair uses SG-01/JP-01; the distinct dusk firefighting pair uses SG-04/JP-04. The approved storyboard above also includes full-frame deck/airbase operations and daylight/dusk/night action. Split panels are side by side in landscape and stacked in portrait, with independent camera aspect ratios; portrait places the shared message in the band between panels. Each shot includes up to two seconds of continuous preroll. Rendering and water reflection throttling follow the external capture clock. The edit rejects overlapping source windows across all full-frame and split-screen clips.
- `audio.ts`: offline rendering of the game's procedural rotor/wind/water synthesis and selected existing radio recordings, gated by the real mission radio director. Noise is seeded, cues are not queued past their event, and output is 48 kHz stereo WAV. This capture-only graph mirrors `src/audio.ts`; keep it aligned if game sound design changes.
- `render.mjs`: browser frame capture and streaming FFmpeg encoding. Videos, three preview frames per shot, edit metadata, WAV, and posters go to the selected output folder. Browser errors stop capture.
- `mix.mjs`: adds bundled CC0 music with fades, radio-driven ducking, and loudness normalization; muxes H.264/AAC MP4s and verifies dimensions, frame rate, codecs, and duration with ffprobe.

The renderer's optional `externalClock` and `pixelRatio` settings, `renderFrame(deltaSeconds, cameraPose?)`, and canvas getter are also usable by future capture tools. Normal callers retain automatic RAF rendering and the existing chase camera.

Inactive water surfaces discard their cached reflection and use the sky fallback. This prevents a lake reflection captured from the pickup camera from remaining projected onto the lake after a cut to the fire camera.

## Deliverables and evidence

Finals are `ops-crimson-eagle-16x9.mp4` (1920×1080) and `ops-crimson-eagle-9x16.mp4` (1080×1920), both 45 seconds at 30 fps, in `output/trailers/2026-10-12`. Matching poster PNGs, edit metadata, and ffprobe reports are saved beside them. Source animation remains at normal simulation speed inside each shot; the edit skips travel between shots.

RSAF footage is a fictional scenario. JSDF campaign footage is authored gameplay inspired by a real deployment, not a historical flight record. All footage is rendered directly from the current game renderer and simulation, including the updated aircraft/ship materials, terrain and water atlases, fire and smoke, environment lighting, and procedural burn history. The packed terrain atlas and authored fallback live at `public/graphics/terrain-atlas.ktx2` and `.png`. No generated video, stock footage, or photographs are used. Camera and title treatment are editorial additions.

Music: **Urgent**, SRG774, CC0, bundled as `public/music/sg-02.mp3`; see `docs/music-credits.json`. Source: https://opengameart.org/content/dark-sci-fi-audio-pack . The trailer trims, fades, ducks, and normalizes this track. Radio recordings and procedural audio come from the project. Typeface: bundled Rajdhani, SIL Open Font License (`public/fonts/OFL.txt`).
