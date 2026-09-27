// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../../src/core/bus';
import { type Line, type StyleRun, rgb } from '../../src/core/types';
import { OutputPane, MAX_ROWS_PER_FRAME } from '../../src/ui/output-pane';
import { PALETTE_256, colorToCss } from '../../src/ui/palette';

function line(text: string, prompt = false, runs: StyleRun[] = []): Line {
  return { text, runs, tags: [], prompt, raw: text, ts: 0 };
}

function setup(scrollback = 100) {
  const bus = new Bus();
  // No script engine here: pass lines straight through the display events.
  bus.on('text.line', (l) => bus.emit('text.display', { line: l, source: l }));
  bus.on('text.partial', (l) => bus.emit('text.displayPartial', { line: l, source: l }));
  const root = document.createElement('div');
  document.body.appendChild(root);
  const frames: Array<() => void> = [];
  const focus = vi.fn();
  const clip = vi.fn(() => Promise.resolve());
  const pane = new OutputPane(bus, root, {
    scrollback,
    requestFrame: (cb) => frames.push(cb),
    onFocusInput: focus,
    writeClipboard: clip,
  });
  const runFrames = () => {
    while (frames.length) frames.shift()!();
  };
  const rows = () =>
    Array.from(pane.el.querySelectorAll('.wc-rows .wc-row')).map((r) => r.textContent);
  const partial = () => pane.el.querySelector('.wc-partial') as HTMLElement;
  return { bus, root, pane, frames, runFrames, rows, partial, focus, clip };
}

describe('OutputPane batching', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('coalesces many lines into one frame and one flush', () => {
    const t = setup();
    for (let i = 0; i < 50; i++) t.bus.emit('text.line', line('l' + i));
    expect(t.frames.length).toBe(1);
    expect(t.rows()).toEqual([]);
    t.runFrames();
    expect(t.pane.flushCount).toBe(1);
    expect(t.rows().length).toBe(50);
    expect(t.rows()[49]).toBe('l49');
  });

  it('caps the scrollback, removing from the top', () => {
    const t = setup(10);
    for (let i = 0; i < 7; i++) t.bus.emit('text.line', line('a' + i));
    t.runFrames();
    for (let i = 0; i < 7; i++) t.bus.emit('text.line', line('b' + i));
    t.runFrames();
    const r = t.rows();
    expect(r.length).toBe(10);
    expect(t.pane.rows).toBe(10);
    expect(r[0]).toBe('a4');
    expect(r[9]).toBe('b6');
  });

  it('groups rows into chunks and trims whole chunks from the top', () => {
    const t = setup(1000); // chunks of 10 rows
    for (let i = 0; i < 995; i++) t.bus.emit('text.line', line('c' + i));
    t.runFrames();
    expect(t.pane.el.querySelectorAll('.wc-rows > .wc-chunk')).toHaveLength(100);
    expect(t.pane.rows).toBe(995);
    for (let i = 995; i < 1013; i++) {
      t.bus.emit('text.line', line('c' + i));
      t.runFrames();
    }
    // 1013 rows would leave 1003 after dropping the first chunk: at least
    // `scrollback` rows are kept, fewer than scrollback + one chunk.
    const r = t.rows();
    expect(r.length).toBe(1003);
    expect(t.pane.rows).toBe(1003);
    expect(r[0]).toBe('c10');
    expect(r.at(-1)).toBe('c1012');
    for (const c of t.pane.el.querySelectorAll('.wc-chunk')) {
      expect(c.childElementCount).toBeLessThanOrEqual(10);
    }
  });

  it('drops queued lines that could never be seen', () => {
    const t = setup(10);
    for (let i = 0; i < 1000; i++) t.bus.emit('text.line', line('x' + i));
    t.runFrames();
    expect(t.pane.flushCount).toBe(1);
    expect(t.rows()).toEqual(Array.from({ length: 10 }, (_, i) => 'x' + (990 + i)));
  });

  it('spreads huge bursts over frames of at most MAX_ROWS_PER_FRAME rows', () => {
    const t = setup(20000);
    const n = MAX_ROWS_PER_FRAME * 2 + 5;
    for (let i = 0; i < n; i++) t.bus.emit('text.line', line('y' + i));
    t.frames.shift()!();
    expect(t.pane.rows).toBe(MAX_ROWS_PER_FRAME);
    t.runFrames();
    expect(t.pane.rows).toBe(n);
    expect(t.pane.flushCount).toBe(3);
  });

  it('renders sys messages with the [SYSTEM] prefix', () => {
    const t = setup();
    t.bus.emit('sys.message', { text: 'Connected.' });
    t.runFrames();
    const el = t.pane.el.querySelector('.wc-sys')!;
    expect(el.textContent).toBe('[SYSTEM] Connected.');
  });

  it('never interprets game text as HTML', () => {
    const t = setup();
    t.bus.emit('text.line', line('<b>hi</b> &amp;'));
    t.runFrames();
    expect(t.pane.el.querySelector('b')).toBeNull();
    expect(t.rows()[0]).toBe('<b>hi</b> &amp;');
  });
});

