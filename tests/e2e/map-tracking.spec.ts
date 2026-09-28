// Stage 9 P2 (ADR 0020): with the Map pane on and its map loaded, replaying
// tests/fixtures/map-demo.log (a walk through Bree on arda.mm2) moves the
// worker's player to the walk's last room, located.
import { expect, test } from '@playwright/test';

test('map tracking follows the map-demo walk to Hill Road', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto('/?replay');
  await expect(page.locator('.wc-cockpit')).toBeVisible();
  await page.evaluate(() => window.__wc!.settings.update({ panes: { map: { on: true } } }));
  const content = page.locator('.wc-pane-map .wc-pane-content');
  await expect(content).toHaveAttribute('data-map-state', 'loaded', { timeout: 20_000 });
  // Forwarding starts once the map is loaded; replay the walk at full speed.
  await page.evaluate(async () => {
    const text = await (await fetch('/__fixtures/map-demo.log')).text();
    window.__wc!.app.startReplay(text, 'map-demo.log', 0);
  });
  await expect(content).toHaveAttribute('data-map-room', '26971', { timeout: 15_000 });
  await expect(content).toHaveAttribute('data-map-located', '1');
  await expect(page.locator('.wc-game')).toContainText('Hill Road');
  // The worker saved the ids it learned (IndexedDB `mapIds`).
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const r = indexedDB.open('webcockpit');
            r.onsuccess = () => {
              const c = r.result.transaction('mapIds').objectStore('mapIds').count();
              c.onsuccess = () => {
                resolve(c.result);
                r.result.close();
              };
            };
            r.onerror = () => resolve(-1);
          }),
      ),
    )
    .toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
