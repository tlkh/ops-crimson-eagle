# Real-gameplay trailer capture

This development-only entrypoint renders the shipping Three.js scene from successful, fixed-step simulated sorties. It does not load through the main application or enter the production Vite bundle. The pilot is adapted from the test-only integration driver; its only inputs are flight commands. It never assigns positions, water amounts, fire heat, or outcomes.

## Reproduce

Requires Node 22.12+, Chrome, FFmpeg/ffprobe, and a locally available `playwright` package. If needed, install the capture dependency without changing the project manifest/lockfile:

```sh
npm install --no-save --package-lock=false playwright
npm run dev -- --host 127.0.0.1 --port 5173
```

With Vite running, use another terminal:

```sh
node scripts/trailer/render.mjs --preview
node scripts/trailer/render.mjs
node scripts/trailer/mix.mjs
```

`PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs` can select an existing installation. `--landscape` and `--portrait` limit capture to one format. Chrome runs in an isolated headless profile. The capture URL includes the configured `/ops-crimson-eagle/` base. Set `TRAILER_URL` if Vite uses another port.

## Edit and capture

- `pilot.ts`: records SG-01 and JP-02 at 30 fps, stepping the actual simulation twice per frame, and rejects unsuccessful sorties. Builds the real world before flying so scenery colliders are registered. Yaw commands turn toward the current destination.
- `capture.ts`: event-based shot list, independent landscape/portrait camera framing, typography, two eight-frame campaign dissolves, and opening/closing fades. Each shot includes up to two seconds of continuous preroll. Rendering uses an external clock; the page's performance clock also advances per rendered frame for water reflection throttling. Capture does not depend on real-time browser frame rate.
- `audio.ts`: offline rendering of the game's procedural rotor/wind/water synthesis and selected existing radio recordings, gated by the real mission radio director. Noise is seeded, cues are not queued past their event, and output is 48 kHz stereo WAV. This capture-only graph mirrors `src/audio.ts`; keep it aligned if game sound design changes.
- `render.mjs`: browser frame capture and streaming FFmpeg encoding. Files and evidence go to ignored `output/trailers/`.
- `mix.mjs`: adds bundled CC0 music with fades, radio-driven ducking, and loudness normalization; muxes H.264/AAC MP4s and verifies dimensions, frame rate, codecs, and duration with ffprobe.

The renderer's optional `externalClock` and `pixelRatio` settings, `renderFrame(deltaSeconds, cameraPose?)`, and canvas getter are also usable by future capture tools. Normal callers retain automatic RAF rendering and the existing chase camera.

## Deliverables and evidence

Finals are `ops-crimson-eagle-16x9.mp4` (1920×1080) and `ops-crimson-eagle-9x16.mp4` (1080×1920), both 45 seconds at 30 fps. Matching poster PNGs, edit metadata, and ffprobe reports are saved beside them. Source animation remains at normal simulation speed inside each shot; the edit skips travel between shots.

RSAF footage is a fictional scenario. JSDF campaign footage is authored gameplay inspired by a real deployment, not a historical flight record. All footage is rendered directly from the current game renderer and simulation, including the updated aircraft/ship materials, terrain and water atlases, fire and smoke, environment lighting, and procedural burn history. The packed terrain atlas and authored fallback live at `public/graphics/terrain-atlas.ktx2` and `.png`. No generated video, stock footage, or photographs are used. Camera and title treatment are editorial additions.

Music: **Urgent**, SRG774, CC0, bundled as `public/music/sg-02.mp3`; see `docs/music-credits.json`. Source: https://opengameart.org/content/dark-sci-fi-audio-pack . The trailer trims, fades, ducks, and normalizes this track. Radio recordings and procedural audio come from the project. Typeface: bundled Rajdhani, SIL Open Font License (`public/fonts/OFL.txt`).