describe('OutputPane styling', () => {
  it('uses classes for 0-15, inline style for 256 and truecolor', () => {
    const t = setup();
    t.bus.emit(
      'text.line',
      line('abcdefgh', false, [
        { start: 0, end: 2, fg: 1, bold: true },
        { start: 2, end: 4, fg: 200 },
        { start: 4, end: 6, fg: rgb(1, 2, 3), bg: 12 },
      ]),
    );
    t.runFrames();
    const spans = t.pane.el.querySelectorAll('.wc-rows span');
    expect(spans.length).toBe(3);
    expect(spans[0]!.className).toBe('wc-f1 wc-bold');
    expect((spans[1] as HTMLElement).style.color).not.toBe('');
    expect(spans[2]!.className).toBe('wc-b12');
    expect(t.rows()[0]).toBe('abcdefgh');
  });

  it('handles inverse with default colours', () => {
    const t = setup();
    t.bus.emit('text.line', line('ab', false, [{ start: 0, end: 2, inverse: true }]));
    t.runFrames();
    expect(t.pane.el.querySelector('.wc-rows span')!.className).toBe('wc-fd wc-bd');
  });

  it('builds the xterm palette', () => {
    expect(PALETTE_256.length).toBe(256);
    expect(PALETTE_256[1]).toBe('#800000');
    expect(PALETTE_256[16]).toBe('#000000');
    expect(PALETTE_256[196]).toBe('#ff0000');
    expect(PALETTE_256[231]).toBe('#ffffff');
    expect(PALETTE_256[232]).toBe('#080808');
    expect(PALETTE_256[255]).toBe('#eeeeee');
    expect(colorToCss(rgb(0x12, 0x34, 0x56))).toBe('#123456');
  });
});

describe('OutputPane partial line', () => {
  it('shows the latest partial and removes it when a line supersedes it', () => {
    const t = setup();
    t.bus.emit('text.partial', line('By what'));
    t.bus.emit('text.partial', line('By what name?'));
    t.runFrames();
    expect(t.partial().hidden).toBe(false);
    expect(t.partial().textContent).toBe('By what name?');
    t.bus.emit('text.line', line('By what name?'));
    t.runFrames();
    expect(t.partial().hidden).toBe(true);
    expect(t.rows()).toEqual(['By what name?']);
  });

  it('clears on an empty partial', () => {
    const t = setup();
    t.bus.emit('text.partial', line('x'));
    t.runFrames();
    t.bus.emit('text.partial', line(''));
    t.runFrames();
    expect(t.partial().hidden).toBe(true);
  });

  it('carries an echo typed at a partial prompt onto the completed line', () => {
    const t = setup();
    t.bus.emit('text.partial', line('Name: '));
    t.bus.emit('cmd.sent', { text: 'Ole', ts: 0 });
    t.runFrames();
    expect(t.partial().textContent).toBe('Name: Ole');
    t.bus.emit('text.line', line('Name: '));
    t.runFrames();
    expect(t.rows()).toEqual(['Name: Ole']);
  });
});

