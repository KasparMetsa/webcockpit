// Stage 2 package B: docking layout, pane frames, drag, resize, toggles,
// narrow collapse and the too-small screen. Uses the dev-only `window.__wc`.
import { type Page, expect, test } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function open(page: Page, width = 1280, height = 900): Promise<{ cw: number; ch: number; cols: number; rows: number }> {
  await page.setViewportSize({ width, height });
  await page.goto('/?replay');
  await expect(page.locator('.wc-cockpit')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return metrics(page);
}

async function metrics(page: Page): Promise<{ cw: number; ch: number; cols: number; rows: number }> {
  // Wait for the layout that follows the font load.
  await page.waitForFunction(() => {
    const s = getComputedStyle(document.documentElement);
    const cw = parseFloat(s.getPropertyValue('--cell-w'));
    const el = document.querySelector<HTMLElement>('.wc-cockpit')!;
    return el.dataset.cells === `${Math.floor(el.clientWidth / cw + 1e-6)}x${Math.floor(el.clientHeight / parseFloat(s.getPropertyValue('--cell-h')) + 1e-6)}`;
  });
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const [cols, rows] = document.querySelector<HTMLElement>('.wc-cockpit')!.dataset.cells!.split('x').map(Number);
    return { cw: parseFloat(s.getPropertyValue('--cell-w')), ch: parseFloat(s.getPropertyValue('--cell-h')), cols: cols!, rows: rows! };
  });
}

/** Box of `sel` relative to the cockpit. */
async function box(page: Page, sel: string): Promise<Box> {
  return page.evaluate((s) => {
    const c = document.querySelector('.wc-cockpit')!.getBoundingClientRect();
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, width: r.width, height: r.height };
  }, sel);
}

async function origin(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('.wc-cockpit')!.getBoundingClientRect();
    return { x: c.left, y: c.top };
  });
}

const ORDER = ['character', 'timers', 'group', 'comm', 'ui'];

test('default layout: game left, right column 33 cells in Cockpit order, input at the bottom', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { cw, ch, cols, rows } = await open(page);
  const game = await box(page, '.wc-game');
  expect(game).toEqual({ x: 0, y: 0, width: (cols - 34) * cw, height: (rows - 1) * ch });
  const input = await box(page, '.wc-input-slot');
  expect(input).toEqual({ x: 0, y: (rows - 1) * ch, width: cols * cw, height: ch });

  let y = 0;
  const heights: number[] = [];
  for (const id of ORDER) {
    const b = await box(page, `.wc-pane-${id}`);
    expect(b.x).toBe((cols - 33) * cw);
    expect(b.width).toBe(33 * cw);
    expect(b.y).toBe(y);
    heights.push(Math.round(b.height / ch) - 2);
    y += b.height;
  }
  expect(y).toBe((rows - 1) * ch);
  // Desired 9/8/6/10/5 content rows; the leftover goes to the UI pane.
  expect(heights.slice(0, 4)).toEqual([9, 8, 6, 10]);
  expect(heights[4]).toBe(rows - 1 - 48 + 5);

  const frame = await page.locator('.wc-pane-character .wc-pane-frame').textContent();
  const lines = frame!.split('\n');
  expect(lines[0]).toBe('▛▀▀ Character ' + '▀'.repeat(33 - 2 - 13) + '▜');
  expect(lines[1]).toBe('▌' + ' '.repeat(31) + '▐');
  expect(lines.at(-1)).toBe('▙' + '▄'.repeat(31) + '▟');
  expect(lines.length).toBe(11);
  // Frame glyphs in the pane's border colour over its fill.
  const colors = await page.locator('.wc-pane-timers').evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    fg: getComputedStyle(el.querySelector('.wc-pane-frame')!).color,
  }));
  expect(colors).toEqual({ bg: 'rgb(26, 14, 14)', fg: 'rgb(46, 34, 34)' });
  await expect(page.locator('.wc-input-field')).toBeFocused();
  expect(errors).toEqual([]);
});

