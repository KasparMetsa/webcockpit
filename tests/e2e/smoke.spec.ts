import { test, expect } from '@playwright/test';

test('page loads and is cross-origin isolated', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveText('WebCockpit');
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
});
