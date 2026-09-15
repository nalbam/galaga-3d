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

The deployable files are exactly `docs/index.html`, `docs/style.css`, and `docs/game.js`. `index.html` references the CSS and module with relative paths, so the `/docs` Pages source works without rewriting or a build command.
