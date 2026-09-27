// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Cockpit } from '../../src/layout/cockpit';
import { frameBottom, frameEdge, frameText, frameTop } from '../../src/panes/frame';
import { PaneShell } from '../../src/panes/pane';
import { SettingsStore } from '../../src/settings';

describe('frame', () => {
  it('draws the top row with the label after ▀▀ and fills to the width', () => {
    expect(frameTop(20, 'Timers')).toBe('▛▀▀ Timers ▀▀▀▀▀▀▀▀▜');
    expect(frameTop(20, 'Timers')).toHaveLength(20);
    expect(frameTop(6, 'Timers')).toBe('▛▀▀ T▜');
    expect(frameTop(2, 'UI')).toBe('▛▜');
    expect(frameTop(1, 'UI')).toBe('▛');
    expect(frameTop(0, 'UI')).toBe('');
  });

  it('draws edges and the bottom row', () => {
    expect(frameEdge(5)).toBe('▌   ▐');
    expect(frameBottom(5)).toBe('▙▄▄▄▟');
  });

  it('builds h rows of w cells', () => {
    const t = frameText(12, 4, 'Comm').split('\n');
    expect(t).toEqual(['▛▀▀ Comm ▀▀▜', '▌          ▐', '▌          ▐', '▙▄▄▄▄▄▄▄▄▄▄▟']);
    for (const row of t) expect([...row]).toHaveLength(12);
    expect(frameText(5, 1, 'X')).toBe('▛▀▀ ▜');
    expect(frameText(0, 3, 'X')).toBe('');
  });

});

describe('PaneShell', () => {
  it('places itself in cells, draws the frame and reports its inner size', () => {
    const p = new PaneShell(document, 'comm');
    const sizes: [number, number][] = [];
    p.onResize((c, r) => sizes.push([c, r]));
    const rect = { x: 2, y: 3, w: 10, h: 5 };
    p.place({ rect, content: { x: 3, y: 4, w: 8, h: 3 }, framed: true }, { w: 9, h: 17 });
    expect(p.el.hidden).toBe(false);
    expect(p.el.style.left).toBe('18px');
    expect(p.el.style.top).toBe('51px');
    expect(p.el.style.width).toBe('90px');
    expect(p.content.style.left).toBe('9px');
    expect(p.content.style.height).toBe('51px');
    expect(p.el.querySelector('.wc-pane-frame')!.textContent!.split('\n')[0]).toBe('▛▀▀ Comm ▜');
    expect([p.cols, p.rows, p.visible]).toEqual([8, 3, true]);
    p.place({ rect, content: rect, framed: false }, { w: 9, h: 17 });
    expect(p.el.querySelector('.wc-pane-frame')!.textContent).toBe('');
    p.place(null, { w: 9, h: 17 });
    expect(p.el.hidden).toBe(true);
    expect(sizes).toEqual([
      [8, 3],
      [10, 5],
      [0, 0],
    ]);
  });
});

