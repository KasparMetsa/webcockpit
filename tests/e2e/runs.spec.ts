// Stage 6 P0: run events and the run library in the browser. The kill fold
// announces in the UI pane during a replay; the demo backup restores into
// IndexedDB through the dev hook (`__wc.runs()`), and the storage survives a
// reload with the sweep at start (the demo's saved chain is kept).
import { type Page, expect, test } from '@playwright/test';

interface Lib {
  restore(b: Blob): Promise<{ added: number; skipped: number }>;
  listSessions(now: number): Promise<Array<{ character: string; runs: unknown[]; saved: boolean; rating: number }>>;
}

async function restoreDemo(page: Page): Promise<{ added: number; skipped: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as { __wc: { runs(): Promise<Lib> } };
    const lib = await w.__wc.runs();
    const res = await fetch('/__fixtures/runs-demo.jsonl.gz');
    return lib.restore(await res.blob());
  });
}

async function sessions(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as { __wc: { runs(): Promise<Lib> } };
    const lib = await w.__wc.runs();
    const s = await lib.listSessions(new Date(2026, 8, 28).getTime() * 1000);
    return s.map((x) => [x.character, x.runs.length, x.saved, x.rating]);
  });
}

test('a replayed kill is announced in the UI pane', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?fixture=gmcp-demo.log&speed=0');
  await expect(page.locator('.wc-rows .wc-row').filter({ hasText: '[SYSTEM] Replay finished.' })).toHaveCount(1);
  await expect(page.locator('.wc-pane[data-pane="ui"]')).toContainText('KILL: An orc scout, 90k xp.');
  const events = await page.evaluate(() => {
    const w = window as unknown as { __wc: { app: { runEvents: { events: Array<{ type: string }> } } } };
    return w.__wc.app.runEvents.events.map((e) => e.type);
  });
  expect(events).toContain('kill');
  expect(events).toContain('achievement');
  expect(errors).toEqual([]);
});

test('the demo backup restores, and a second restore skips every run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __wc?: unknown }).__wc !== undefined);
  expect(await restoreDemo(page)).toEqual({ added: 4, skipped: 0 });
  expect(await sessions(page)).toEqual([
    ['Gittan', 1, false, 0],
    ['Rasta', 2, true, 4],
    ['Gittan', 1, false, 0],
  ]);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __wc?: unknown }).__wc !== undefined);
  expect(await restoreDemo(page)).toEqual({ added: 0, skipped: 4 });
  // The saved chain survives the start-up sweep whatever today's date is.
  expect((await sessions(page)).some((s) => s[0] === 'Rasta' && s[2] === true)).toBe(true);
  expect(errors).toEqual([]);
});
