// Browser benchmark for the spec §1.3 budgets that exist in stage 1.
//
//   node bench/browser-bench.ts        (part of `npm run bench`)
//
// Builds the app, serves it with `vite preview` (the production bundle),
// and drives it in Chromium and Firefox with Playwright through the
// `?bench` probe (src/app/bench-hook.ts):
//
// - key → send:     synthetic Enter keydown → Socketish.send (< 1 ms)
// - frame → paint:  fixture frames injected at random 20–80 ms intervals;
//                   rendered in the next animation frame
// - scrollback:     flush cost with 0 vs 20 000 rows present (no slowdown)
// - burst:          the biggest fixture replayed at max speed; no frame
//                   longer than 50 ms
//
// Writes bench/results/latest.md. Skips gracefully without fixtures.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return next(specifier + '.ts', context);
      }
      throw err;
    }
  },
});

const { biggestFixture, FIXTURES_ROOT } = await import('../tests/e2e/fixtures');
const { chromium, firefox } = await import('@playwright/test');
const { build, preview } = await import('vite');
type Browser = import('@playwright/test').Browser;
type Page = import('@playwright/test').Page;

const FRAME_BUDGET_MS = 50;
const KEY_BUDGET_MS = 1;

const fixture = biggestFixture();
if (!fixture) {
  console.log(`browser-bench: no .log under ${FIXTURES_ROOT}, skipped`);
  process.exit(0);
}
const logText = readFileSync(fixture.path, 'utf8');

// ------------------------------------------------------------------ stats

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const median = (xs: number[]) => pct(xs, 50);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : '—');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ pages

async function openBench(browser: Browser, base: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(`${base}/?bench`);
  await page.waitForFunction(() => window.__wcBench?.app !== null && window.__wcBench !== undefined);
  // Let the page render its first frames before measuring: Chromium's first
  // frame after load takes ~100+ ms and is not part of any budget.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await pause(300);
  return page;
}

/** rAF delta monitor plus Long Animation Frame / long task observers. */
async function startMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mon = { deltas: [] as number[], loaf: [] as number[], longtask: [] as number[], run: true, loafSupported: false, ltSupported: false };
    (window as unknown as { __mon: typeof mon }).__mon = mon;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      mon.deltas.push(now - last);
      last = now;
      if (mon.run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const types = PerformanceObserver.supportedEntryTypes ?? [];
    if (types.includes('long-animation-frame')) {
      mon.loafSupported = true;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) mon.loaf.push(e.duration);
      }).observe({ type: 'long-animation-frame' });
    }
    if (types.includes('longtask')) {
      mon.ltSupported = true;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) mon.longtask.push(e.duration);
      }).observe({ type: 'longtask' });
    }
  });
}

interface MonitorResult {
  deltas: number[];
  loaf: number[];
  longtask: number[];
  loafSupported: boolean;
  ltSupported: boolean;
}

async function stopMonitor(page: Page): Promise<MonitorResult> {
  return page.evaluate(() => {
    const mon = (window as unknown as { __mon: MonitorResult & { run: boolean } }).__mon;
    mon.run = false;
    return { deltas: mon.deltas, loaf: mon.loaf, longtask: mon.longtask, loafSupported: mon.loafSupported, ltSupported: mon.ltSupported };
  });
}

// -------------------------------------------------------------- scenarios

async function benchKey(browser: Browser, base: string) {
  const page = await openBench(browser, base);
  await page.evaluate(() => window.__wcBench!.connectFake());
  const times: number[] = [];
  for (let i = 0; i < 220; i++) {
    const ms = await page.evaluate(() => window.__wcBench!.keyToSend('look'));
    if (i >= 20) times.push(ms); // first 20 warm the JIT
    if (i % 10 === 0) await pause(5);
  }
  await page.close();
  return {
    median: median(times),
    p95: pct(times, 95),
    p99: pct(times, 99),
    max: max(times),
    n: times.length,
    failedSends: times.filter((t) => t < 0).length,
  };
}