describe('OutputPane command echo', () => {
  it('appends the command to the last prompt line', () => {
    const t = setup();
    t.bus.emit('text.line', line('oO>', true));
    t.runFrames();
    t.bus.emit('cmd.sent', { text: 'look', ts: 0 });
    t.runFrames();
    expect(t.rows()).toEqual(['oO> look']);
    expect(t.pane.el.querySelector('.wc-echo')!.textContent).toBe(' look');
  });

  it('appends to a prompt still queued in the same frame', () => {
    const t = setup();
    t.bus.emit('text.line', line('oO> ', true));
    t.bus.emit('cmd.sent', { text: 'n', ts: 0 });
    t.runFrames();
    expect(t.rows()).toEqual(['oO> n']);
  });

  it('puts a second command before the next prompt on its own line', () => {
    const t = setup();
    t.bus.emit('text.line', line('oO>', true));
    t.bus.emit('cmd.sent', { text: 'n', ts: 0 });
    t.bus.emit('cmd.sent', { text: 's', ts: 0 });
    t.runFrames();
    expect(t.rows()).toEqual(['oO> n', 's']);
  });

  it('renders on its own line after non-prompt output', () => {
    const t = setup();
    t.bus.emit('text.line', line('You are hungry.'));
    t.bus.emit('cmd.sent', { text: 'eat bread', ts: 0 });
    t.runFrames();
    expect(t.rows()).toEqual(['You are hungry.', 'eat bread']);
  });

  it('skips empty, secret and echo:false commands', () => {
    const t = setup();
    t.bus.emit('text.line', line('oO>', true));
    t.bus.emit('cmd.sent', { text: '', ts: 0 });
    t.bus.emit('cmd.sent', { text: '', ts: 0, secret: true });
    t.bus.emit('cmd.sent', { text: 'change width all 500', ts: 0, echo: false } as never);
    t.runFrames();
    expect(t.rows()).toEqual(['oO>']);
  });
});

describe('OutputPane scrolling and selection', () => {
  function fakeScroll(el: HTMLElement, heights: { scrollHeight: number; clientHeight: number }) {
    let top = 0;
    Object.defineProperty(el, 'scrollHeight', { get: () => heights.scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => heights.clientHeight, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, heights.scrollHeight - heights.clientHeight));
      },
      configurable: true,
    });
  }

  it('enters scroll mode on pageUp, counts new lines, and leaves on pageDown', () => {
    const t = setup(1000);
    const h = { scrollHeight: 1800, clientHeight: 180 };
    fakeScroll(t.pane.scroller, h);
    t.pane.toTail();
    expect(t.pane.isScrolled()).toBe(false);
    t.pane.pageUp();
    expect(t.pane.isScrolled()).toBe(true);
    const bar = t.pane.el.querySelector('.wc-tail-bar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    const topBefore = t.pane.scroller.scrollTop;
    t.bus.emit('text.line', line('new'));
    t.runFrames();
    expect(t.pane.scroller.scrollTop).toBe(topBefore);
    expect(bar.textContent).toContain('1 new line');
    t.pane.pageDown();
    t.pane.pageDown();
    expect(t.pane.isScrolled()).toBe(false);
    expect(bar.hidden).toBe(true);
  });

  it('pageDown at the tail does nothing; toTail leaves scroll mode', () => {
    const t = setup();
    const h = { scrollHeight: 1800, clientHeight: 180 };
    fakeScroll(t.pane.scroller, h);
    t.pane.toTail();
    t.pane.pageDown();
    expect(t.pane.isScrolled()).toBe(false);
    t.pane.pageUp();
    t.pane.pageUp();
    t.pane.toTail();
    expect(t.pane.isScrolled()).toBe(false);
    expect(t.pane.scroller.scrollTop).toBe(1620);
  });

  it('a plain click returns focus without touching scroll state', () => {
    const t = setup();
    const h = { scrollHeight: 1800, clientHeight: 180 };
    fakeScroll(t.pane.scroller, h);
    t.pane.toTail();
    t.pane.pageUp();
    t.pane.scroller.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(t.focus).toHaveBeenCalledTimes(1);
    expect(t.clip).not.toHaveBeenCalled();
    expect(t.pane.isScrolled()).toBe(true);
  });

  it('copies a selection on mouseup, then returns focus', () => {
    const t = setup();
    t.bus.emit('text.line', line('copy me'));
    t.runFrames();
    const row = t.pane.el.querySelector('.wc-rows .wc-row')!;
    const range = document.createRange();
    range.selectNodeContents(row);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    t.pane.scroller.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(t.clip).toHaveBeenCalledWith('copy me');
    expect(t.focus).toHaveBeenCalled();
    sel.removeAllRanges();
  });
});
