// @vitest-environment happy-dom
// Stage 7 player modes (ADR 0019): PlayerHost shows comments and blanks in
// the output pane; PlayerView's options (header provider, extra keys,
// overlay, startHidden, box buttons, onEsc) and the cursor skipping blanks.
import { describe, expect, it } from 'vitest';
import { PlayerHost, type PlayerOpenOptions } from '../../src/app/player-host';
import { SettingsStore } from '../../src/settings';
import { BASE_US, FakeWall, makeLog, meta, twoRunChain } from './player-helpers';

const frame = () => new Promise((r) => setTimeout(r, 40));

function open(opts: PlayerOpenOptions = {}, chain = twoRunChain()) {
  const root = document.createElement('div');
  root.style.cssText = 'width:1200px;height:800px';
  document.body.appendChild(root);
  const wall = new FakeWall();
  const viewer = new SettingsStore({ factory: null, storage: null, win: null });
  void viewer.load();
  let closed = 0;
  const host = new PlayerHost({ root, settings: viewer, wall, onClose: () => closed++ });
  host.openChain(chain, [], { character: 'Rasta', level: 42 }, opts);
  return { root, wall, host, closed: () => closed };
}

const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('PlayerHost comments and blanks', () => {
  it('shows a comment as wrapped ## rows before its anchor, stamped with its time', async () => {
    const text = 'Look at this. '.repeat(8);
    const { wall, host } = open({
      edits: { comments: [{ beforeUs: BASE_US + 3e6, text, holdMs: 5000 }] },
    });
    wall.advance(8000);
    await frame();
    const rows = [...host.app!.output.el.querySelectorAll<HTMLElement>('.wc-row')];
    const c = rows.filter((r) => r.classList.contains('wc-comment'));
    expect(c.length).toBe(2);
    expect(c.every((r) => r.textContent!.startsWith('## ') && r.textContent!.length <= 80)).toBe(true);
    expect(c[0]!.dataset.ts).toBe(String(BASE_US + 3e6));
    const i = rows.indexOf(c[1]!);
    expect(rows[i + 1]!.textContent).toBe('A room.');
    host.dispose();
  });

  it('sends blank rows before a spotlight window; the cursor skips them', async () => {
    const chain = [
      { meta: meta('A/1', BASE_US), text: makeLog(BASE_US, [{ at: 1, in: 'One.' }, { at: 2, in: 'Two.' }]) },
      { meta: meta('B/1', BASE_US + 3600e6), text: makeLog(BASE_US + 3600e6, [{ at: 1, in: 'Three.' }]) },
    ];
    const { wall, host } = open(
      {
        edits: {
          windows: [
            { fromUs: BASE_US, toUs: BASE_US + 3e6 },
            { fromUs: BASE_US + 3600e6, toUs: BASE_US + 3602e6 },
          ],
          blankLines: 5,
        },
      },
      chain,
    );
    wall.advance(10_000);
    await frame();
    const out = host.app!.output.el;
    expect(out.querySelectorAll('.wc-blank').length).toBe(10);
    // Paused at the end: the cursor on the last line; ↑ skips the blanks between the windows.
    expect(host.engine!.playing).toBe(false);
    await frame();
    key('ArrowUp');
    expect(host.playerView!.cursorLine!.classList.contains('wc-blank')).toBe(false);
    let guard = 0;
    while (host.playerView!.cursorLine!.textContent !== 'Two.' && guard++ < 20) key('ArrowUp');
    expect(host.playerView!.cursorLine!.textContent).toBe('Two.');
    key('Home');
    expect(host.playerView!.cursorLine!.classList.contains('wc-blank')).toBe(false);
    host.dispose();
  });
});

describe('PlayerView options', () => {
  it('keeps the in-app header and hints', async () => {
    const { root, host, closed } = open();
    await frame();
    expect(root.querySelector('.wc-player-head-left')!.innerHTML).toMatch(
      /^<span class="wc-player-name">Rasta \(L42\)<\/span><span class="wc-player-sep"> · <\/span>Run 1 of 2<span class="wc-player-sep"> · <\/span>\d{4}-\d\d-\d\d \d\d:\d\d$/,
    );
    const back = root.querySelector<HTMLElement>('.wc-player-hints .wc-player-back')!;
    expect(back.textContent).toBe('ESC Back');
    back.click();
    expect(closed()).toBe(1);
    host.dispose();
  });

  it('takes a header provider, extra keys, an overlay, box buttons and onEsc; starts hidden', async () => {
    const seen: string[] = [];
    let esc = 0;
    let fs = false;
    const overlay = document.createElement('div');
    overlay.className = 'info';
    const { root, host, closed } = open({
      view: {
        header: (run) => ({
          left: [{ text: `SPOT ${run + 1}`, cls: 'wc-player-name' }, { text: 'X' }],
          hints: [
            { text: 'ESC Back', drop: Infinity },
            { text: '←→ Prev/next', drop: 1, onClick: () => seen.push('click') },
          ],
        }),
        keys: (e) => {
          if (e.key !== 'ArrowRight') return false;
          seen.push('right');
          return true;
        },
        overlay: { el: overlay },
        startHidden: true,
        stripHoverTime: true,
        boxButtons: [{ label: () => (fs ? 'Exit fullscreen' : 'Fullscreen'), onClick: () => (fs = !fs) }],
        onEsc: () => esc++,
      },
    });
    await frame();
    const chrome = root.querySelector('.wc-player-chrome')!;
    expect(chrome.hasAttribute('data-hidden')).toBe(true);
    expect(overlay.parentElement).toBe(host.el);
    expect(overlay.hasAttribute('data-hidden')).toBe(true);
    expect(root.querySelector('.wc-player-head-left')!.textContent).toBe('SPOT 1 · X');
    // happy-dom has no layout: give the player a size so the hints fit.
    Object.defineProperty(host.el, 'clientWidth', { value: 1200 });
    Object.defineProperty(host.el, 'clientHeight', { value: 800 });
    host.playerView!.refresh();
    await frame();
    const click = root.querySelector<HTMLElement>('.wc-player-hints .wc-player-click')!;
    expect(click.textContent).toBe('←→ Prev/next');
    click.click();
    key('ArrowRight');
    expect(seen).toEqual(['click', 'right']);
    expect(chrome.hasAttribute('data-hidden')).toBe(false); // a key shows the chrome
    expect(overlay.hasAttribute('data-hidden')).toBe(false);
    key('Escape');
    expect(esc).toBe(1);
    expect(closed()).toBe(0);
    const btn = [...root.querySelectorAll<HTMLElement>('.wc-player-btn')].find((b) => b.textContent === 'Fullscreen')!;
    btn.click();
    expect(fs).toBe(true);
    await frame();
    expect([...root.querySelectorAll('.wc-player-btn')].some((b) => b.textContent === 'Exit fullscreen')).toBe(true);
    host.dispose();
    expect(overlay.isConnected).toBe(false);
  });
});
