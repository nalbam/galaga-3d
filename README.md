# Neon Swarm // Galaga 3D

A polished, static Three.js arcade shooter inspired by classic space-invader formations. The game runs directly from the `docs/` folder: there is no build step, framework, package manager, backend, or bundler.

## Run locally

Because browsers restrict ES-module imports from `file://`, serve the repository with any simple static server, then open the printed URL:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/docs/>. The only runtime dependency is Three.js 0.187.0, loaded from the jsDelivr CDN (`https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js`, which also loads `three.core.js` from the same folder). The page needs network access to jsDelivr.

Three.js 0.187.0 supports only WebGL 2 (WebGL 1 was removed in r163). Current desktop and mobile browsers support WebGL 2. Without it, the renderer cannot be created: the start screen text appears, but the canvas stays empty and the game does not start.

## Controls

- Move: `ArrowLeft` / `ArrowRight` or `A` / `D`
- Fire: `Space`
- Mouse: move the pointer to steer the ship along the X axis (mapped to the combat plane through the camera); hold the left button to fire at the normal `.22 s` interval. Clicks on menu, sound, and touch buttons do not move or fire.
- Power-ups: fly the ship into a falling capsule to collect it. There is no extra button; any movement (keys, mouse, touch) works.
- Pause/resume: `P` or `Escape`
- Touch devices: use the on-screen left, fire, and right buttons
- `SOUND ON/OFF` toggles Web Audio sound effects

## Features

- Responsive WebGL canvas with retro neon HUD, scanlines, grid, and procedural geometry
- Formation waves with basic, elite, and boss enemies; lateral movement and dive attacks
- Player and enemy projectiles, collision detection, lives, stages, stage transitions, and explosions
- Elite swarms every third stage, including a higher-health boss enemy
- Power-up capsules: each enemy destroyed by a shot has a 15% chance to drop a capsule (TWIN and SHIELD are equally likely). Non-lethal hits and enemies that ram the ship never drop. Capsules fall at 4 units/s and are removed below the screen.
  - TWIN (green, two bars): for 10 s of play time every shot fires two parallel bolts at the normal `.22 s` interval. Collecting TWIN again resets the timer to 10 s.
  - SHIELD (blue, orb; a blue bubble surrounds the ship): blocks the next hit from an enemy shot or an enemy body without losing a life, then disappears. It has no timer and does not stack (one block at most). A block gives the normal 2 s post-hit invulnerability; hits during invulnerability do not use the shield. Using the shield keeps TWIN.
  - The HUD below the score shows `TWIN <seconds>s` and `SHIELD ×1`, and hides each when it is not active. Pause stops the timer and the capsules. Effects and capsules stay through stage changes and are cleared on a new game and on game over.
- Score and high score persisted in `localStorage`
- Game-over statistics for the run: the stage reached (the stage at game over), enemies destroyed by type (KILLS BASIC / ELITE / BOSS) and ACCURACY with hits/shots (for example `38% 3/8`).
  - Shots count every player bolt created; a TWIN volley counts as two. Hits count every bolt that struck an enemy, including hits that only lower an elite's or boss's health; one bolt counts at most once, so accuracy never exceeds 100%.
  - Kills count only enemies destroyed by a shot. Enemies that ram the ship are not kills.
  - Accuracy is `Math.round(hits / shots * 100)` as a whole percent; with no shots it shows `0%`.
  - Statistics change only during play, stay fixed after game over, and restart from zero in a new game.
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

