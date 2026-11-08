// Before/after browser comparison for a Three.js upgrade in real headless Chromium/WebGL.
//
// The "before" game code comes from a git revision (`git show <rev>:docs/game.js`), the "after" code is
// the working tree docs/game.js. Both runs are served from the same `python3 -m http.server`; the test
// page only replaces the body of the game.js response, so the Three.js URL is whatever that game.js
// imports. This script contains no Three.js version: the versions in run.json come from the loaded URLs.
//
// Both runs use the same conditions: viewport 800x900, deviceScaleFactor 1, a seeded Math.random
// (mulberry32, seed SEED), a virtual 60 Hz requestAnimationFrame queue, and the same input sequence:
//   00-start    : 5 frames after load, start screen;
//   01-playing  : click START MISSION, 30 frames, Space held for 40 frames, then 20 frames;
//   02-game-over: Math.random fixed to 0 (enemies dive and fire) until the game-over screen, then 2 frames.
// Math.random calls made from the Three.js modules (UUID generation) return .5 and are counted apart, so the
// game's seeded sequence does not depend on the Three.js version. The number of game Math.random calls before
// each screenshot is recorded for both runs; equal counts show that both runs consumed the same sequence.
//
// Screenshots use Playwright `animations: 'disabled'`: the CSS animations (.new-record pulse, .toast) run on the
// wall clock, not the virtual frame clock, and would otherwise differ between runs for reasons unrelated to WebGL.
// Each screenshot pair is compared in the browser: per-channel means, mean luminance (Rec. 709 weights),
// mean absolute difference and the share of pixels whose largest channel difference exceeds DIFF_THRESHOLD.
// A diff image (amplified x4) is saved for each pair.
// The script exits non-zero if the "after" run has console.error or page errors, a Three.js module
// response is not 200, or a harness step fails. New warnings that the "before" run did not have are
// listed in run.json under `newWarningsAfter`.
//
// Usage (Playwright installed outside the repository, see README):
//   PLAYWRIGHT_PREFIX=~/pw node tests/browser/three-upgrade-compare.mjs [base-rev]
//   BASE_REV=<rev> also selects the "before" revision; the default is c7bd593.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'tests/evidence/three-upgrade');
const port = Number(process.env.PORT ?? 8768);
const baseRev = process.argv[2] ?? process.env.BASE_REV ?? 'c7bd593';
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_PREFIX ?? process.cwd()), 'noop.js'));
const { chromium } = require('playwright');
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FRAME_MS = 1000 / 60;
const SEED = 20261108;
const VIEWPORT = { width: 800, height: 900 };
const DIFF_THRESHOLD = 16; // per-channel difference (0-255) that counts a pixel as changed
// "Noticeable" brightness or colour change, used in release-notes.md: mean luminance or any channel mean
// differs by more than 2 levels (of 255), or more than 1% of pixels exceed DIFF_THRESHOLD.
const NOTICEABLE = { meanDelta: 2, changedShare: .01 };

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const sha256 = data => createHash('sha256').update(data).digest('hex');
const gitHead = git('rev-parse', 'HEAD').trim();
const baseCommit = git('rev-parse', `${baseRev}^{commit}`).trim();
const beforeSource = git('show', `${baseCommit}:docs/game.js`);
const afterSource = readFileSync(join(root, 'docs/game.js'), 'utf8');
const threeImport = source => source.split('\n').find(line => line.includes('import * as THREE')) ?? null;

// release-notes.md is hand-written analysis; keep it when regenerating the evidence.
const notesPath = join(outDir, 'release-notes.md');
let notes = null;
try { notes = readFileSync(notesPath, 'utf8'); } catch {}
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (notes !== null) writeFileSync(notesPath, notes);

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', join(root, 'docs')],
  { stdio: 'ignore' });
const wallStart = Date.now();
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
const url = `http://127.0.0.1:${port}/index.html`;
const record = {
  startedAt: new Date().toISOString(), gitHead,
  docsDirtyAgainstHead: git('status', '--porcelain', '--', 'docs').trim() !== '',
  baseRev, baseCommit, launchArgs, url, viewport: VIEWPORT, deviceScaleFactor: 1, frameMs: FRAME_MS, seed: SEED,
  diffThreshold: DIFF_THRESHOLD, noticeable: NOTICEABLE,
  command: 'PLAYWRIGHT_PREFIX=~/pw node tests/browser/three-upgrade-compare.mjs',
  sources: {
    before: { from: `git show ${baseCommit}:docs/game.js`, sha256: sha256(beforeSource), threeImport: threeImport(beforeSource) },
    after: { from: 'working tree docs/game.js', sha256: sha256(afterSource), threeImport: threeImport(afterSource) },
    'docs/combat.mjs': sha256(readFileSync(join(root, 'docs/combat.mjs'))),
    'docs/index.html': sha256(readFileSync(join(root, 'docs/index.html'))),
    'docs/style.css': sha256(readFileSync(join(root, 'docs/style.css'))),
    'tests/browser/three-upgrade-compare.mjs': sha256(readFileSync(fileURLToPath(import.meta.url))),
  },
  runs: {}, comparisons: [],
};

