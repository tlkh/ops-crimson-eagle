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

Touch controls provide two joysticks: collective/yaw on the left and cyclic movement on the right, plus on-screen action buttons.

## Run locally

Use Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the printed local URL at `/ops-crimson-eagle/`. Run `npm test` for simulation and content checks, or `npm run build` followed by `npm run preview` for a production preview.

Built with TypeScript, Three.js, and Vite. Aircraft, ships, and scenery use procedural 3D assets; [campaign artwork](docs/campaign-artwork.json) uses generated satellite-inspired illustrations with recorded reference sources. See [AGENTS.md](AGENTS.md) for architecture, development conventions, and verification guidance.
