// scratch (P4): screenshots of the map during a slow map-demo replay.
import { chromium } from '@playwright/test';
const OUT = '/tmp/claude-1000/-home-ole-proj-webcockpit/6a5b2eae-5798-480a-b94e-0d84171bd7f5/scratchpad';
const base = 'http://localhost:5199';
const SPEED = Number(process.env.SPEED ?? 0.25);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text()}`); });
await page.goto(`${base}/?replay`);
await page.waitForSelector('.wc-cockpit');
await page.evaluate(() => window.__wc!.settings.update({ panes: { map: { on: true } } }));
const content = page.locator('.wc-pane-map .wc-pane-content');
await page.waitForSelector('.wc-pane-map .wc-pane-content[data-map-drawn-ms]', { state: 'attached', timeout: 30000 });
const attrs = async () => ({ room: await content.getAttribute('data-map-room'), located: await content.getAttribute('data-map-located'), how: await content.getAttribute('data-map-how') });
const t0 = Date.now();
await page.evaluate(async (speed) => {
  const text = await (await fetch('/__fixtures/map-demo.log')).text();
  window.__wc!.app.startReplay(text, 'map-demo.log', speed);
}, SPEED);
const at = async (replaySec: number, name: string) => {
  const wait = t0 + (replaySec / SPEED) * 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `${OUT}/p4-${name}.png` });
  console.log(name, ((Date.now() - t0) / 1000 * SPEED).toFixed(2), JSON.stringify(await attrs()));
};
await at(1.5, '1-start');
await at(3.0, '2-group');
await at(4.9, '3-prespam-nnn');
await at(5.2, '3b-prespam-after-first');
await at(22.5, '4-final');
// Drag and wheel: the canvas changes.
const box = (await content.boundingBox())!;
const before = await content.screenshot({ path: `${OUT}/p4-5a-before-drag.png` });
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
const dragged = await content.screenshot({ path: `${OUT}/p4-5b-after-drag.png` });
await page.mouse.wheel(0, -300);
await new Promise((r) => setTimeout(r, 200));
const zoomed = await content.screenshot({ path: `${OUT}/p4-5c-after-wheel-in.png` });
console.log('drag changed', !before.equals(dragged), 'wheel changed', !dragged.equals(zoomed));
console.log('focus in input', await page.evaluate(() => document.activeElement?.className));
console.log('errors', JSON.stringify(errors));
await browser.close();