async function runGame(browser, label, gameSource) {
  const run = { label, console: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [],
    threeModules: [], screenshots: [] };
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', msg => {
    const entry = { type: msg.type(), text: msg.text() };
    run.console.push(entry);
    if (msg.type() === 'error') run.consoleErrors.push(entry);
    if (msg.type() === 'warning') run.consoleWarnings.push(entry);
  });
  page.on('pageerror', error => run.pageErrors.push(String(error)));
  page.on('requestfailed', request => run.requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => {
    if (/\/three@[^/]+\/build\//.test(response.url())) run.threeModules.push({ url: response.url(), status: response.status() });
  });
  await page.route(/\/game\.js(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: gameSource }));
  await page.addInitScript(seed => {
    const queue = [];
    let now = 0, state = seed >>> 0;
    const seeded = () => { // mulberry32
      state = (state + 0x6D2B79F5) >>> 0; let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Harness-only hook created by the test page, not by docs/game.js.
    const harness = window.__compareHarness = { fixed: null, calls: 0, threeCalls: 0, time: () => now, pending: () => queue.length };
    // Calls from the Three.js modules (for example MathUtils.generateUUID) get a separate counter and do not
    // consume the game's seeded sequence, so a different number of internal calls cannot change the game.
    Math.random = () => {
      if (/\/three@[^/]+\/build\//.test(new Error().stack ?? '')) { harness.threeCalls++; return .5; }
      harness.calls++; return harness.fixed ?? seeded();
    };
    window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    harness.step = ms => { now += ms; for (const callback of queue.splice(0)) callback(now); };
    harness.gameOver = () => !document.querySelector('#gameOverScreen').hidden;
    harness.hud = () => ({ score: document.querySelector('#score').textContent, stage: document.querySelector('#stage').textContent,
      lives: document.querySelector('#lives').textContent, gameOver: harness.gameOver() });
  }, SEED);

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__compareHarness.pending() > 0, null, { timeout: 30000 });
  const step = (frames = 1) => page.evaluate(([n, ms]) => { for (let i = 0; i < n; i++) window.__compareHarness.step(ms); }, [frames, FRAME_MS]);
  const shot = async (name, note) => {
    const file = `${label}-${String(run.screenshots.length).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage: true, animations: 'disabled' });
    const info = await page.evaluate(() => ({ virtualMs: Math.round(window.__compareHarness.time()), randomCalls: window.__compareHarness.calls, threeRandomCalls: window.__compareHarness.threeCalls, hud: window.__compareHarness.hud() }));
    run.screenshots.push({ name, file, note, ...info });
  };

  await step(5);
  await shot('start', 'Start screen, 5 frames after load');
  await page.click('#startButton');
  await step(30);
  await page.keyboard.down('Space'); await step(40); await page.keyboard.up('Space');
  await step(20);
  await shot('playing', 'START MISSION clicked, 30 frames, Space held 40 frames, 20 frames');
  await page.evaluate(() => { window.__compareHarness.fixed = 0; });
  run.gameOverFrames = await page.evaluate(([max, ms]) => {
    for (let frame = 1; frame <= max; frame++) { window.__compareHarness.step(ms); if (window.__compareHarness.gameOver()) return frame; }
    return -1;
  }, [4000, FRAME_MS]);
  await step(2);
  check(run.gameOverFrames > 0, `${label}: game over not reached`);
  await shot('game-over', 'Math.random fixed to 0 until game over, then 2 frames');
  await context.close();
  return run;
}

async function compare(page, name, beforeFile, afterFile) {
  const toData = file => `data:image/png;base64,${readFileSync(join(outDir, file)).toString('base64')}`;
  const result = await page.evaluate(async ([a, b, threshold]) => {
    const load = src => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const pixels = img => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
    const pa = pixels(ia), pb = pixels(ib);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const og = out.getContext('2d'); const diff = og.createImageData(w, h);
    const sum = { a: [0, 0, 0], b: [0, 0, 0], abs: [0, 0, 0] }; let changed = 0, maxDiff = 0;
    for (let i = 0; i < pa.length; i += 4) {
      let pixelMax = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(pa[i + c] - pb[i + c]);
        sum.a[c] += pa[i + c]; sum.b[c] += pb[i + c]; sum.abs[c] += d; pixelMax = Math.max(pixelMax, d);
        diff.data[i + c] = Math.min(255, d * 4);
      }
      diff.data[i + 3] = 255;
      if (pixelMax > threshold) changed++;
      maxDiff = Math.max(maxDiff, pixelMax);
    }
    og.putImageData(diff, 0, 0);
    const n = w * h, mean = arr => arr.map(v => +(v / n).toFixed(3));
    const luma = m => +(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]).toFixed(3);
    const before = mean(sum.a), after = mean(sum.b);
    return { size: { width: w, height: h, beforeSize: [ia.width, ia.height], afterSize: [ib.width, ib.height] },
      before: { channelMeanRGB: before, meanLuminance: luma(before) }, after: { channelMeanRGB: after, meanLuminance: luma(after) },
      meanAbsDiffRGB: mean(sum.abs), maxChannelDiff: maxDiff, changedPixels: changed, changedShare: +(changed / n).toFixed(6),
      diffPng: out.toDataURL('image/png') };
  }, [toData(beforeFile), toData(afterFile), DIFF_THRESHOLD]);
  const diffFile = `diff-${name}.png`;
  writeFileSync(join(outDir, diffFile), Buffer.from(result.diffPng.split(',')[1], 'base64'));
  delete result.diffPng;
  const deltas = [result.after.meanLuminance - result.before.meanLuminance,
    ...result.after.channelMeanRGB.map((v, c) => v - result.before.channelMeanRGB[c])];
  result.meanLuminanceDelta = +deltas[0].toFixed(3);
  result.channelMeanDeltaRGB = deltas.slice(1).map(v => +v.toFixed(3));
  result.noticeable = deltas.some(d => Math.abs(d) > NOTICEABLE.meanDelta) || result.changedShare > NOTICEABLE.changedShare;
  return { name, before: beforeFile, after: afterFile, diff: diffFile, ...result };
}

let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch({ headless: true, args: launchArgs });
  record.browserVersion = browser.version();
  record.runs.before = await runGame(browser, 'before', beforeSource);
  record.runs.after = await runGame(browser, 'after', afterSource);
  const page = await browser.newPage();
  for (const [index, entry] of record.runs.before.screenshots.entries()) {
    const other = record.runs.after.screenshots[index];
    if (!check(other?.name === entry.name, `screenshot ${entry.name} missing after the upgrade`)) continue;
    const comparison = await compare(page, `${String(index).padStart(2, '0')}-${entry.name}`, entry.file, other.file);
    comparison.randomCallsBefore = entry.randomCalls; comparison.randomCallsAfter = other.randomCalls;
    comparison.sameRandomSequence = entry.randomCalls === other.randomCalls;
    comparison.hudBefore = entry.hud; comparison.hudAfter = other.hud;
    record.comparisons.push(comparison);
  }
} catch (error) {
  failures.push(`harness error: ${error.stack ?? error}`);
} finally {
  await browser?.close();
  server.kill();
}
const after = record.runs.after ?? {};
const warningKey = entry => entry.text.replace(/\d+/g, '#');
const beforeWarnings = new Set((record.runs.before?.consoleWarnings ?? []).map(warningKey));
record.newWarningsAfter = (after.consoleWarnings ?? []).filter(entry => !beforeWarnings.has(warningKey(entry)));
record.anyNoticeableDifference = record.comparisons.some(c => c.noticeable);
check((after.consoleErrors ?? []).length === 0, `after: console.error messages: ${(after.consoleErrors ?? []).length}`);
check((after.pageErrors ?? []).length === 0, `after: page errors: ${(after.pageErrors ?? []).length}`);
for (const label of ['before', 'after']) {
  const modules = record.runs[label]?.threeModules ?? [];
  check(modules.length > 0 && modules.every(m => m.status === 200), `${label}: Three.js module responses ${JSON.stringify(modules)}`);
}
record.finishedAt = new Date().toISOString();
record.wallMs = Date.now() - wallStart;
record.note = 'CPU (SwiftShader) rendering with a virtual frame clock; no device performance or frame rate is measured.';
record.failures = failures;
record.passed = failures.length === 0;
record.exitCode = record.passed ? 0 : 1;
record.files = readdirSync(outDir).filter(file => file.endsWith('.png')).sort();
writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ passed: record.passed, failures, newWarningsAfter: record.newWarningsAfter,
  threeModules: { before: record.runs.before?.threeModules, after: after.threeModules },
  comparisons: record.comparisons.map(c => ({ name: c.name, lumaDelta: c.meanLuminanceDelta, rgbDelta: c.channelMeanDeltaRGB,
    meanAbsDiff: c.meanAbsDiffRGB, changedShare: c.changedShare, noticeable: c.noticeable, sameRandomSequence: c.sameRandomSequence })) }, null, 2));
process.exit(record.exitCode);
