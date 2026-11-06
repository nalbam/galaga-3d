// Browser check for explosion particles in real headless Chromium/WebGL.
//
// It serves docs/ with `python3 -m http.server`, starts the game with a real click,
// fires with the real Space key until a shot destroys an enemy, and records the same
// explosion from the hit frame until every particle is gone. PNG files, HUD text,
// console/pageerror output, timing and source hashes go to tests/evidence/particle-damping.
//
// The page code is the unchanged game. The harness only:
//   - queues requestAnimationFrame callbacks and runs them with a virtual clock (1/60 s steps),
//     so the short explosion is captured at known game times on a slow CPU renderer;
//   - seeds Math.random so the run is repeatable.
// Game motion, collisions and rendering run as shipped. No global API is added to docs/.
//
// Usage (Playwright installed outside the repository, see README):
//   PLAYWRIGHT_PREFIX=/path/with/node_modules node tests/browser/particle-damping.mjs
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'tests/evidence/particle-damping');
const port = Number(process.env.PORT ?? 8765);
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_PREFIX ?? process.cwd()), 'noop.js'));
const { chromium } = require('playwright');
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FRAME_MS = 1000 / 60;

const sha256 = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
const sources = Object.fromEntries(['docs/game.js', 'docs/combat.mjs', 'docs/index.html', 'docs/style.css',
  'tests/browser/particle-damping.mjs'].map(file => [file, sha256(file)]));
let gitHead = null;
try { gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', join(root, 'docs')],
  { stdio: 'ignore' });
const startedAt = new Date().toISOString();
const wallStart = Date.now();
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

