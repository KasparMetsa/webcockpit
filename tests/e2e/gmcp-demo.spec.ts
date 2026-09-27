// The offline GMCP demo (tests/fixtures/gmcp-demo.log, ADR 0016): served
// from the repository by the dev server's fixture route, it replays
// recorded GMCP, so the session reaches `playing` and the side panes are
// active; when the replay ends they blank again (the UI pane stays).
import { type Page, expect, test } from '@playwright/test';

const DEMO = '/?fixture=gmcp-demo.log';

const rows = (page: Page) => page.locator('.wc-rows .wc-row');
const pane = (page: Page, id: string) => page.locator(`.wc-pane[data-pane="${id}"]`);
const PANES = ['character', 'timers', 'group', 'comm', 'ui'];

test('the demo reaches playing and activates the panes, without capture', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${DEMO}&speed=1`);
  await expect(rows(page).filter({ hasText: '[SYSTEM] Rasta logged in.' })).toHaveCount(1);
  await expect(page.locator('.wc-app')).toHaveAttribute('data-status', /^replay · Rasta/);
  for (const id of PANES) {
    await expect(pane(page, id)).toBeVisible();
    await expect(pane(page, id)).toHaveAttribute('data-active', '');
  }
  await expect(rows(page).filter({ hasText: 'The Last Bridge' })).toHaveCount(1);
  // GMCP records never show as text.
  await expect(rows(page).filter({ hasText: /GMCP [A-Z]/ })).toHaveCount(0);
  await expect(page.locator('.wc-app')).toHaveAttribute('data-status', /capture: idle/);
  expect(errors).toEqual([]);
});

test('after the demo the panes are inactive again', async ({ page }) => {
  await page.goto(`${DEMO}&speed=0`);
  await expect(rows(page).filter({ hasText: '[SYSTEM] Replay finished.' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'You rise a level!' })).toHaveCount(1);
  for (const id of PANES) await expect(pane(page, id)).not.toHaveAttribute('data-active', '');
  const recorded = await page.evaluate(async () => {
    const store = await window.__wc!.app.recorder.getStore();
    return store ? (await store.listRuns()).length : -1;
  });
  expect(recorded).toBe(0);
});