async function benchFramePaint(browser: Browser, base: string) {
  const page = await openBench(browser, base);
  await page.evaluate(() => window.__wcBench!.connectFake());
  const WARM = 10;
  const total = await page.evaluate((t) => window.__wcBench!.loadFrames(t, 1, 400 + 10), logText);
  // Warm-up: the first frames after page load pay for JIT and first layout.
  for (let i = 0; i < WARM; i++) {
    await page.evaluate((k) => window.__wcBench!.inject(k), i);
    await pause(30);
  }
  const n = total - WARM;
  await startMonitor(page);
  const toFlush: number[] = [];
  const toPaint: number[] = [];
  const script: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((k) => window.__wcBench!.inject(k), WARM + i);
    toFlush.push(r.toFlush);
    toPaint.push(r.toPaint);
    script.push(r.script);
    await pause(20 + Math.random() * 60);
  }
  const mon = await stopMonitor(page);
  await page.close();
  const interval = median(mon.deltas);
  // Flush start relative to receipt: must fall within one frame interval.
  const waits = toFlush.map((t, i) => t - script[i]!);
  const lateIdx = waits.flatMap((w, i) => (w > interval * 1.5 ? [i] : []));
  const late = lateIdx.length;
  // A late frame our own flush caused (script longer than a frame interval).
  const lateOurs = lateIdx.filter((i) => script[i]! > interval).length;
  if (late) console.log(`  late frames: ${lateIdx.map((i) => `#${i} wait ${f1(waits[i]!)} ms script ${f1(script[i]!)} ms`).join(', ')}`);
  return {
    frames: n,
    interval,
    toPaintMedian: median(toPaint),
    toPaintP95: pct(toPaint, 95),
    toPaintMax: max(toPaint),
    scriptMedian: median(script),
    scriptMax: max(script),
    late,
    lateOurs,
  };
}

function synthBatch(lines: number, seed: number): string {
  let s = '';
  for (let i = 0; i < lines; i++) {
    const k = seed * lines + i;
    if (i % 10 === 0) s += `\x1b[32mA Room Called Number ${k}\x1b[0m\r\n`;
    else if (i % 7 === 0) s += `\x1b[33mSomeone narrates 'message ${k} with a bit of text to wrap the line'\x1b[0m\r\n`;
    else s += `A line of plain description text, number ${k}, about seventy characters.\r\n`;
  }
  return s;
}

async function benchScrollback(browser: Browser, base: string) {
  const page = await openBench(browser, base);
  await page.evaluate(() => window.__wcBench!.connectFake());
  const measure = async (seed0: number) => {
    const script: number[] = [];
    const frame: number[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await page.evaluate((t) => window.__wcBench!.inject(t), synthBatch(50, seed0 + i));
      script.push(r.script);
      frame.push(r.toPaint - (r.toFlush - r.script));
      await pause(10);
    }
    return { script, frame };
  };
  const empty = await measure(0);
  const rowsEmptyEnd = await page.evaluate(() => window.__wcBench!.rows);
  // Fill to the 20 000-row cap (and past it, so trimming is in steady state).
  for (let i = 0; i < 22; i++) {
    await page.evaluate((t) => window.__wcBench!.inject(t), synthBatch(1000, 1000 + i));
  }
  await page.evaluate(() => window.__wcBench!.drained());
  const rowsFull = await page.evaluate(() => window.__wcBench!.rows);
  const full = await measure(5000);
  await page.close();
  return {
    rowsEmptyEnd,
    rowsFull,
    emptyScript: median(empty.script),
    emptyFrame: median(empty.frame),
    emptyFrameP95: pct(empty.frame, 95),
    fullScript: median(full.script),
    fullFrame: median(full.frame),
    fullFrameP95: pct(full.frame, 95),
  };
}

async function benchBurst(browser: Browser, base: string) {
  const page = await openBench(browser, base);
  // Hand the 4.7 MB text over first: deserialising the argument blocks the
  // page for ~100 ms, which is the harness, not the app.
  await page.evaluate((t) => {
    (window as unknown as { __benchText: string }).__benchText = t;
  }, logText);
  await pause(300);
  await startMonitor(page);
  const r = await page.evaluate(() =>
    window.__wcBench!.replay((window as unknown as { __benchText: string }).__benchText, 0),
  );
  const mon = await stopMonitor(page);
  const rows = await page.evaluate(() => window.__wcBench!.rows);
  await page.close();
  return {
    ms: r.ms,
    lines: r.lines,
    rows,
    linesPerSec: r.lines / (r.ms / 1000),
    mbPerSec: fixture!.size / 1e6 / (r.ms / 1000),
    maxDelta: max(mon.deltas),
    p95Delta: pct(mon.deltas, 95),
    over50: mon.deltas.filter((d) => d > FRAME_BUDGET_MS).length,
    frames: mon.deltas.length,
    loafMax: mon.loafSupported ? max(mon.loaf) : NaN,
    loafSupported: mon.loafSupported,
    longtaskMax: mon.ltSupported ? (mon.longtask.length ? max(mon.longtask) : 0) : NaN,
    ltSupported: mon.ltSupported,
  };
}

