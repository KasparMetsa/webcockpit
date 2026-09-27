// The script engine in the browser (stage 3, ADR 0015): aliases and macros
// against a mocked MUME WebSocket, and highlights/gags/#showme in replay
// mode. Nothing reaches the real server.
import { type Page, expect, test } from '@playwright/test';

const IAC = 255;
const WILL = 251;
const GMCP = 201;

const rows = (page: Page) => page.locator('.wc-rows .wc-row');

test('the default profile macros and a typed alias send to the game', async ({ page }) => {
  const received: Buffer[] = [];
  await page.routeWebSocket('wss://mume.org/ws-play/', (ws) => {
    ws.onMessage((m) => received.push(typeof m === 'string' ? Buffer.from(m) : m));
    ws.send(Buffer.from([IAC, WILL, GMCP]));
  });
  const sentText = () => Buffer.concat(received).toString('utf8');
  await page.goto('/');
  await expect(page.locator('.wc-start .wc-mrow.is-sel')).toHaveText('<< Enter MUME >>');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wc-app')).toHaveAttribute('data-status', /^login/);
  await expect(rows(page).filter({ hasText: '[SYSTEM] Profile default loaded.' })).toHaveCount(1);

  // The template binds the numpad: Numpad8 → north (with or without NumLock).
  await page.keyboard.press('Numpad8');
  await expect.poll(sentText).toContain('north\r\n');
  await expect(page.locator('.wc-input-field')).toHaveValue('');

  // A runtime alias with a variable and ; splitting; the sends are echoed.
  await page.keyboard.type('#var t orc;#alias {kk} {_send kill %1.$t;#showme {<Fff0000>Target: %1}}');
  await page.keyboard.press('Enter');
  await page.keyboard.type('kk big');
  await page.keyboard.press('Enter');
  await expect.poll(sentText).toContain('kill big.orc\r\n');
  await expect(rows(page).filter({ hasText: /^kill big.orc$/ })).toHaveCount(1);
  const shown = rows(page).filter({ hasText: /^Target: big$/ });
  await expect(shown).toHaveCount(1);
  expect(await shown.locator('span').first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 0, 0)');
});

test('highlights, substitutes and gags change only the display in a replay', async ({ page }) => {
  await page.goto('/?replay');
  await expect(rows(page).first()).toHaveText(/Offline replay mode/);
  const r = await page.evaluate(() =>
    window.__wc!.app.applyProfile(
      [
        '#highlight {- sanctuary} {Magenta}',
        '#gag {^You hear some noise}',
        '#substitute {^%1 is stunned!} {<F23aaee>STUNNED: %1}',
        '#action {^Bob waves} {#showme {waved back}}',
      ].join('\n'),
    ),
  );
  expect(r).toEqual({ ok: true, warnings: [] });
  const log = [
    'You feel - sanctuary.',
    'You hear some noise to the east.',
    'An orc is stunned!',
    'Bob waves.',
    'The end.',
  ]
    .map((l, i) => `${1790366274272195 + i * 1000} ${l}`)
    .join('\n');
  await page.evaluate((t) => window.__wc!.app.startReplay(t, 'script.log', 0), log + '\n');
  await expect(rows(page).filter({ hasText: '[SYSTEM] Replay finished.' })).toHaveCount(1);
  const text = await rows(page).allTextContents();
  const i = text.indexOf('You feel - sanctuary.');
  expect(text.slice(i, i + 5)).toEqual(['You feel - sanctuary.', 'STUNNED: An orc', 'waved back', 'Bob waves.', 'The end.']);
  const hi = rows(page).filter({ hasText: 'You feel - sanctuary.' }).locator('span.wc-f13');
  await expect(hi).toHaveText('- sanctuary');
});