test('toggles, colours and borders apply live; corners are always quadrant', async ({ page }) => {
  const { ch } = await open(page);
  const set = (patch: object) => page.evaluate((p) => window.__wc!.settings.update(p), patch);
  await set({ panes: { group: { on: false } } });
  await expect(page.locator('.wc-pane-group')).toBeHidden();
  expect((await box(page, '.wc-pane-comm')).y).toBe((11 + 10) * ch);
  await set({ panes: { group: { on: true, color: 'purple', border: false } } });
  await expect(page.locator('.wc-pane-group')).toBeVisible();
  await expect(page.locator('.wc-pane-group .wc-pane-frame')).toHaveText('');
  expect((await box(page, '.wc-pane-group')).height).toBe(6 * ch);
  expect(await page.locator('.wc-pane-group').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(22, 16, 28)');
  expect((await page.locator('.wc-pane-ui .wc-pane-frame').textContent())!.startsWith('▛▀▀ UI ▀')).toBe(true);
});

test('drag a pane by its title row to the left dock', async ({ page }) => {
  const { cw, ch, cols } = await open(page);
  const o = await origin(page);
  const comm = await box(page, '.wc-pane-comm');
  await page.mouse.move(o.x + comm.x + 6 * cw, o.y + comm.y + ch / 2);
  await page.mouse.down();
  await page.mouse.move(o.x + 300, o.y + 300, { steps: 5 });
  await expect(page.locator('.wc-drop-bar')).toBeHidden(); // over the game pane: no target
  await page.mouse.move(o.x + cw / 2, o.y + 300, { steps: 5 });
  await expect(page.locator('.wc-drop-bar')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.wc-drop-bar')).toBeHidden();

  await expect.poll(() => box(page, '.wc-pane-comm')).toMatchObject({ x: 0, y: 0, width: 33 * cw });
  expect(await box(page, '.wc-game')).toMatchObject({ x: 34 * cw, width: (cols - 68) * cw });
  const left = await page.evaluate(() => window.__wc!.settings.get().layout.docks.left.panes.map((p) => p.id));
  expect(left).toEqual(['comm']);
  await expect(page.locator('.wc-input-field')).toBeFocused();

  // Reorder within the right dock: UI above Character.
  const ui = await box(page, '.wc-pane-ui');
  await page.mouse.move(o.x + ui.x + 6 * cw, o.y + ui.y + ch / 2);
  await page.mouse.down();
  await page.mouse.move(o.x + ui.x + 6 * cw, o.y + 2 * ch, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.__wc!.settings.get().layout.docks.right.panes.map((p) => p.id)))
    .toEqual(['ui', 'character', 'timers', 'group']);
});

test('dock and pane resize persist across a reload', async ({ page }) => {
  const { cw, ch, cols } = await open(page);
  const o = await origin(page);
  // The gap column between the game pane and the right dock.
  const gapX = o.x + (cols - 34) * cw + cw / 2;
  await page.mouse.move(gapX, o.y + 200);
  expect(await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor, [gapX, o.y + 200])).toBe('col-resize');
  await page.mouse.down();
  await page.mouse.move(gapX - 5 * cw, o.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => box(page, '.wc-pane-character')).toMatchObject({ width: 38 * cw });

  // The boundary between Character and Timers (bottom of Character's frame).
  const by = o.y + 11 * ch - 2;
  await page.mouse.move(o.x + (cols - 20) * cw, by);
  await page.mouse.down();
  await page.mouse.move(o.x + (cols - 20) * cw, by + 2 * ch, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => box(page, '.wc-pane-character')).toMatchObject({ height: 13 * ch });
  await expect(page.locator('.wc-input-field')).toBeFocused();

  await page.evaluate(() => window.__wc!.settings.flush());
  await page.reload();
  await expect(page.locator('.wc-cockpit')).toBeVisible();
  await metrics(page);
  await expect.poll(() => box(page, '.wc-pane-character')).toMatchObject({ width: 38 * cw, height: 13 * ch });
  expect((await box(page, '.wc-pane-timers')).height).toBe(8 * ch);
});

test('too-small window shows a notice and recovers', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 400, height: 250 });
  await expect(page.locator('.wc-too-small')).toBeVisible();
  await expect(page.locator('.wc-too-small')).toContainText('Window too small');
  await expect(page.locator('.wc-input-slot')).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.wc-too-small')).toBeHidden();
  await expect(page.locator('.wc-input-field')).toBeFocused();
});

test('narrow window collapses the side dock and restores it when widened', async ({ page }) => {
  const { cw } = await open(page);
  // 62 columns: 62 − 34 < 30.
  await page.setViewportSize({ width: Math.ceil(62.5 * cw), height: 900 });
  await expect(page.locator('.wc-cockpit')).toHaveAttribute('data-collapsed', 'right');
  for (const id of ORDER) await expect(page.locator(`.wc-pane-${id}`)).toBeHidden();
  const { cols } = await metrics(page);
  expect((await box(page, '.wc-game')).width).toBe(cols * cw);
  expect(await page.evaluate(() => Object.values(window.__wc!.settings.get().panes).every((p) => p.on))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.wc-cockpit')).toHaveAttribute('data-collapsed', '');
  for (const id of ORDER) await expect(page.locator(`.wc-pane-${id}`)).toBeVisible();
});