// ------------------------------------------------------------------- main

console.log('browser-bench: building…');
await build({ logLevel: 'warn' });
const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const base = (server.resolvedUrls?.local[0] ?? 'http://localhost:4179/').replace(/\/$/, '');
console.log(`browser-bench: ${base}, fixture ${fixture.rel} (${(fixture.size / 1e6).toFixed(2)} MB)`);

type Row = { browser: string; version: string } & {
  key: Awaited<ReturnType<typeof benchKey>>;
  paint: Awaited<ReturnType<typeof benchFramePaint>>;
  scroll: Awaited<ReturnType<typeof benchScrollback>>;
  burst: Awaited<ReturnType<typeof benchBurst>>;
};
const results: Row[] = [];

try {
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ] as const) {
    const browser = await type.launch();
    try {
      console.log(`\n[${name} ${browser.version()}]`);
      const key = await benchKey(browser, base);
      console.log(`  key → send: median ${f3(key.median)} ms, p99 ${f3(key.p99)}, max ${f3(key.max)}`);
      const paint = await benchFramePaint(browser, base);
      console.log(
        `  frame → paint: ${paint.frames} frames, painted median ${f1(paint.toPaintMedian)} ms, p95 ${f1(paint.toPaintP95)}, max ${f1(paint.toPaintMax)}; late ${paint.late}`,
      );
      const scroll = await benchScrollback(browser, base);
      console.log(
        `  scrollback: frame median ${f2(scroll.emptyFrame)} ms at ~0 rows vs ${f2(scroll.fullFrame)} ms at ${scroll.rowsFull} rows`,
      );
      const burst = await benchBurst(browser, base);
      console.log(
        `  burst: ${burst.lines} lines in ${f1(burst.ms)} ms (${burst.linesPerSec.toFixed(0)} lines/s), max frame ${f1(burst.maxDelta)} ms, >50 ms: ${burst.over50}, LoAF max ${f1(burst.loafMax)}`,
      );
      results.push({ browser: name, version: browser.version(), key, paint, scroll, burst });
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}

// ----------------------------------------------------------------- report

const pass = (ok: boolean) => (ok ? '**PASS**' : '**FAIL**');
const lines: string[] = [];
const now = new Date();
lines.push('# Benchmark results (stage 1)', '');
lines.push(`Generated by \`npm run bench\` on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '');
lines.push('## Machine', '');
lines.push(`- CPU: ${os.cpus()[0]?.model ?? '?'} (${os.cpus().length} threads)`);
lines.push(`- Memory: ${(os.totalmem() / 2 ** 30).toFixed(0)} GiB`);
lines.push(`- OS: ${os.type()} ${os.release()} ${os.arch()}`);
lines.push(`- Node: ${process.version}`);
for (const r of results) lines.push(`- ${r.browser}: ${r.version} (headless, Playwright)`);
lines.push(`- Build: production bundle via \`vite preview\``);
lines.push(`- Fixture: \`${fixture.rel}\` (${(fixture.size / 1e6).toFixed(2)} MB)`, '');

lines.push('## Budgets (spec §1.3)', '');
lines.push('| Budget | Measure | ' + results.map((r) => r.browser).join(' | ') + ' |');
lines.push('|---|---|' + results.map(() => '---|').join(''));
const row = (budget: string, measure: string, cell: (r: Row) => string) =>
  lines.push(`| ${budget} | ${measure} | ${results.map(cell).join(' | ')} |`);
row('Key → send < 1 ms', 'Enter keydown → `send()`, median / p99 / max (ms); pass on p99', (r) =>
  `${f3(r.key.median)} / ${f3(r.key.p99)} / ${f3(r.key.max)} ${pass(r.key.p99 < KEY_BUDGET_MS && r.key.failedSends === 0)}`,
);
row('Frame → paint: next frame', 'frames that missed the next frame (of them caused by our flush)', (r) =>
  `${r.paint.late} of ${r.paint.frames} (${r.paint.lateOurs}) ${pass(r.paint.late <= r.paint.frames / 100 && r.paint.lateOurs === 0)}`,
);
row('', 'receipt → painted, median / p95 / max (ms)', (r) =>
  `${f1(r.paint.toPaintMedian)} / ${f1(r.paint.toPaintP95)} / ${f1(r.paint.toPaintMax)}`,
);
row('', 'flush script time, median / max (ms); frame interval (ms)', (r) =>
  `${f2(r.paint.scriptMedian)} / ${f2(r.paint.scriptMax)}; ${f1(r.paint.interval)}`,
);
const scrollOk = (r: Row) => r.scroll.fullFrame <= r.scroll.emptyFrame * 1.5 + 0.5;
row('Scrollback 20 000: no slowdown', '50-line flush, frame time median (p95) at ~0 rows → at full (ms)', (r) =>
  `${f2(r.scroll.emptyFrame)} (${f2(r.scroll.emptyFrameP95)}) → ${f2(r.scroll.fullFrame)} (${f2(r.scroll.fullFrameP95)}) ${pass(scrollOk(r))}`,
);
row('', 'flush script time median at ~0 → at full (ms); rows at full', (r) =>
  `${f2(r.scroll.emptyScript)} → ${f2(r.scroll.fullScript)}; ${r.scroll.rowsFull}`,
);
row('Burst: no frame > 50 ms', 'longest rAF gap (ms); gaps > 50 ms', (r) =>
  `${f1(r.burst.maxDelta)}; ${r.burst.over50} of ${r.burst.frames} ${pass(r.burst.over50 === 0)}`,
);
row('', 'longest LoAF / long task (ms)', (r) =>
  `${r.burst.loafSupported ? (Number.isFinite(r.burst.loafMax) ? f1(r.burst.loafMax) : 'none') : 'n/a'} / ${r.burst.ltSupported ? (r.burst.longtaskMax > 0 ? f1(r.burst.longtaskMax) : 'none') : 'n/a'}`,
);
row('', 'drain: lines, total ms, lines/s, MB/s', (r) =>
  `${r.burst.lines}, ${f1(r.burst.ms)}, ${r.burst.linesPerSec.toFixed(0)}, ${f1(r.burst.mbPerSec)}`,
);
lines.push('');
lines.push('## Method', '');
lines.push(
  '- **Key → send:** `?bench` probe sets the input to `look`, dispatches a synthetic Enter `keydown` on it and reads the time `Socketish.send` was called on a fake socket. 200 samples after 20 warm-up runs. Pass is judged on p99, so a single GC pause does not decide it; the max is reported.',
  '- **Frame → paint:** 400 telnet frames of the fixture (as the replay socket groups them at speed 1), after 10 warm-up frames, are fed through the fake socket at random 20–80 ms intervals. "Painted" is a MessageChannel message posted from the output pane\'s frame callback, which runs after that frame\'s rendering. A frame is late when its flush started more than 1.5 frame intervals after receipt, i.e. it missed the next frame (vsync jitter of a few ms is not a missed frame). Pass: at most 1 % of frames late and none because our flush script ran longer than a frame; a headless browser occasionally skips a frame on its own (GC, compositor), and the count is reported as measured.',
  '- **Scrollback:** 40 flushes of 50 synthetic lines (some coloured) on an empty pane, then 22 000 more lines, then 40 more flushes with the pane at its 20 000-row cap (a 200-row chunk is dropped from the top every fourth flush). Frame time = frame callback start → after rendering. Pass: median at full ≤ 1.5 × median at empty + 0.5 ms.',
  '- **Burst:** the whole fixture replayed at speed 0 (16 KB frames, delivered in slices of at most 8 ms, then the replay waits for the next animation frame) through the real Session, telnet parser, line assembler and output pane. rAF gaps are measured for the whole replay until the output has drained; Chromium also reports Long Animation Frames.',
  '',
);
lines.push('## Fixes made because of this benchmark (stage 1)', '');
lines.push(
  '- **Scrollback slowdown (Chromium).** With 20 000 flat rows trimmed row by row on every flush, a 50-line flush took 3.8 ms per frame on an empty pane and 21.3 ms at 20 000 rows (Firefox: 4.3 → 9.8 ms). Rows now live in contained chunks of 200 rows (at full: ~5 ms, still trimmed row by row), and old rows are dropped a whole chunk at a time (at full: within noise of an empty pane). The pane keeps at least 20 000 rows and fewer than 20 000 + one chunk.',
  '- **Burst replay scheduling.** The replay socket delivered 16 KB frames as an unbroken chain of message tasks at speed 0. It now delivers for at most 8 ms and waits for the next animation frame: Firefox\'s longest frame went from ~35 ms to ~20 ms; Chromium stayed at ~19 ms.',
  '- **Harness artefacts found on the way (not app changes):** Chromium\'s first frame after load (~120 ms) and handing a 4.7 MB string to the page (~120 ms) showed up as long frames until the benchmark waited for the first frames and transferred the text before measuring.',
  '',
);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/latest.md', import.meta.url), lines.join('\n'));
console.log('\nbrowser-bench: wrote bench/results/latest.md');
