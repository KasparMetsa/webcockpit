// Browser smoke tests against replay mode (spec §4). Never open `/` without
// a parameter here: that connects to MUME live.
import { type Page, expect, test } from '@playwright/test';
import { smallestFixture } from './fixtures';

const fixture = smallestFixture();

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const rows = (page: Page) => page.locator('.wc-rows .wc-row');
const status = (page: Page) => page.locator('.wc-status');
const field = (page: Page) => page.locator('.wc-input-field');

async function replayDone(page: Page, speed = 0): Promise<void> {
  await page.goto(`/?fixture=${encodeURIComponent(fixture!.rel)}&speed=${speed}`);
  await expect(rows(page).filter({ hasText: '[SYSTEM] Replay finished.' })).toHaveCount(1);
}

test('offline page loads, is cross-origin isolated and does not connect', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?replay');
  await expect(page.locator('.wc-app')).toBeVisible();
  await expect(rows(page).first()).toHaveText(/Offline replay mode/);
  await expect(status(page)).toHaveText(/^\s*idle/);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  await expect(field(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('built-in commands print locally', async ({ page }) => {
  await page.goto('/?replay');
  await field(page).fill('#help');
  await page.keyboard.press('Enter');
  await expect(rows(page).filter({ hasText: '[SYSTEM] Built-in commands:' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: '#replay [speed]' })).toHaveCount(1);
  await field(page).fill('#blah');
  await page.keyboard.press('Enter');
  await expect(rows(page).last()).toHaveText('[SYSTEM] Unknown command: #blah');
});

test.describe('fixture replay', () => {
  test.skip(!fixture, 'no replay fixtures available');

  test('renders ANSI colours as spans and prompts', async ({ page }) => {
    const errors = watchErrors(page);
    await replayDone(page);
    expect(await rows(page).count()).toBeGreaterThan(10);
    expect(await page.locator('.wc-rows span[class*="wc-f"]').count()).toBeGreaterThan(0);
    expect(await page.locator('.wc-rows .wc-prompt').count()).toBeGreaterThan(0);
    // Colour comes from the DOS palette, not inherited default grey.
    const colour = await page
      .locator('.wc-rows span.wc-f2, .wc-rows span.wc-f3, .wc-rows span.wc-f6')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(colour).not.toBe('rgb(192, 192, 192)');
    expect(errors).toEqual([]);
  });

  test('status line reads replay while replaying', async ({ page }) => {
    await page.goto(`/?fixture=${encodeURIComponent(fixture!.rel)}&speed=1`);
    await expect(status(page)).toHaveText(/^\s*replay/);
    await expect(status(page)).toHaveText(/capture: idle/);
  });

  test('input: recall state and history', async ({ page }) => {
    await replayDone(page);
    const f = field(page);
    await page.keyboard.type('look');
    await page.keyboard.press('Enter');
    await expect(f).toHaveValue('look');
    const sel = await f.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);
    expect(sel).toEqual([0, 4]);
    // Typing replaces the recalled line.
    await page.keyboard.type('score');
    await expect(f).toHaveValue('score');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await expect(f).toHaveValue('look');
    await page.keyboard.press('ArrowDown');
    await expect(f).toHaveValue('score');
  });

  test('PageUp shows the live-tail bar and PageDown returns', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 300 });
    await replayDone(page);
    const bar = page.locator('.wc-tail-bar');
    await expect(bar).toBeHidden();
    await page.keyboard.press('PageUp');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('PgDn');
    for (let i = 0; i < 50 && (await bar.isVisible()); i++) await page.keyboard.press('PageDown');
    await expect(bar).toBeHidden();
    await page.keyboard.press('PageUp');
    await expect(bar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
  });
});
