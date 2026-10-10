# Campaign and briefing menus — 10 October 2026

Implemented the approved grey / dark green / gold direction in a menu-only controller and stylesheet. Desktop presents mission list, gameplay schematic, and briefing; phones open a separate briefing after mission selection. The flight HUD remains unchanged.

- `src/ui/menu.ts`: campaign navigation, briefing selection, focus/scroll restoration, cached gameplay fleet portraits, music controls, guarded asynchronous launch and retry feedback.
- `src/ui/menu.css`: responsive layouts, restrained motion, reduced-motion handling, safe-area padding, bundled Rajdhani headings.
- `src/ui/menuState.ts`: existing mission unlock rules, robust progress parsing, initial selection and launch guard.
- `src/ui/briefingMap.ts`: bounded, cached terrain samples with uniform projection of authored mission coordinates; Japanese routes include shore handling. This is explicitly a gameplay schematic, not surveyed geography.
- Bundled font license: `public/fonts/OFL.txt`. Browser/installed-app theme colours now match the grey menu. Service-worker cache version is v8 and includes fonts; existing music range handling is retained.

## Verification

- `npm test`: 69 tests passed, including 11 new map/state tests.
- `npm run build`: passed; existing large JavaScript chunk warning remains.
- `git diff --check`: passed.
- Real Chromium screenshots reviewed at 1440×900 and 390×844, stored locally under `output/playwright/implemented-*.png`.
- Mission list checked without horizontal overflow at 320, 375, 390, 414, 768, 1024 and 1440 pixels. Landscape briefing checked at 844×390.
- Both campaign flows launched their training sortie. Keyboard selection and return-to-list focus checked; five locked missions remain disabled in fresh progress. Pause checked after launch.
- Physical iPhone/iPad, installed web-app mode, production service-worker refresh, and deployment are not verified by these browser checks.

The generated mobile flight concept is not part of this implementation.

## Gameplay terrain preview follow-up

The normal briefing preview now uses `src/render/briefingTerrain.ts` to capture the actual gameplay world from a top-down orthographic camera. The 960×1200 daylight image includes the terrain, vegetation, coast, buildings, ship and fire. SVG route markers, location labels and leaders share the exact camera projection. The sampled schematic remains only while loading or when rendering is unavailable.

Captures use a cloned mission identity to isolate preview collision caches. The temporary renderer skips cloud layers and reflection passes, disposes its GPU resources, and caches at most 12 images. The menu retains its existing grey, dark-green and gold styling. Phone maps use the same projection without cropping their labels.

Final follow-up verification: 104 tests passed, production build passed with the existing bundle-size advisory, and whitespace checks passed. Real Chromium captures cover desktop and phone previews for the campaign flow; widths 320, 375, 414 and 768 had no horizontal overflow. The detector reported only the existing hidden fleet-image loading state and approved selected-row accent. Screenshots are in `output/playwright/refined-map-*.png`. Service-worker cache version is now v11. Physical devices and deployment remain unverified.
