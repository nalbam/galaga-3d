// Browser check for the game-over statistics in real headless Chromium/WebGL.
//
// It serves docs/ with `python3 -m http.server`, starts the game with a real click, fires with the
// real Space key and moves with the real ArrowRight key. The harness controls two things only:
//   - Math.random returns a value chosen by the harness. .99 never starts dives, random fire or drops;
//     0 makes enemies dive and fire, which is used to reach game over;
//   - requestAnimationFrame callbacks are queued and run with a virtual 60 Hz clock.
// The script counts the expected statistics itself: every Space press after the cooldown is one shot
// (no TWIN is collected because drops are off), and stage 1 has only basic enemies with 1 health, so
// each +100 score after a shot is one hit and one basic kill; a shot with no score change is a miss.
// Game logic, collisions, HUD and rendering run as shipped. No global API is added to docs/.
//
// Usage (Playwright installed outside the repository, see README):
//   PLAYWRIGHT_PREFIX=/path/with/node_modules node tests/browser/game-over-stats.mjs
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'tests/evidence/game-over-stats');
const port = Number(process.env.PORT ?? 8767);
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_PREFIX ?? process.cwd()), 'noop.js'));
const { chromium } = require('playwright');
const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FRAME_MS = 1000 / 60;
const SHOT_FRAMES = 50; // a player shot crosses the screen (y -7.1 -> 14 at 30 units/s) in about 42 frames
const DESKTOP = { width: 800, height: 900 }, NARROW = { width: 390, height: 844 };

