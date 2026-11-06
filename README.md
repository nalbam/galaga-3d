# Neon Swarm // Galaga 3D

A polished, static Three.js arcade shooter inspired by classic space-invader formations. The game runs directly from the `docs/` folder: there is no build step, framework, package manager, backend, or bundler.

## Run locally

Because browsers restrict ES-module imports from `file://`, serve the repository with any simple static server, then open the printed URL:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/docs/>. The only runtime dependency is Three.js loaded from the jsDelivr CDN.

## Controls

- Move: `ArrowLeft` / `ArrowRight` or `A` / `D`
- Fire: `Space`
- Mouse: move the pointer to steer the ship along the X axis (mapped to the combat plane through the camera); hold the left button to fire at the normal `.22 s` interval. Clicks on menu, sound, and touch buttons do not move or fire.
- Pause/resume: `P` or `Escape`
- Touch devices: use the on-screen left, fire, and right buttons
- `SOUND ON/OFF` toggles Web Audio sound effects

## Features

- Responsive WebGL canvas with retro neon HUD, scanlines, grid, and procedural geometry
- Formation waves with basic, elite, and boss enemies; lateral movement and dive attacks
- Player and enemy projectiles, collision detection, lives, stages, stage transitions, and explosions
- Elite swarms every third stage, including a higher-health boss enemy
- Score and high score persisted in `localStorage`
- Start, pause, game-over, new-record, mute, keyboard, mouse, touch, resize, and visibility handling
- No external art or audio assets: particles, ships, enemies, stars, and Web Audio effects are generated in JavaScript

## GitHub Pages deployment

1. Push this repository to GitHub using the repository's normal reviewed Git workflow.
2. Open the repository on GitHub and choose **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and the `/docs` folder, then click **Save**.
5. Wait for the Pages deployment action to finish. GitHub will display the published URL; open it over HTTPS so WebGL, modules, storage, and Web Audio work correctly.

The deployable files are `docs/index.html`, `docs/style.css`, `docs/game.js`, and `docs/combat.mjs`. The HTML and JavaScript use relative imports, so the `/docs` Pages source works without rewriting or a build command.

## Regression checks

With a current Node.js version, run:

```bash
node --check docs/game.js
node --check docs/combat.mjs
node --test tests/combat.test.mjs
git diff --check
```

Combat uses a shared XY plane: player shots travel upward, enemy shots travel downward, and diving enemies return to their original moving formation slot. Stage difficulty (dive chance, fire interval, shot speed, concurrent dives and shots, rows, elites, boss health) comes from the pure `difficultyForStage(stage)` in `docs/combat.mjs`; values saturate at fixed caps. Explosion particles move by elapsed time, not by frame count: each update decays velocity by `.94^(60*dt)` and moves the particle by the matching 60 Hz geometric sum. At 60 Hz this is the original look (move by `velocity/60`, then multiply by `.94`), and the same explosion spreads equally at 30 Hz or 144 Hz. Tests cover the combat helpers, the difficulty curve (monotonic, capped, small per-stage steps) and the actual game loop with rendering/DOM substitutes. The particle tests run one seeded explosion through the real `update(dt)` at 30, 60 and 144 Hz for 1 s and compare every particle's position and velocity with each other and with the original 60 Hz move-then-decay loop (lifetimes are stretched in the test only for that comparison). A separate test checks the real spawn lifetime, life countdown, opacity, `update(0)` and removal from the particle list and scene at `life <= 0`. They do not replace a real WebGL/browser check.

### Browser check: explosion particles

`tests/browser/particle-damping.mjs` checks the shipped game in headless Chromium with real WebGL (SwiftShader). Playwright is a verification tool only and is not a game dependency; install it outside the repository:

```bash
mkdir -p ~/pw && (cd ~/pw && npm init -y && npm i playwright@1.65.0 && npx playwright install chromium)
PLAYWRIGHT_PREFIX=~/pw node tests/browser/particle-damping.mjs
```

The script serves `docs/` with `python3 -m http.server` (port `8765`, change it with `PORT`), launches Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`, clicks **START MISSION**, and presses Space for one shot at a time until a shot destroys an enemy. It then records the same explosion at 0, 0.10, 0.25, 0.45, 0.70 and 1.00 s after the hit. The test page queues `requestAnimationFrame` and runs it with a virtual 60 Hz clock, and seeds `Math.random`, so the short explosion is captured at known game times and the run repeats. Game motion, collisions and rendering run unchanged, and `docs/` has no test API. The script exits with a non-zero status if the score does not increase, the particles do not spread and disappear, lives change during the capture, or a `console.error` or page error occurs.

Evidence from the last run is in `tests/evidence/particle-damping/`: full-page PNGs in time order (`00-start-screen.png` to `07-gone-1.00s.png`), 96 px crops around the explosion (`*-zoom.png`), and `run.json` with the HUD text per screenshot, console messages, `console.error` and page errors, failed requests, the Three.js module status, virtual and wall times, the particle pixel measurements and the SHA-256 of the checked sources (`docs/game.js` and the other files). Compare those hashes with `sha256sum docs/game.js` to confirm that the evidence matches the source. Wall times come from CPU rendering and do not show device performance.