Combat uses a shared XY plane: player shots travel upward, enemy shots travel downward, and diving enemies return to their original moving formation slot. Stage difficulty (dive chance, fire interval, shot speed, concurrent dives and shots, rows, elites, boss health) comes from the pure `difficultyForStage(stage)` in `docs/combat.mjs`; values saturate at fixed caps. Explosion particles move by elapsed time, not by frame count: each update decays velocity by `.94^(60*dt)` and moves the particle by the matching 60 Hz geometric sum. At 60 Hz this is the original look (move by `velocity/60`, then multiply by `.94`), and the same explosion spreads equally at 30 Hz or 144 Hz. Power-up rules are pure functions in `docs/combat.mjs` (`rollPowerupDrop(random)`, `applyPowerup`, `advanceEffects`, `absorbHit`, `powerupHudText`); they take the random function and elapsed time as arguments and return new state. A cleared wave advances the stage once and starts the next wave after .9 s of play time (pause holds it, a restart cancels it). Game-over statistics are pure functions in `docs/combat.mjs` (`createRunStats`, `recordShotsFired`, `recordShotHit`, `recordKill`, `accuracyPercent`, `runStatsText`) that return new state; `docs/game.js` only calls them from `firePlayer`, `collisions`, the lethal path of `destroyEnemy`, `startGame` and the game over in `loseLife`. Tests cover the combat helpers, the statistics rules (0% with no shots, rounding such as 1/3 = 33% and 2/3 = 67%, the 100% cap, kills by type, unknown types rejected, inputs unchanged), the actual statistics wiring (one shot per bolt and two with TWIN, non-lethal hits counted once per bolt, misses, body collisions not counted, game-over screen values, 0% with no shots, no change after game over, reset in a new game), the power-up rules with fixed random values (drop boundaries at `.075` and `.15`, refresh, both active, expiry, shield use), the actual game wiring (one drop roll per kill, no drop on non-lethal hits or body collisions, capsule fall/pickup/removal, twin shots and expiry, shield against shots and bodies and during invulnerability, pause, wave change, new game, game over, HUD writes), the difficulty curve (monotonic, capped, small per-stage steps) and the actual game loop with rendering/DOM substitutes. The particle tests run one seeded explosion through the real `update(dt)` at 30, 60 and 144 Hz for 1 s and compare every particle's position and velocity with each other and with the original 60 Hz move-then-decay loop (lifetimes are stretched in the test only for that comparison). A separate test checks the real spawn lifetime, life countdown, opacity, `update(0)` and removal from the particle list and scene at `life <= 0`. They do not replace a real WebGL/browser check.

### Browser check: explosion particles

`tests/browser/particle-damping.mjs` checks the shipped game in headless Chromium with real WebGL (SwiftShader). Playwright is a verification tool only and is not a game dependency; install it outside the repository:

```bash
mkdir -p ~/pw && (cd ~/pw && npm init -y && npm i playwright@1.65.0 && npx playwright install chromium)
PLAYWRIGHT_PREFIX=~/pw node tests/browser/particle-damping.mjs
```