const sha256 = file => createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
const sources = Object.fromEntries(['docs/game.js', 'docs/combat.mjs', 'docs/index.html', 'docs/style.css',
  'tests/browser/game-over-stats.mjs'].map(file => [file, sha256(file)]));
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
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected),
  `${message}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
const expectedText = ({ stage, shots, hits, basic, elite = 0, boss = 0 }) => ({
  stage: String(stage).padStart(2, '0'), basic: String(basic), elite: String(elite), boss: String(boss),
  accuracy: `${shots > 0 ? Math.round(hits / shots * 100) : 0}%`, shots: `${hits}/${shots}` });

let browser;
const record = { startedAt: new Date().toISOString(), gitHead, docsDirtyAgainstHead: gitDirty, sources, launchArgs,
  command: 'PLAYWRIGHT_PREFIX=~/pw node tests/browser/game-over-stats.mjs', url: `http://127.0.0.1:${port}/index.html`,
  frameMs: FRAME_MS, console: [], consoleErrors: [], pageErrors: [], requestFailures: [], steps: [], screenshots: [], runs: [], layouts: [] };
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
    const harness = window.__statsHarness = { value: .99, time: () => now, pending: () => queue.length };
    Math.random = () => harness.value;
    window.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    const text = id => document.querySelector(`#${id}`).textContent;
    harness.hud = () => ({ score: text('score'), stage: text('stage'), lives: text('lives'),
      gameOver: !document.querySelector('#gameOverScreen').hidden, finalScore: text('finalScore'),
      newHighScore: !document.querySelector('#newHighScore').hidden });
    harness.stats = () => ({ stage: text('statStage'), basic: text('statKillsBasic'), elite: text('statKillsElite'),
      boss: text('statKillsBoss'), accuracy: text('statAccuracy'), shots: text('statShots') });
    harness.step = ms => { now += ms; for (const callback of queue.splice(0)) callback(now); };
    harness.until = (source, max, ms) => {
      const condition = new Function('hud', `return (${source});`);
      for (let frame = 1; frame <= max; frame++) { harness.step(ms); if (condition(harness.hud())) return frame; }
      return -1;
    };
  });

  await page.goto(record.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__statsHarness.pending() > 0, null, { timeout: 30000 });
  const hud = () => page.evaluate(() => window.__statsHarness.hud());
  const stats = () => page.evaluate(() => window.__statsHarness.stats());
  const step = (frames = 1) => page.evaluate(([n, ms]) => { for (let i = 0; i < n; i++) window.__statsHarness.step(ms); }, [frames, FRAME_MS]);
  const until = (source, max) => page.evaluate(([s, m, ms]) => window.__statsHarness.until(s, m, ms), [source, max, FRAME_MS]);
  const setRandom = value => page.evaluate(v => { window.__statsHarness.value = v; }, value);
  const log = async (name, extra = {}) => { const entry = { name, virtualMs: Math.round(await page.evaluate(() => window.__statsHarness.time())), hud: await hud(), stats: await stats(), ...extra }; record.steps.push(entry); return entry; };
  const shot = async (name, note) => {
    const file = `${String(record.screenshots.length).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage: true });
    record.screenshots.push({ file, note, viewport: page.viewportSize(), hud: await hud(), stats: await stats() });
  };
  // One Space press = one shot (cooldown .22 s has passed). Returns true if the score rose by 100.
  const fireOnce = async () => {
    const before = Number((await hud()).score);
    await page.keyboard.down('Space'); await step(1); await page.keyboard.up('Space');
    await step(SHOT_FRAMES);
    const gained = Number((await hud()).score) - before;
    check(gained === 0 || gained === 100, `unexpected score change ${gained} for one shot`);
    return gained === 100;
  };
  const toGameOver = async () => {
    await setRandom(0);
    const frames = await until('hud.gameOver', 4000);
    await setRandom(.99);
    await step(2);
    return frames;
  };
  const overlaps = (a, b) => a.width > 0 && b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const inside = (a, b) => a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  const checkLayout = async name => {
    const layout = await page.evaluate(() => {
      const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { viewport: { width: innerWidth, height: innerHeight }, stage: box('#gameStage'), overlay: box('#gameOverScreen'),
        title: box('#gameOverScreen h2'), finalScore: box('.result-line'), newHighScore: box('#newHighScore'),
        stats: box('#runStats'), statCells: [...document.querySelectorAll('#runStats > div')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }),
        restart: box('#restartButton'), touchButtons: ['#leftButton', '#fireButton', '#rightButton'].map(box),
        touchControlsDisplay: getComputedStyle(document.querySelector('.mobile-controls')).display };
    });
    const others = { restart: layout.restart, finalScore: layout.finalScore, newHighScore: layout.newHighScore, title: layout.title,
      leftButton: layout.touchButtons[0], fireButton: layout.touchButtons[1], rightButton: layout.touchButtons[2] };
    layout.overlapsWithStats = Object.entries(others).filter(([, b]) => overlaps(layout.stats, b)).map(([key]) => key);
    layout.statsInsideOverlay = inside(layout.stats, layout.overlay);
    layout.restartInsideOverlay = inside(layout.restart, layout.overlay);
    layout.statCellsInsideStats = layout.statCells.every(c => inside(c, layout.stats));
    record.layouts.push({ name, ...layout });
    check(layout.stats.width > 0 && layout.stats.height > 0, `${name}: statistics block not rendered`);
    check(layout.overlapsWithStats.length === 0, `${name}: statistics block overlaps ${layout.overlapsWithStats.join(', ')}`);
    check(layout.statsInsideOverlay && layout.restartInsideOverlay, `${name}: statistics or RESTART outside the game-over overlay`);
    check(layout.statCellsInsideStats, `${name}: a statistics cell overflows the block`);
    check(layout.stats.bottom <= layout.restart.top, `${name}: statistics block is not above RESTART`);
    return layout;
  };

  await step(5);
  await page.click('#startButton');
  await step(30);
  await shot('playing', 'First game, stage 1, ship at x = 0');

  // First game: shots from x = 0 until three kills (some may miss between columns), then two sure misses at x = 13.5.
  const run1 = { shots: 0, hits: 0, basic: 0, shotLog: [] };
  for (let attempt = 0; attempt < 20 && run1.hits < 3; attempt++) {
    const hit = await fireOnce();
    run1.shots++; if (hit) { run1.hits++; run1.basic++; }
    run1.shotLog.push({ from: 'x=0', hit });
  }
  check(run1.hits === 3, `expected 3 kills from x = 0, got ${run1.hits}`);
  await page.keyboard.down('ArrowRight'); await step(60); await page.keyboard.up('ArrowRight');
  for (let i = 0; i < 2; i++) {
    const hit = await fireOnce();
    run1.shots++; if (hit) { run1.hits++; run1.basic++; }
    run1.shotLog.push({ from: 'x=13.5', hit });
    check(!hit, 'a shot from the right edge should miss');
  }
  const beforeOver = await log('first-game-before-game-over', { counted: run1 });
  same(beforeOver.hud.score, String(run1.hits * 100).padStart(6, '0'), 'score matches the counted kills');
  check(!beforeOver.hud.gameOver, 'game over too early');
  run1.gameOverFrames = await toGameOver();
  check(run1.gameOverFrames > 0, 'first game did not reach game over');
  run1.expected = expectedText({ stage: 1, ...run1 });
  const over1 = await log('first-game-over', { expected: run1.expected });
  run1.shown = over1.stats;
  record.runs.push(run1);
  check(over1.hud.gameOver, 'first game-over screen not shown');
  same(over1.stats, run1.expected, 'first game-over statistics');
  same(over1.hud.finalScore, beforeOver.hud.score, 'final score');
  await shot('first-game-over', 'First game over (desktop 800x900): statistics match the counted shots, hits and kills');
  await checkLayout('first-game-over-desktop');

  // The screen stays unchanged after game over even with Space held.
  await page.keyboard.down('Space'); await step(30); await page.keyboard.up('Space');
  same(await stats(), run1.expected, 'statistics after game over with Space held');

  // Second game: restart, no shots, game over.
  await page.click('#restartButton');
  await step(30);
  const restarted = await log('restarted');
  check(!restarted.hud.gameOver && restarted.hud.lives === '♥♥♥' && restarted.hud.score === '000000' && restarted.hud.stage === '01',
    `after restart: ${JSON.stringify(restarted.hud)}`);
  await shot('restarted', 'Restarted: score 0, lives 3, stage 01');
  const run2 = { shots: 0, hits: 0, basic: 0 };
  run2.gameOverFrames = await toGameOver();
  check(run2.gameOverFrames > 0, 'second game did not reach game over');
  run2.expected = expectedText({ stage: 1, ...run2 });
  const over2 = await log('second-game-over', { expected: run2.expected });
  run2.shown = over2.stats;
  record.runs.push(run2);
  same(over2.stats, run2.expected, 'second game-over statistics (counted from zero, no shots)');
  check(over2.stats.accuracy === '0%', 'no shots must show 0%');
  await shot('second-game-over', 'Second game over without shots: kills 0, 0%, 0/0, stage 01');
  await checkLayout('second-game-over-desktop');

  await page.setViewportSize(NARROW);
  await step(2);
  await shot('second-game-over-narrow', 'Second game over on a narrow screen (390x844)');
  await checkLayout('second-game-over-narrow');
  same(await stats(), run2.expected, 'statistics after resize');
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
console.log(JSON.stringify({ passed: record.passed, failures, runs: record.runs.map(r => ({ expected: r.expected, shown: r.shown })),
  overlaps: record.layouts.map(l => [l.name, l.overlapsWithStats]), files: record.files }, null, 2));
process.exit(record.exitCode);
