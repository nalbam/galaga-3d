// Browser check for TWIN / SHIELD power-up capsules in real headless Chromium/WebGL.
//
// It serves docs/ with `python3 -m http.server`, starts the game with a real click and fires
// with the real Space key. The ship stays at x = 0, so a destroyed enemy is straight above it and
// its capsule falls onto the ship. The harness controls two things only:
//   - Math.random returns a value chosen by the harness. .99 never starts dives, random fire or drops;
//     .05 makes a kill drop TWIN, .10 makes it drop SHIELD (drop chance .15, split equally);
//     0 makes enemies dive and fire, which is used to cause hits;
//   - requestAnimationFrame callbacks are queued and run with a virtual 60 Hz clock.
// Game logic, collisions, HUD and rendering run as shipped. No global API is added to docs/.
//
// Usage (Playwright installed outside the repository, see README):
//   PLAYWRIGHT_PREFIX=/path/with/node_modules node tests/browser/powerups.mjs
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'tests/evidence/powerups');
const port = Number(process.env.PORT ?? 8766);
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_PREFIX ?? process.cwd()), 'noop.js'));
const { chromium } = require('playwright');
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FRAME_MS = 1000 / 60;
const DESKTOP = { width: 800, height: 900 }, NARROW = { width: 390, height: 844 };

const sha256 = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
const sources = Object.fromEntries(['docs/game.js', 'docs/combat.mjs', 'docs/index.html', 'docs/style.css',
  'tests/browser/powerups.mjs'].map(file => [file, sha256(file)]));
let gitHead = null, gitDirty = null;
try {
  gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  gitDirty = execFileSync('git', ['status', '--porcelain', '--', 'docs'], { cwd: root, encoding: 'utf8' }).trim() !== '';
} catch {}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', join(root, 'docs')],
  { stdio: 'ignore' });
const wallStart = Date.now();
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