The script serves `docs/` with `python3 -m http.server` (port `8765`, change it with `PORT`), launches Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader`, clicks **START MISSION**, and presses Space for one shot at a time until a shot destroys an enemy. It then records the same explosion at 0, 0.10, 0.25, 0.45, 0.70 and 1.00 s after the hit. The test page queues `requestAnimationFrame` and runs it with a virtual 60 Hz clock, and seeds `Math.random`, so the short explosion is captured at known game times and the run repeats. Game motion, collisions and rendering run unchanged, and `docs/` has no test API. The script exits with a non-zero status if the score does not increase, the particles do not spread and disappear, lives change during the capture, or a `console.error` or page error occurs.

Evidence from the last run is in `tests/evidence/particle-damping/`: full-page PNGs in time order (`00-start-screen.png` to `07-gone-1.00s.png`), 96 px crops around the explosion (`*-zoom.png`), and `run.json` with the HUD text per screenshot, console messages, `console.error` and page errors, failed requests, the Three.js module status, virtual and wall times, the particle pixel measurements and the SHA-256 of the checked sources (`docs/game.js` and the other files). Compare those hashes with `sha256sum docs/game.js` to confirm that the evidence matches the source. Wall times come from CPU rendering and do not show device performance.

### Browser check: power-up capsules

`tests/browser/powerups.mjs` uses the same setup (static server on port `8766`, SwiftShader Chromium, virtual 60 Hz frame clock):

```bash
PLAYWRIGHT_PREFIX=~/pw node tests/browser/powerups.mjs
```

The test page replaces `Math.random` with a value the script chooses: `.99` (no dives, random fire or drops), `.05` (a kill drops TWIN), `.1` (a kill drops SHIELD) and `0` (enemies dive and fire to cause hits). The ship stays at x = 0 and fires with the real Space key, so the destroyed enemy is above the ship and its capsule falls onto it. The script checks: one shot before TWIN, `TWIN 10s` after pickup and two parallel shots (counted as cyan streaks in the canvas), expiry after 10 s of play and one shot again, SHIELD pickup, both shown together on desktop (800x900) and narrow (390x844) screens without overlapping the HUD or touch buttons, a blocked hit with lives unchanged and TWIN kept, game over with the power-up HUD hidden, and a restart with 3 lives and one shot. It exits with a non-zero status on any failed check, `console.error` or page error.

Evidence is in `tests/evidence/powerups/`: full-page PNGs (`00-start-screen.png` to `09-restarted.png`) and `run.json` with the HUD text per step, shot streak counts, narrow-screen layout boxes, console and page errors, failed requests, the Three.js module status, `gitHead` and the SHA-256 of the checked sources. `gitHead` is the commit the run started from; compare the hashes with `sha256sum docs/*` to confirm that the evidence matches the source.

### Browser check: game-over statistics

`tests/browser/game-over-stats.mjs` uses the same setup (static server on port `8767`, SwiftShader Chromium, virtual 60 Hz frame clock):

```bash
PLAYWRIGHT_PREFIX=~/pw node tests/browser/game-over-stats.mjs
```

The test page sets `Math.random` to `.99` (no dives, random fire or drops) while the ship fires and to `0` (enemies dive and fire) to reach game over. The script counts the expected values itself: each real Space press is one shot, and on stage 1 (basic enemies with 1 health) each +100 score is one hit and one basic kill. It fires from x = 0 until three kills, moves to the right edge with the real ArrowRight key and fires two shots that miss, then checks that the game-over screen shows exactly the counted stage, kills and accuracy, and that holding Space after game over changes nothing. After **RESTART** it reaches game over again without firing and checks stage `01`, kills `0` and `0%` (`0/0`). On desktop (800x900) and narrow (390x844) screens it checks that the statistics block stays inside the overlay, above RESTART and does not overlap the title, final score, new-record line, RESTART or the touch buttons (the touch buttons are hidden while an overlay is shown). It exits with a non-zero status on any failed check, `console.error` or page error.

Evidence is in `tests/evidence/game-over-stats/`: full-page PNGs (`00-playing.png` to `04-second-game-over-narrow.png`) and `run.json` with the HUD and statistics text per step, the counted and shown statistics per game, the layout boxes, console and page errors, failed requests, the Three.js module status, `gitHead` and the SHA-256 of the checked sources. `gitHead` is the commit the run started from; compare the hashes with `sha256sum docs/*` to confirm that the evidence matches the source.

### Browser check: Three.js upgrade comparison

`tests/browser/three-upgrade-compare.mjs` runs the game twice in the same headless Chromium (SwiftShader): once with `docs/game.js` from a git revision (the "before" code) and once with the working tree `docs/game.js` (the "after" code). It compares the screens. The script contains no Three.js version; the Three.js URL comes from the import in each `game.js`.

```bash
PLAYWRIGHT_PREFIX=~/pw node tests/browser/three-upgrade-compare.mjs          # before = c7bd593 (Three.js 0.160.0)
PLAYWRIGHT_PREFIX=~/pw node tests/browser/three-upgrade-compare.mjs <rev>    # or BASE_REV=<rev>
```

Both runs use port `8768` (change it with `PORT`), an 800x900 viewport with deviceScaleFactor 1, a seeded `Math.random`, a virtual 60 Hz `requestAnimationFrame` clock and the same input sequence. The test page replaces only the body of the `game.js` response. It takes three screenshots: the start screen, the playing screen (START MISSION, 30 frames, Space held for 40 frames, 20 frames) and the game-over screen (`Math.random` fixed to `0` until game over). `Math.random` calls from the Three.js modules (UUID generation) are counted apart, so the game's random sequence does not depend on the Three.js version. Screenshots use Playwright `animations: 'disabled'`, because the CSS animations run on the wall clock. For each screen pair it records the per-channel means, mean luminance, mean absolute difference and the share of pixels with a channel difference above 16, and saves an amplified diff image. A pair is "noticeable" when a mean differs by more than 2 (of 255) or more than 1% of pixels change. The script exits with a non-zero status on a `console.error` or page error in the "after" run, a Three.js module response other than 200, or a failed step. Warnings that only the "after" run has are listed in `newWarningsAfter`.

Evidence is in `tests/evidence/three-upgrade/`: `before-*.png`, `after-*.png`, `diff-*.png` and `run.json` (git HEAD, base revision, SHA-256 of both `game.js` versions, browser version, console messages, page errors, failed requests, loaded Three.js module URLs and statuses, and the measurements). `release-notes.md` holds the analysis of the Three.js r161–r187 release notes and Migration Guide for the APIs the game uses.