let browser;
const record = { startedAt, gitHead, sources, launchArgs, url: `http://127.0.0.1:${port}/index.html`,
  frameMs: FRAME_MS, console: [], consoleErrors: [], pageErrors: [], requestFailures: [], screenshots: [] };
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(record.url); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch({ headless: true, args: launchArgs });
  record.browserVersion = browser.version();
  const page = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 });
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
    let seed = 20261106;
    Math.random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const queue = [];
    let now = 0, previous = null;
    window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    // Harness-only hook created by the test page, not by docs/game.js.
    window.__particleHarness = {
      time: () => now,
      pending: () => queue.length,
      // Run one frame and read the WebGL canvas right after it is drawn.
      step(ms, measure) {
        now += ms;
        for (const callback of queue.splice(0)) callback(now);
        if (!measure) return null;
        const canvas = document.querySelector('#gameCanvas');
        const copy = document.createElement('canvas');
        copy.width = canvas.width; copy.height = canvas.height;
        const context = copy.getContext('2d', { willReadFrequently: true });
        context.drawImage(canvas, 0, 0);
        const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
        const frame = { width: copy.width, height: copy.height, pixels };
        const result = { previous, frame };
        previous = frame;
        return result;
      },
      // Particle-coloured (pink) pixels around a point of the last frame read by step(ms, true).
      pinkAround(cx, cy, r) {
        const { width, height, pixels } = previous;
        let count = 0, maxDistance = 0;
        for (let y = Math.max(0, Math.round(cy - r)); y < Math.min(height, Math.round(cy + r)); y++) {
          for (let x = Math.max(0, Math.round(cx - r)); x < Math.min(width, Math.round(cx + r)); x++) {
            const i = (y * width + x) * 4;
            if (pixels[i] > 110 && pixels[i] - pixels[i + 1] > 60 && pixels[i + 2] > 50) {
              count++; maxDistance = Math.max(maxDistance, Math.hypot(x - cx, y - cy));
            }
          }
        }
        return { pinkPixels: count, maxDistancePx: Math.round(maxDistance * 10) / 10 };
      },
    };
  });

  await page.goto(record.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__particleHarness.pending() > 0, null, { timeout: 30000 });
  const hud = () => page.evaluate(() => Object.fromEntries(['score', 'highScore', 'stage', 'lives']
    .map(id => [id, document.querySelector(`#${id}`).textContent])));
  const shot = async (name, note) => {
    const file = `${String(record.screenshots.length).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(outDir, file) });
    const time = await page.evaluate(() => window.__particleHarness.time());
    record.screenshots.push({ file, note, virtualMs: Math.round(time * 1000) / 1000, wallMs: Date.now() - wallStart, hud: await hud() });
  };
  const step = (frames = 1) => page.evaluate(([n, ms]) => { for (let i = 0; i < n; i++) window.__particleHarness.step(ms); }, [frames, FRAME_MS]);
  const canvasBox = await page.locator('#gameCanvas').boundingBox();
  record.canvas = canvasBox;

  await step(5);
  await shot('start-screen', 'Start overlay before input');
  await page.click('#startButton');
  await step(30);
  await shot('playing', 'After clicking START MISSION (0.5 s at 60 Hz)');
  const startHud = await hud();
  check(startHud.score === '000000', `score should start at 000000, got ${startHud.score}`);

  // One shot at a time, so exactly one explosion follows the first hit.
  let hit = null;
  for (let attempt = 0; attempt < 12 && !hit; attempt++) {
    await page.keyboard.down('Space');
    await step(1);
    await page.keyboard.up('Space');
    for (let frame = 0; frame < 60; frame++) {
      const changed = await page.evaluate(([ms, before]) => {
        const { previous, frame } = window.__particleHarness.step(ms, true);
        if (document.querySelector('#score').textContent === before) return null;
        // Locate the hit: the enemy that vanished leaves the densest block of changed pixels
        // between the frame before and the hit frame (formation motion only changes edges).
        const cell = 8, cols = Math.ceil(frame.width / cell), rows = Math.ceil(frame.height / cell);
        const cells = new Array(cols * rows).fill(0);
        for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
          const i = (y * frame.width + x) * 4;
          const d = Math.abs(frame.pixels[i] - previous.pixels[i]) + Math.abs(frame.pixels[i + 1] - previous.pixels[i + 1]) + Math.abs(frame.pixels[i + 2] - previous.pixels[i + 2]);
          if (d > 120) cells[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
        }
        let best = { count: -1, x: null, y: null };
        for (let cy = 0; cy + 5 <= rows; cy++) for (let cx = 0; cx + 5 <= cols; cx++) {
          let count = 0;
          for (let j = 0; j < 5; j++) for (let k = 0; k < 5; k++) count += cells[(cy + j) * cols + cx + k];
          if (count > best.count) best = { count, x: (cx + 2.5) * cell, y: (cy + 2.5) * cell };
        }
        return { score: document.querySelector('#score').textContent, x: best.x, y: best.y, changedPixelsInBlock: best.count };
      }, [FRAME_MS, startHud.score]);
      if (changed) { hit = { attempt, framesAfterShot: frame + 1, ...changed }; break; }
    }
  }
  record.hit = hit;
  if (check(hit, 'no enemy was destroyed by the fired shots')) {
    check(Number(hit.score) > 0, `score should increase after the hit, got ${hit.score}`);
    // Measure particle-coloured (pink) pixels near the hit point for the same explosion.
    const radius = 32;
    // The hit frame is the last frame read; later frames are read right after they are drawn.
    const measure = drawFrame => page.evaluate(([cx, cy, r, ms, draw]) => {
      if (draw) window.__particleHarness.step(ms, true);
      return window.__particleHarness.pinkAround(cx, cy, r);
    }, [hit.x, hit.y, radius, FRAME_MS, drawFrame]);
    // Re-draw the hit frame state is already on screen: capture it, then advance at 60 Hz.
    const series = [];
    let elapsedFrames = 0;
    const captureAt = [[0, 'hit'], [6, 'spread-0.10s'], [15, 'spread-0.25s'], [27, 'spread-0.45s'], [42, 'fade-0.70s'], [60, 'gone-1.00s']];
    for (const [frames, name] of captureAt) {
      if (frames > elapsedFrames) await step(frames - elapsedFrames - 1);
      const metrics = await measure(frames > elapsedFrames);
      elapsedFrames = frames;
      series.push({ secondsAfterHit: Math.round(frames / 60 * 1000) / 1000, ...metrics });
      await shot(name, `Same explosion, ${frames} frames (${(frames / 60).toFixed(2)} s) after the hit frame`);
      const crop = record.screenshots.at(-1).file.replace('.png', '-zoom.png');
      await page.screenshot({ path: join(outDir, crop), clip: { x: canvasBox.x + hit.x - 48, y: canvasBox.y + hit.y - 48, width: 96, height: 96 } });
      record.screenshots.at(-1).zoom = crop;
    }
    record.particleSeries = { hitPoint: { x: hit.x, y: hit.y }, boxRadiusPx: radius, series };
    const at = s => series.find(p => p.secondsAfterHit === s);
    check(at(.25).maxDistancePx > at(0).maxDistancePx + 3, 'particles should spread between the hit and 0.25 s');
    check(at(.25).pinkPixels > 0, 'particles should be visible near the hit point at 0.25 s');
    check(at(1).pinkPixels === 0, 'particles should be gone by 1 s (spawn life is below 0.85 s)');
    const livesDuring = new Set(record.screenshots.slice(2).map(s => s.hud.lives));
    check(livesDuring.size === 1, 'lives changed during the explosion capture (another explosion may be mixed in)');
  }
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
record.files = readdirSync(outDir).filter(file => file.endsWith('.png')).sort();
writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ passed: record.passed, failures, hit: record.hit, particleSeries: record.particleSeries, files: record.files }, null, 2));
process.exit(record.passed ? 0 : 1);
