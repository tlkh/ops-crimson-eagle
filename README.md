# Ops Crimson Eagle

A browser-based, single-player Chinook firefighting game. Fly from a landing ship, attach a firefighting bucket, collect water, suppress fires, and bring the crew home. Twelve missions across two campaigns are designed for roughly five minutes each.

## Campaigns

- **RSAF Deployment — Seruyan, October 2026.** A fictional campaign in which hazardous haze affecting Singapore prompts the SAF to deploy RSS Persistence and an RSAF Chinook crew to support firefighting in Central Kalimantan.
- **JSDF Deployment — Ketapang, September 2026.** Based on Japan’s real deployment to Indonesia, with reconstructed missions featuring a JGSDF Chinook and JS Kunisaki.

Compact maps and flight, fuel, and load handling are tuned for play. Mission routes and fire locations are authored game scenarios; [research notes](docs/research-notes.md) explain their sources and assumptions.

## Playing

Follow the objective cues, manage the swinging bucket and water load, and watch your fuel. Nearby action buttons handle attaching, filling, releasing water, and detaching. Unsafe collisions end the mission. Progress and checkpoints are saved in your browser.

| Keyboard | Action |
| --- | --- |
| W / S | Climb / descend |
| A / D | Turn left / right |
| Arrow keys | Move sideways / forward / backward |
| E | Nearby objective action |
| Space | Release water near the fire |
| F | Face the objective — turn only |
| R | Set the return route |
| M / Escape | Map / pause |

Touch controls provide two joysticks: collective/yaw on the left and cyclic movement on the right, plus on-screen action buttons. The flight HUD gives a clear observation step after the last water drop; once crews secure the fire, it advances to recovery.

Singapore ship recovery requires carrying the bucket over the flight deck before descending vertically onto the marked spot. The ship menu preview shows a top-down view of the mission map and its labeled locations. Each sortie moves through its assigned time of day, with matching sky, sunlight, night lighting, and subtle proximity effects.

The menu and each mission have their own background track. Music starts after your first interaction, rises gently during a fire attack, and recedes on the return. You can turn it off from the menu or during a sortie. [Music credits and source links](docs/music-credits.json) list all 13 selections.

Radio calls begin with “SINGA TWO ONE” or “JAPAN THREE ONE” and give spoken objective, water, fuel, and recovery cues. Calls follow the same fire observation and bucket-safe ship recovery rules as the HUD. Radio has its own on/off control during a sortie and in the pause menu. The [voice cue manifest](docs/voice-cues.json) records every line and its generation source.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL at `/ops-crimson-eagle/`. Run `npm test` for simulation and content checks, or `npm run build` followed by `npm run preview` for a production preview.

Built with TypeScript, Three.js, and Vite. Aircraft, ships, and scenery use procedural 3D assets; [campaign artwork](docs/campaign-artwork.json) uses generated satellite-inspired illustrations with recorded reference sources. See [AGENTS.md](AGENTS.md) for architecture, development conventions, and verification guidance.