let browser;
const record = { startedAt: new Date().toISOString(), gitHead, docsDirtyAgainstHead: gitDirty, sources, launchArgs,
  command: 'PLAYWRIGHT_PREFIX=~/pw node tests/browser/powerups.mjs', url: `http://127.0.0.1:${port}/index.html`,
  frameMs: FRAME_MS, console: [], consoleErrors: [], pageErrors: [], requestFailures: [], steps: [], screenshots: [] };
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(record.url); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch({ headless: true, args: launchArgs });
  record.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 1 });
  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    record.console.push(entry);
    if (msg.type() === 'error') record.consoleErrors.push(entry);
  });
  page.on('pageerror', error => record.pageErrors.push(String(error)));
  page.on('requestfailed', request => record.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.url().includes('three.module.js')) record.threeModule = { url: response.url(), status: response.status() };
  });

  await page.addInitScript(() => {
    const queue = [];
    let now = 0;
    // Harness-only hook created by the test page, not by docs/game.js.
    const harness = window.__powerHarness = { value: .99, time: () => now, pending: () => queue.length };
    Math.random = () => harness.value;
    window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    const text = id => document.querySelector(`#${id}`).textContent;
    const shown = id => !document.querySelector(`#${id}`).hidden;
    harness.hud = () => ({ score: text('score'), stage: text('stage'), lives: text('lives'),
      powerupsShown: shown('powerups'), twin: shown('twinStatus') ? text('twinStatus') : null,
      shield: shown('shieldStatus') ? text('shieldStatus') : null });
    harness.step = ms => { now += ms; for (const callback of queue.splice(0)) callback(now); };
    // Run frames until a condition on the HUD holds; returns the frame count or -1.
    harness.until = (source, max, ms) => {
      const condition = new Function('hud', `return (${source});`);
      for (let frame = 1; frame <= max; frame++) { harness.step(ms); if (condition(harness.hud())) return frame; }
      return -1;
    };
    // Count separate cyan streaks (player shots) per canvas row in a band; returns the largest count.
    harness.cyanStreaks = (top, bottom) => {
      const canvas = document.querySelector('#gameCanvas');
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0);
      const y0 = Math.max(0, Math.round(top * canvas.height)), y1 = Math.min(canvas.height, Math.round(bottom * canvas.height));
      const { data } = context.getImageData(0, y0, canvas.width, y1 - y0);
      let best = 0, bestXs = [];
      for (let y = 0; y < y1 - y0; y++) {
        const xs = [];
        let inside = false;
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const cyan = data[i + 1] > 150 && data[i + 2] > 150 && data[i] < 150;
          if (cyan && !inside) xs.push(x);
          inside = cyan;
        }
        if (xs.length > best) { best = xs.length; bestXs = xs; }
      }
      return { streaks: best, xs: bestXs };
    };
  });

  await page.goto(record.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__powerHarness.pending() > 0, null, { timeout: 30000 });
  const hud = () => page.evaluate(() => window.__powerHarness.hud());
  const step = (frames = 1) => page.evaluate(([n, ms]) => { for (let i = 0; i < n; i++) window.__powerHarness.step(ms); }, [frames, FRAME_MS]);
  const until = (source, max) => page.evaluate(([s, m, ms]) => window.__powerHarness.until(s, m, ms), [source, max, FRAME_MS]);
  const setRandom = value => page.evaluate(v => { window.__powerHarness.value = v; }, value);
  const log = async (name, extra = {}) => { const entry = { name, virtualMs: Math.round(await page.evaluate(() => window.__powerHarness.time())), hud: await hud(), ...extra }; record.steps.push(entry); return entry; };
  const shot = async (name, note) => {
    const file = `${String(record.screenshots.length).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage: true });
    record.screenshots.push({ file, note, viewport: page.viewportSize(), hud: await hud() });
  };
  // Fire one Space press at a time until the score changes (an enemy above x = 0 is destroyed).
  const killOne = async () => {
    const before = (await hud()).score;
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space');
      const frames = await until(`hud.score !== ${JSON.stringify(before)}`, 40);
      if (frames > 0) return { attempt, frames };
    }
    return null;
  };
  // Shots fired with the ship at x = 0 are measured in a band above the ship (world y -6.4 .. -3.2).
  const shotStreaks = async () => {
    const box = await page.locator('#gameCanvas').boundingBox();
    const halfHeight = Math.max(13, 16 / (box.width / box.height));
    const toFraction = y => .5 - y / (2 * halfHeight);
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space');
    // Read the band on each of the next 6 frames and keep the frame with the most streaks.
    const frames = [];
    for (let frame = 0; frame < 6; frame++) {
      await step(1);
      frames.push(await page.evaluate(([a, b]) => window.__powerHarness.cyanStreaks(a, b), [toFraction(-3.2), toFraction(-6.4)]));
    }
    return { ...frames.reduce((best, f) => (f.streaks > best.streaks ? f : best)), perFrame: frames.map(f => f.streaks) };
  };

  await step(5);
  await shot('start-screen', 'Start overlay; power-up HUD hidden');
  check(!(await hud()).powerupsShown, 'power-up HUD visible before the game');
  await page.click('#startButton');
  await step(30);
  await shot('playing', 'Playing, no power-up yet');
  const single0 = await shotStreaks();
  await step(40);
  check(single0.streaks === 1, `one shot expected before TWIN, saw ${single0.streaks}`);
  await log('single-shot-before-twin', { streaks: single0 });

  // TWIN: a kill with random .05 drops a TWIN capsule straight above the ship.
  await setRandom(.05);
  const twinKill = await killOne();
  await setRandom(.99);
  check(twinKill, 'no kill for the TWIN drop');
  const twinFrames = await until('hud.twin !== null', 400);
  check(twinFrames > 0, 'TWIN capsule was not collected');
  const twinAt = await log('twin-collected', { kill: twinKill, framesToCollect: twinFrames });
  check(twinAt.hud.twin === 'TWIN 10s' && twinAt.hud.shield === null, `HUD after TWIN: ${JSON.stringify(twinAt.hud)}`);
  await shot('twin-collected', 'TWIN collected: HUD shows TWIN 10s');
  const twinStreaks = await shotStreaks();
  check(twinStreaks.streaks === 2, `two parallel shots expected with TWIN, saw ${twinStreaks.streaks}`);
  await shot('twin-shots', 'Two parallel shots with TWIN');
  await log('twin-shots', { streaks: twinStreaks });
  const expireFrames = await until('hud.twin === null', 700);
  check(expireFrames > 0, 'TWIN did not expire');
  const expired = await log('twin-expired', { framesAfterShots: expireFrames });
  check(!expired.hud.powerupsShown, 'power-up HUD should hide after TWIN expires');
  // From collection to expiry: 4 frames of shotStreaks + expireFrames ~ 10 s at 60 Hz.
  record.twinPlaySeconds = Math.round((expired.virtualMs - twinAt.virtualMs) / 10) / 100;
  check(Math.abs(record.twinPlaySeconds - 10) < .1, `TWIN lasted ${record.twinPlaySeconds} s of play`);
  await step(30);
  const single1 = await shotStreaks();
  check(single1.streaks === 1, `one shot expected after TWIN expired, saw ${single1.streaks}`);
  await shot('twin-expired', 'TWIN expired: single shot, HUD hidden');
  await log('single-shot-after-twin', { streaks: single1 });

  // SHIELD, then TWIN again so both are shown together.
  await step(40);
  await setRandom(.1);
  const shieldKill = await killOne();
  await setRandom(.99);
  check(shieldKill, 'no kill for the SHIELD drop');
  check(await until('hud.shield !== null', 400) > 0, 'SHIELD capsule was not collected');
  await log('shield-collected', { kill: shieldKill });
  await step(40);
  await setRandom(.05);
  check(await killOne(), 'no kill for the second TWIN drop');
  await setRandom(.99);
  check(await until('hud.twin !== null', 400) > 0, 'second TWIN capsule was not collected');
  const both = await log('both-active');
  check(both.hud.twin === 'TWIN 10s' && both.hud.shield === 'SHIELD ×1', `HUD with both: ${JSON.stringify(both.hud)}`);
  await shot('both-desktop', 'TWIN and SHIELD active (desktop 800x900)');

  await page.setViewportSize(NARROW);
  await step(2);
  await shot('both-narrow', 'TWIN and SHIELD active (narrow 390x844, touch buttons visible)');
  const layout = await page.evaluate(() => {
    const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    return { powerups: box('#powerups'), hudCells: [...document.querySelectorAll('#hud > div')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }),
      buttons: ['#leftButton', '#fireButton', '#rightButton'].map(box), buttonsShown: getComputedStyle(document.querySelector('.mobile-controls')).display };
  });
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  record.narrowLayout = layout;
  check(layout.buttonsShown === 'flex', 'touch buttons should be shown on the narrow screen');
  check(![...layout.hudCells, ...layout.buttons].some(b => overlaps(layout.powerups, b)), 'power-up HUD overlaps the HUD or touch buttons');
  await page.setViewportSize(DESKTOP);
  await step(2);

  // SHIELD block: one frame of random 0 starts a dive at the ship; then .99 again.
  const livesBefore = (await hud()).lives;
  await setRandom(0);
  await step(1);
  await setRandom(.99);
  const blockFrames = await until('hud.shield === null', 400);
  check(blockFrames > 0, 'SHIELD was not consumed by a hit');
  const blocked = await log('shield-blocked', { livesBefore, framesToHit: blockFrames });
  check(blocked.hud.lives === livesBefore, `lives changed on the blocked hit: ${livesBefore} -> ${blocked.hud.lives}`);
  check(blocked.hud.twin !== null, 'TWIN should stay after SHIELD is consumed');
  await step(4);
  await shot('shield-blocked', 'SHIELD consumed by a hit; lives unchanged, TWIN still active');

  // Game over: random 0 keeps enemies diving and firing until all lives are gone.
  await step(130); // the block's invulnerability ends
  await setRandom(0);
  const overFrames = await until('hud.lives === "···"', 3000);
  await setRandom(.99);
  check(overFrames > 0, 'game over did not happen');
  await step(2);
  const over = await log('game-over', { frames: overFrames, gameOverShown: await page.locator('#gameOverScreen').isVisible() });
  check(over.gameOverShown, 'game-over screen not shown');
  check(!over.hud.powerupsShown && over.hud.twin === null && over.hud.shield === null, `power-up HUD after game over: ${JSON.stringify(over.hud)}`);
  await shot('game-over', 'Game over: power-up HUD hidden');
  await page.click('#restartButton');
  await step(30);
  const restarted = await log('restarted');
  check(restarted.hud.lives === '♥♥♥' && restarted.hud.score === '000000' && !restarted.hud.powerupsShown, `after restart: ${JSON.stringify(restarted.hud)}`);
  const single2 = await shotStreaks();
  check(single2.streaks === 1, `one shot expected after restart, saw ${single2.streaks}`);
  await log('single-shot-after-restart', { streaks: single2 });
  await shot('restarted', 'Restarted: lives 3, no power-ups, single shot');
} catch (error) {
  failures.push(`harness error: ${error.stack ?? error}`);
} finally {
  await browser?.close();
  server.kill();
}
check(record.consoleErrors.length === 0, `console.error messages: ${record.consoleErrors.length}`);
check(record.pageErrors.length === 0, `page errors: ${record.pageErrors.length}`);
check(record.threeModule?.status === 200, `Three.js module status: ${record.threeModule?.status}`);
record.finishedAt = new Date().toISOString();
record.wallMs = Date.now() - wallStart;
record.note = 'CPU (SwiftShader) rendering with a virtual frame clock; wall times are not device performance.';
record.failures = failures;
record.passed = failures.length === 0;
record.exitCode = record.passed ? 0 : 1;
record.files = readdirSync(outDir).filter(file => file.endsWith('.png')).sort();
writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ passed: record.passed, failures, steps: record.steps.map(s => ({ name: s.name, hud: s.hud, streaks: s.streaks?.streaks })), files: record.files }, null, 2));
process.exit(record.exitCode);
