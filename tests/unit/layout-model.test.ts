import { describe, expect, it } from 'vitest';
import { DEFAULT_BOTTOM_DESIRED } from '../../src/layout/allocate';
import {
  findPane,
  isNoopMove,
  movePane,
  setDesired,
  setDockSize,
  shiftBoundary,
  togglePatch,
} from '../../src/layout/model';
import { type DockId, type LayoutModel, PANE_IDS, defaultLayout } from '../../src/layout/types';
import { defaultSettings } from '../../src/settings/types';

const order = (m: LayoutModel, d: DockId) => m.docks[d].panes.map((p) => p.id);

function everyPaneOnce(m: LayoutModel): void {
  const ids = [...order(m, 'left'), ...order(m, 'right'), ...order(m, 'top'), ...order(m, 'bottom')];
  expect(ids.sort()).toEqual([...PANE_IDS].sort());
}

describe('movePane', () => {
  it('reorders within a dock (index = insertion point in the current list)', () => {
    const m = defaultLayout();
    expect(order(movePane(m, 'ui', 'right', 0), 'right')).toEqual(['ui', 'character', 'timers', 'group', 'comm']);
    expect(order(movePane(m, 'character', 'right', 5), 'right')).toEqual(['timers', 'group', 'comm', 'ui', 'character']);
    expect(order(movePane(m, 'character', 'right', 2), 'right')).toEqual(['timers', 'character', 'group', 'comm', 'ui']);
    expect(order(movePane(m, 'comm', 'right', 1), 'right')).toEqual(['character', 'comm', 'timers', 'group', 'ui']);
  });

  it('moves between docks and keeps every pane exactly once', () => {
    const m = movePane(defaultLayout(), 'group', 'left', 0);
    expect(order(m, 'left')).toEqual(['group']);
    expect(order(m, 'right')).toEqual(['character', 'timers', 'comm', 'ui']);
    everyPaneOnce(m);
    const m2 = movePane(m, 'timers', 'left', 99);
    expect(order(m2, 'left')).toEqual(['group', 'timers']);
    everyPaneOnce(m2);
  });

  it('keeps desired between side docks and resets it across axes', () => {
    let m = setDesired(defaultLayout(), { comm: 14 });
    m = movePane(m, 'comm', 'left', 0);
    expect(m.docks.left.panes[0]).toEqual({ id: 'comm', desired: 14 });
    m = movePane(m, 'comm', 'bottom', 0);
    expect(m.docks.bottom.panes[0]).toEqual({ id: 'comm', desired: DEFAULT_BOTTOM_DESIRED });
    m = movePane(m, 'comm', 'right', 0);
    expect(m.docks.right.panes[0]).toEqual({ id: 'comm', desired: 10 });
    m = movePane(m, 'comm', 'top', 0);
    expect(m.docks.top.panes[0]).toEqual({ id: 'comm', desired: DEFAULT_BOTTOM_DESIRED });
    m = setDesired(m, { comm: 40 });
    m = movePane(m, 'comm', 'bottom', 0);
    expect(m.docks.bottom.panes[0]).toEqual({ id: 'comm', desired: 40 });
    everyPaneOnce(m);
  });

  it('does not mutate its input', () => {
    const m = defaultLayout();
    const before = JSON.stringify(m);
    movePane(m, 'ui', 'bottom', 0);
    setDockSize(m, 'right', 40);
    setDesired(m, { ui: 9 });
    expect(JSON.stringify(m)).toBe(before);
  });

  it('knows a no-op move', () => {
    const m = defaultLayout();
    expect(isNoopMove(m, 'timers', 'right', 1)).toBe(true);
    expect(isNoopMove(m, 'timers', 'right', 2)).toBe(true);
    expect(isNoopMove(m, 'timers', 'right', 3)).toBe(false);
    expect(isNoopMove(m, 'timers', 'left', 0)).toBe(false);
  });

  it('finds a pane', () => {
    expect(findPane(defaultLayout(), 'comm')).toEqual({ dock: 'right', index: 3 });
  });
});

describe('sizes', () => {
  it('sets a dock size (whole cells, at least 1)', () => {
    expect(setDockSize(defaultLayout(), 'right', 40.4).docks.right.size).toBe(40);
    expect(setDockSize(defaultLayout(), 'bottom', -3).docks.bottom.size).toBe(1);
    const m = defaultLayout();
    expect(setDockSize(m, 'right', 33)).toBe(m);
  });

  it('sets desired sizes clamped to the minimum', () => {
    const m = setDesired(defaultLayout(), { character: 1, ui: 12 });
    expect(m.docks.right.panes.find((p) => p.id === 'character')!.desired).toBe(3);
    expect(m.docks.right.panes.find((p) => p.id === 'ui')!.desired).toBe(12);
  });

  it('shifts a boundary between two panes within their minimums', () => {
    const a = { id: 'character' as const, size: 9 };
    const b = { id: 'timers' as const, size: 8 };
    expect(shiftBoundary(a, b, 'right', 2)).toEqual({ a: 11, b: 6 });
    expect(shiftBoundary(a, b, 'right', 20)).toEqual({ a: 16, b: 1 });
    expect(shiftBoundary(a, b, 'right', -20)).toEqual({ a: 3, b: 14 });
    // Bottom dock minimum is 8 columns each.
    expect(shiftBoundary(a, b, 'bottom', 20)).toEqual({ a: 9, b: 8 });
    expect(shiftBoundary(a, b, 'bottom', -20)).toEqual({ a: 8, b: 9 });
  });
});

describe('togglePatch', () => {
  it('flips one pane', () => {
    const s = defaultSettings();
    expect(togglePatch(s.panes, 'group')).toEqual({ panes: { group: { on: false } } });
  });
});
