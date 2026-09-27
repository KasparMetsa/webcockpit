// Stage 3 P3: the profile editor (lite + editor views) from the start page
// and the ESC menu, against a mocked MUME WebSocket.
import { type Page, type WebSocketRoute, expect, test } from '@playwright/test';

const IAC = 255;
const WILL = 251;
const GMCP = 201;

async function mockMume(page: Page): Promise<{ server: () => WebSocketRoute | null }> {
  let server: WebSocketRoute | null = null;
  await page.routeWebSocket('wss://mume.org/ws-play/', (ws) => {
    server = ws;
    ws.send(Buffer.concat([Buffer.from([IAC, WILL, GMCP]), Buffer.from('\r\nBy what name do you wish to be known? ')]));
  });
  return { server: () => server };
}

const ped = (page: Page) => page.locator('.wc-frame:not([hidden]) > .wc-ped');
const footer = (page: Page) => ped(page).locator('.wc-ped-footer');
const listRows = (page: Page) => ped(page).locator('.wc-ped-list .wc-tr');
const cursorRow = (page: Page) => ped(page).locator('.wc-ped-list .wc-tr.is-cur-focus, .wc-ped-list .wc-tr.is-cur');
const content = (page: Page) => ped(page).locator('.cm-content');
/** The buffer's text, line by line (the buffer is small, so every line is rendered). */
const bufferText = (page: Page) =>
  content(page).evaluate((el) => [...el.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n'));
const stored = (page: Page, name = 'default') =>
  page.evaluate((n) => window.__wc!.shell.profiles.get(n).then((r) => r?.text ?? null), name);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Start page → Profile → EDIT on `default`. */
async function openFromStart(page: Page, text?: string): Promise<void> {
  await mockMume(page);
  await page.goto('/');
  await expect(page.locator('.wc-start .wc-mrow.is-sel')).toHaveText('<< Enter MUME >>');
  if (text !== undefined) {
    await page.evaluate(async (t) => {
      await window.__wc!.shell.profiles.init();
      await window.__wc!.shell.profiles.save('default', t);
    }, text);
  }
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-title-row')).toHaveText('─── Profile ───');
  await page.locator('.wc-start [data-btn="EDIT"]').click();
  await expect(ped(page).locator('.wc-ped-title .wc-c-section')).toHaveText('─── Profile Editor: default ───');
  await expect(ped(page)).toHaveAttribute('data-mode', 'lite');
}

/** Selects a kind with the keyboard from the kind row and enters the list. */
async function kind(page: Page, name: string): Promise<void> {
  await ped(page).locator(`[data-kind="${name}"]`).first().click();
  await page.keyboard.press('ArrowDown');
  await expect(ped(page)).toHaveAttribute('data-zone', 'list');
}

async function toEditor(page: Page): Promise<void> {
  await ped(page).locator('[data-btn="EDITOR"]').click();
  await expect(ped(page)).toHaveAttribute('data-mode', 'editor');
  await expect(content(page)).toBeVisible();
}

test('lite → editor → lite → ESC saves; reload shows it', async ({ page }) => {
  const errors = watchErrors(page);
  await openFromStart(page, '#nop head\n\n#alias {b} {bee}\n#macro {F1} {one}\n');
  await kind(page, 'alias');
  await expect(listRows(page)).toHaveText([/^b\s+bee/, /\+ New entry/]);

  // n adds an entry and focuses Pattern; Tab goes to Commands.
  await page.keyboard.press('n');
  await expect(ped(page).locator('input[data-field="pattern"]')).toBeFocused();
  await page.keyboard.type('gv %1');
  await page.keyboard.press('Tab');
  await expect(ped(page).locator('textarea[data-field="body"]')).toBeFocused();
  await page.keyboard.type('get %1;');
  await page.keyboard.press('Enter');
  await page.keyboard.type('value %1');
  // New entries stay at the bottom of the list until a flip.
  await expect(listRows(page)).toHaveText([/^b\s+bee/, /^gv %1\s+get %1;…/, /\+ New entry/]);

  // Flip: the new alias sits after the last alias, the rest is untouched.
  await toEditor(page);
  await expect(content(page)).toContainText('#alias {gv %1} {    get %1;    value %1}');
  expect(await bufferText(page)).toBe(
    '#nop head\n\n#alias {b} {bee}\n#alias {gv %1} {\n    get %1;\n    value %1\n}\n#macro {F1} {one}\n',
  );
  await expect(footer(page)).toContainText('Ln 1, Col 1');

  // Edit the text: a new alias at the end, typed with auto-closed braces.
  await page.keyboard.press('Tab'); // toggle → buffer
  await expect(ped(page)).toHaveAttribute('data-zone', 'buffer');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('#alias {k');
  await page.keyboard.press('End');
  await page.keyboard.type(' {kill}');
  await expect(footer(page)).not.toContainText('unclosed');
  await page.keyboard.type(' {');
  await expect(footer(page)).not.toContainText('unclosed'); // auto-closed
  await page.keyboard.press('Backspace'); // removes the pair
  await page.keyboard.press('Backspace');
  await page.keyboard.type('{');
  await page.keyboard.press('Delete');
  await expect(footer(page)).toContainText('1 unclosed {');
  await page.keyboard.press('Backspace');
  await expect(footer(page)).not.toContainText('unclosed');
  await expect(footer(page)).toContainText('Ln 9, Col 18');

  // Back to lite: the list is re-read from the text.
  await ped(page).locator('[data-btn="LITE"]').click();
  await expect(ped(page)).toHaveAttribute('data-mode', 'lite');
  await kind(page, 'alias');
  await expect(listRows(page)).toHaveText([/^b\s+bee/, /^gv %1\s+get %1;…/, /^k\s+kill/, /\+ New entry/]);

  // ESC saves and flashes on the Profile frame.
  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-flash')).toHaveText('Saved default.');
  const saved = '#nop head\n\n#alias {b} {bee}\n#alias {gv %1} {\n    get %1;\n    value %1\n}\n#macro {F1} {one}\n#alias {k} {kill}';
  expect(await stored(page)).toBe(saved);
  await page.reload();
  await expect(page.locator('.wc-start .wc-mrow.is-sel')).toHaveText('<< Enter MUME >>');
  expect(await stored(page)).toBe(saved);
  expect(errors).toEqual([]);
});

test('a flip without edits keeps the text byte for byte', async ({ page }) => {
  const text = '#ACTION {x}\n{\n    say hi\n}\n\n#nop keep me\n#gag {spam}\n\n#lua {print(1)}\n#alias {a} {b} {7}\n';
  await openFromStart(page, text);
  await toEditor(page);
  await ped(page).locator('[data-btn="LITE"]').click();
  await toEditor(page);
  // The inert #lua is marked, with its hint on hover.
  await expect(ped(page).locator('.wc-syn-inert')).toHaveText('#lua');
  await expect(ped(page).locator('.wc-syn-inert')).toHaveAttribute('title', /do nothing in the browser/);
  await page.keyboard.press('Escape');
  // Nothing changed: pops without saving.
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-title-row')).toHaveText('─── Profile ───');
  expect(await stored(page)).toBe(text);
});

test('macro key capture: F5 binds, Ctrl+W is rejected, ESC cancels a new entry', async ({ page }) => {
  await openFromStart(page, '#macro {F1} {one}\n');
  await kind(page, 'macro');
  await page.keyboard.press('n');
  const overlay = ped(page).locator('.wc-ped-overlay');
  await expect(overlay).toContainText('Press the key to bind…');
  await page.keyboard.press('Control+w');
  await expect(overlay.locator('.wc-ped-capture-error')).toHaveText('The browser keeps that key.');
  await page.keyboard.press('a');
  await expect(overlay.locator('.wc-ped-capture-error')).toHaveText('That key types text; add Ctrl or Alt.');
  await page.keyboard.press('F5');
  await expect(overlay).toHaveCount(0);
  await expect(footer(page)).toHaveText('Bound to F5.');
  await expect(ped(page).locator('[data-field="key"]')).toHaveText('[ F5 ]');
  await expect(ped(page).locator('textarea[data-field="body"]')).toBeFocused();
  await page.keyboard.type('draw');
  await expect(listRows(page)).toHaveText([/^F1\s+one/, /^F5\s+draw/, /\+ New entry/]);

  // A key the input line uses warns in the hint area.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await expect(ped(page).locator('[data-field="key"]')).toHaveText('[ Ctrl+a ]');
  await expect(ped(page).locator('.wc-ped-warn').first()).toContainText('Ctrl+a overrides the input line');

  // + New entry, then ESC: the entry is gone again.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(listRows(page)).toHaveCount(3);

  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-flash')).toHaveText('Saved default.');
  expect(await stored(page)).toBe('#macro {F1} {one}\n#macro {Ctrl+A} {draw}\n');
});

test('highlight picker: styles, text and background swatches', async ({ page }) => {
  await openFromStart(page, '#highlight {bold one} {bold red}\n');
  await kind(page, 'highlight');
  // An unparseable body shows nothing selected and stays verbatim.
  await page.keyboard.press('Enter');
  await expect(ped(page).locator('.wc-ped-sw.is-on')).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-title-row')).toHaveText('─── Profile ───');

  await page.locator('.wc-start [data-btn="EDIT"]').click();
  await kind(page, 'highlight');
  await page.keyboard.press('n');
  await page.keyboard.type('^%1 enters');
  await page.keyboard.press('Tab'); // Style
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // reverse
  await page.keyboard.press('Tab'); // Text
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // green (dark)
  await page.keyboard.press('Tab'); // BG
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // bright red
  await expect(ped(page).locator('.wc-ped-sw.is-on')).toHaveCount(3);
  await expect(listRows(page).nth(1)).toContainText('reverse green b Red');
  // Clicking a selected swatch clears it.
  await ped(page).locator('[data-swatch="bg-0-1"]').click();
  await expect(listRows(page).nth(1)).toContainText('reverse green');
  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-start .wc-frame:not([hidden]) .wc-flash')).toHaveText('Saved default.');
  expect(await stored(page)).toBe('#highlight {bold one} {bold red}\n#highlight {^%1 enters} {reverse green}\n');
});

test('ESC menu → Profile while disconnected saves directly', async ({ page }) => {
  const errors = watchErrors(page);
  const mock = await mockMume(page);
  await page.goto('/');
  await expect(page.locator('.wc-start .wc-mrow.is-sel')).toHaveText('<< Enter MUME >>');
  await page.evaluate(async () => {
    await window.__wc!.shell.profiles.init();
    await window.__wc!.shell.profiles.save('default', '#alias {a} {b}\n');
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('.wc-app')).toHaveAttribute('data-status', /^login/);
  await mock.server()!.close();
  const menuSel = page.locator('.wc-overlay .wc-frame:not([hidden]) .wc-mrow.is-sel');
  await expect(menuSel).toHaveText('<< Reconnect >>');
  await page.locator('.wc-overlay .wc-mrow[data-key="profile"] .wc-label').click();
  await expect(ped(page).locator('.wc-ped-title .wc-c-section')).toHaveText('─── Profile Editor: default ───');
  await kind(page, 'alias');
  await page.keyboard.press('n');
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-overlay .wc-frame:not([hidden]) .wc-flash')).toHaveText('Saved default.');
  expect(await stored(page)).toBe('#alias {a} {b}\n#alias {x} {}\n');
  expect(errors).toEqual([]);
});

test('ESC menu → Profile while connected: Keep editing, Discard, Apply', async ({ page }) => {
  await mockMume(page);
  await page.goto('/');
  await expect(page.locator('.wc-start .wc-mrow.is-sel')).toHaveText('<< Enter MUME >>');
  await page.evaluate(async () => {
    await window.__wc!.shell.profiles.init();
    await window.__wc!.shell.profiles.save('default', '#alias {a} {b}\n');
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('.wc-app')).toHaveAttribute('data-status', /^login/);
  await page.keyboard.press('Escape');
  await page.locator('.wc-overlay .wc-mrow[data-key="profile"] .wc-label').click();
  await expect(ped(page)).toBeVisible();

  // Clean: ESC pops silently.
  await page.keyboard.press('Escape');
  await expect(page.locator('.wc-overlay .wc-frame:not([hidden]) .wc-mrow.is-sel')).toBeVisible();

  const modal = () => ped(page).locator('.wc-ped-overlay');
  await page.locator('.wc-overlay .wc-mrow[data-key="profile"] .wc-label').click();
  await kind(page, 'alias');
  await page.keyboard.press('n');
  await page.keyboard.type('y');
  await page.keyboard.press('Escape');
  await expect(modal()).toContainText('Apply changes to your profile?');
  await page.keyboard.press('Escape'); // keep editing
  await expect(modal()).toHaveCount(0);
  await expect(ped(page).locator('input[data-field="pattern"]')).toHaveValue('y');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n'); // discard
  await expect(page.locator('.wc-overlay .wc-frame:not([hidden]) .wc-mrow.is-sel')).toBeVisible();
  expect(await stored(page)).toBe('#alias {a} {b}\n');

  await page.locator('.wc-overlay .wc-mrow[data-key="profile"] .wc-label').click();
  await kind(page, 'alias');
  await page.keyboard.press('n');
  await page.keyboard.type('z');
  await page.keyboard.press('Escape');
  await page.keyboard.press('y');
  // Without a live apply on the app (P2 adds it) Apply saves.
  await expect(page.locator('.wc-overlay .wc-frame:not([hidden]) .wc-flash')).toHaveText(
    /^(Saved default\. It loads on the next connect\.|Profile updated\.)/,
  );
  expect(await stored(page)).toBe('#alias {a} {b}\n#alias {z} {}\n');
});

test('editor keys: line swap, undo, copy line, Tab and ↑ to the toggle', async ({ page }) => {
  await openFromStart(page, 'one\ntwo\nthree\n');
  await toEditor(page);
  await page.keyboard.press('Tab');
  await expect(ped(page)).toHaveAttribute('data-zone', 'buffer');
  await page.keyboard.press('ArrowDown');
  await expect(footer(page)).toContainText('Ln 2, Col 1');
  await page.keyboard.press('Alt+ArrowUp');
  expect(await bufferText(page)).toBe('two\none\nthree\n');
  await expect(footer(page)).toContainText('Ln 1, Col 1');
  await page.keyboard.press('Control+z');
  expect(await bufferText(page)).toBe('one\ntwo\nthree\n');
  await page.keyboard.type('x');
  expect(await bufferText(page)).toBe('one\nxtwo\nthree\n');
  await page.keyboard.press('Control+z');
  expect(await bufferText(page)).toBe('one\ntwo\nthree\n');
  await page.keyboard.press('Control+y');
  expect(await bufferText(page)).toBe('one\nxtwo\nthree\n');
  // Ctrl+C with no selection copies the line.
  await page.keyboard.press('Control+c');
  await expect(footer(page)).toContainText('Copied');
  await page.keyboard.press('Control+x');
  await expect(footer(page)).toContainText('Cut');
  expect(await bufferText(page)).toBe('one\nthree\n');
  // Tab never inserts a tab: it moves to the toggle, and back.
  await page.keyboard.press('Tab');
  await expect(ped(page)).toHaveAttribute('data-zone', 'toggle');
  await page.keyboard.press('Tab');
  await expect(ped(page)).toHaveAttribute('data-zone', 'buffer');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowUp');
  await expect(ped(page)).toHaveAttribute('data-zone', 'toggle');
  // ← on the toggle flips to LITE; the edited text is parsed back.
  await page.keyboard.press('ArrowLeft');
  await expect(ped(page)).toHaveAttribute('data-mode', 'lite');
  await page.keyboard.press('Escape');
  expect(await stored(page)).toBe('one\nthree\n');
});