describe('Cockpit', () => {
  function make(width: number, height: number) {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    document.body.append(root);
    const settings = new SettingsStore({ factory: null, storage: null, win: null });
    const frames: (() => void)[] = [];
    const size = { width, height };
    const c = new Cockpit({
      root,
      settings,
      cells: { get: () => ({ w: 10, h: 20 }), subscribe: () => () => {} },
      requestFrame: (cb) => frames.push(cb),
    });
    Object.defineProperty(c.el, 'clientWidth', { get: () => size.width, configurable: true });
    Object.defineProperty(c.el, 'clientHeight', { get: () => size.height, configurable: true });
    c.relayoutNow();
    const flush = () => {
      while (frames.length) frames.shift()!();
    };
    return { c, settings, size, flush };
  }

  it('lays out the default in whole cells', () => {
    const { c } = make(1205, 1010); // 120 × 50 cells, 5 px / 10 px spare
    expect(c.el.dataset.cells).toBe('120x50');
    expect(c.gameEl.style.width).toBe('860px');
    expect(c.inputEl.style.top).toBe('980px');
    expect(c.pane('character').el.style.left).toBe('870px');
    expect(c.pane('character').rows).toBe(9);
    expect(c.pane('ui').rows).toBe(6);
    expect(c.el.querySelectorAll('.wc-handle')).toHaveLength(5); // dock gap + 4 boundaries
  });

  it('relayouts once per frame after settings changes', () => {
    const { c, settings, flush } = make(1200, 1000);
    settings.update({ panes: { ui: { on: false } } });
    settings.update({ panes: { group: { on: false } } });
    expect(c.pane('ui').visible).toBe(true);
    flush();
    expect(c.pane('ui').visible).toBe(false);
    expect(c.pane('group').visible).toBe(false);
    expect(c.pane('character').rows).toBe(9 + 49 - 33); // leftover to Character without UI
  });

  it('shows the too-small state and makes the view inert', () => {
    const { c, size, flush } = make(1200, 1000);
    size.width = 500;
    c.scheduleRelayout();
    flush();
    expect(c.el.hasAttribute('data-too-small')).toBe(true);
    expect(c.inputEl.inert).toBe(true);
    expect(c.el.querySelector<HTMLElement>('.wc-too-small')!.hidden).toBe(false);
    size.width = 1200;
    c.scheduleRelayout();
    flush();
    expect(c.el.hasAttribute('data-too-small')).toBe(false);
    expect(c.inputEl.inert).toBe(false);
  });

  it('finds drop targets: dock positions, edges of hidden docks, floating over the game', () => {
    const { c } = make(1200, 1000); // 120 × 50, right dock x 87..119
    // Over the top half of Character → before it; no-op for Character itself.
    expect(c.dropTarget(900, 30, 'comm')).toMatchObject({ dock: 'right', index: 0, open: false });
    expect(c.dropTarget(900, 30, 'character')).toBeNull();
    // Below the last pane's middle → after UI.
    expect(c.dropTarget(900, 970, 'character')).toMatchObject({ dock: 'right', index: 5 });
    expect(c.dropTarget(5, 400, 'comm')).toMatchObject({ dock: 'left', index: 0, open: true });
    expect(c.dropTarget(400, 970, 'comm')).toMatchObject({ dock: 'bottom', open: true });
    expect(c.dropTarget(400, 10, 'comm')).toMatchObject({ kind: 'dock', dock: 'top', open: true });
    // Over the game: float at the pointer at the pane's current size (Comm 33 × 12).
    expect(c.dropTarget(400, 400, 'comm')).toEqual({ kind: 'float', rect: { x: 40, y: 20, w: 33, h: 12 } });
    expect(c.dropTarget(400, 400, 'comm', { x: 5, y: 0 })).toEqual({ kind: 'float', rect: { x: 35, y: 20, w: 33, h: 12 } });
    // Clamped into the area above the input line.
    expect(c.dropTarget(1150, 985, 'comm')).toEqual({ kind: 'float', rect: { x: 87, y: 37, w: 33, h: 12 } });
  });

  it('places floating panes over the rest and docks them only from the screen edges', () => {
    const { c, settings, size, flush } = make(1200, 1000);
    settings.update((d) => {
      d.layout.docks.right.panes = d.layout.docks.right.panes.filter((p) => p.id !== 'comm' && p.id !== 'ui');
      d.layout.floating = [
        { id: 'comm', x: 80, y: 10, w: 30, h: 12 },
        { id: 'ui', x: 5, y: 5, w: 20, h: 6 },
      ];
    });
    flush();
    const comm = c.pane('comm');
    expect(comm.el.hasAttribute('data-floating')).toBe(true);
    expect(comm.el.style.zIndex).toBe('10');
    expect(c.pane('ui').el.style.zIndex).toBe('11');
    expect(c.pane('character').el.hasAttribute('data-floating')).toBe(false);
    expect(c.pane('character').el.style.zIndex).toBe('');
    expect([comm.cols, comm.rows]).toEqual([28, 10]);
    expect(comm.el.style.left).toBe('800px');
    expect(comm.el.querySelectorAll('.wc-float-handle')).toHaveLength(8);
    // Over the right dock but not at the screen edge: still floats.
    expect(c.dropTarget(1000, 400, 'comm')).toMatchObject({ kind: 'float' });
    // A docked pane dropped there goes into the dock.
    expect(c.dropTarget(1000, 30, 'group')).toMatchObject({ kind: 'dock', dock: 'right' });
    // The right edge zone docks it into the shown right dock; the left one opens the left dock.
    expect(c.dropTarget(1195, 30, 'comm')).toMatchObject({ kind: 'dock', dock: 'right', index: 0, open: false });
    expect(c.dropTarget(5, 400, 'comm')).toMatchObject({ kind: 'dock', dock: 'left', open: true });
    // Its own place is no move.
    expect(c.dropTarget(800, 200, 'comm')).toBeNull();
    // A smaller window clamps it; toggling it off and on keeps its rectangle.
    size.width = 800;
    c.scheduleRelayout();
    flush();
    expect(comm.el.style.left).toBe(`${(80 - 30) * 10}px`);
    settings.update({ panes: { comm: { on: false } } });
    flush();
    expect(comm.visible).toBe(false);
    settings.update({ panes: { comm: { on: true } } });
    flush();
    expect(settings.get().layout.floating[0]).toEqual({ id: 'comm', x: 80, y: 10, w: 30, h: 12 });
    expect(comm.visible).toBe(true);
  });
});
