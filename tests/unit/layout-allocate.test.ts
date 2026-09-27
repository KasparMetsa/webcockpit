import { describe, expect, it } from 'vitest';
import {
  type AllocateInput,
  type AxisItem,
  GAME_MIN_COLS,
  allocate,
  allocateAxis,
  clampFloat,
  floatMin,
} from '../../src/layout/allocate';
import { type LayoutModel, PANE_IDS, type PaneId, defaultLayout } from '../../src/layout/types';
import { floatPane, movePane, setDockSize } from '../../src/layout/model';

const MIN: Record<PaneId, number> = { character: 3, timers: 1, group: 1, comm: 1, ui: 1 };
const DES: Record<PaneId, number> = { character: 9, timers: 8, group: 6, comm: 10, ui: 5 };

const items = (ids: PaneId[] = [...PANE_IDS], frame = 2): AxisItem[] =>
  ids.map((id) => ({ id, desired: DES[id], min: MIN[id], frame }));

const sizes = (r: ReturnType<typeof allocateAxis>): Record<string, number> =>
  Object.fromEntries(r.sizes.map((s) => [s.id, s.size]));

const total = (r: ReturnType<typeof allocateAxis>, frame = 2): number =>
  r.sizes.reduce((a, s) => a + s.size + frame, 0);

function toggles(off: PaneId[] = [], noBorder: PaneId[] = []): AllocateInput['panes'] {
  return Object.fromEntries(
    PANE_IDS.map((id) => [id, { on: !off.includes(id), border: !noBorder.includes(id) }]),
  ) as AllocateInput['panes'];
}

const input = (cols: number, rows: number, layout: LayoutModel = defaultLayout(), panes = toggles()): AllocateInput => ({
  layout,
  panes,
  cols,
  rows,
});

describe('allocateAxis', () => {
  it('gives desired sizes and the leftover to the UI pane when everything fits', () => {
    const r = allocateAxis(items(), 60);
    expect(r.mode).toBe('fit');
    expect(sizes(r)).toEqual({ character: 9, timers: 8, group: 6, comm: 10, ui: 5 + (60 - 48) });
    expect(total(r)).toBe(60);
  });

  it('gives the leftover to Character when UI is not shown, then comm', () => {
    expect(sizes(allocateAxis(items(['timers', 'character', 'group']), 40)).character).toBe(9 + 40 - 29);
    expect(sizes(allocateAxis(items(['group', 'comm']), 30)).comm).toBe(10 + 30 - 20);
  });

  it('keeps exact desired sizes when they sum to the length', () => {
    const r = allocateAxis(items(), 48);
    expect(sizes(r)).toEqual(DES);
    expect(r.mode).toBe('fit');
  });

  it('reserves Character first and scales the others between min and desired', () => {
    const r = allocateAxis(items(), 40);
    expect(r.mode).toBe('scaled');
    const s = sizes(r);
    expect(s.character).toBe(9);
    expect(total(r)).toBe(40);
    for (const id of ['timers', 'group', 'comm', 'ui'] as const) {
      expect(s[id]).toBeGreaterThanOrEqual(MIN[id]);
      expect(s[id]).toBeLessThanOrEqual(DES[id]);
    }
    // Linear: comm (span 9) keeps more than group (span 5).
    expect(s.comm!).toBeGreaterThan(s.group!);
  });

  it('scales Character too when reserving it would starve the others', () => {
    // frames 10 + others' mins 4 + character 9 = 23 > 20.
    const r = allocateAxis(items(), 20);
    const s = sizes(r);
    expect(r.dropped).toEqual([]);
    expect(s.character).toBeLessThan(9);
    expect(s.character).toBeGreaterThanOrEqual(3);
    expect(total(r)).toBe(20);
  });

  it('drops panes in order group, timers, comm, character, ui when minimums do not fit', () => {
    // mins+frames: character 5, timers 3, group 3, comm 3, ui 3 = 17.
    expect(allocateAxis(items(), 17).dropped).toEqual([]);
    expect(allocateAxis(items(), 16).dropped).toEqual(['group']);
    expect(allocateAxis(items(), 13).dropped).toEqual(['group', 'timers']);
    expect(allocateAxis(items(), 10).dropped).toEqual(['group', 'timers', 'comm']);
    expect(allocateAxis(items(), 4).dropped).toEqual(['group', 'timers', 'comm', 'character']);
    const last = allocateAxis(items(), 3);
    expect(sizes(last)).toEqual({ ui: 1 });
    const none = allocateAxis(items(), 2);
    expect(none.mode).toBe('empty');
    expect(none.sizes).toEqual([]);
  });

  it('counts frames only for framed panes', () => {
    const r = allocateAxis(items(['character', 'ui'], 0), 20);
    expect(sizes(r)).toEqual({ character: 9, ui: 11 });
  });

  it('fills the length exactly in every mode', () => {
    for (let len = 17; len <= 80; len++) {
      const r = allocateAxis(items(), len);
      expect(total(r)).toBe(len);
      for (const s of r.sizes) expect(s.size).toBeGreaterThanOrEqual(MIN[s.id]);
    }
  });

  it('treats a desired size below the minimum as the minimum', () => {
    const r = allocateAxis([{ id: 'character', desired: 1, min: 3, frame: 2 }, { id: 'ui', desired: 1, min: 1, frame: 2 }], 8);
    expect(sizes(r)).toEqual({ character: 3, ui: 1 });
  });
});

describe('allocate', () => {
  it('lays out the default: game left, right dock 33 wide, input at the bottom', () => {
    const r = allocate(input(120, 50));
    expect(r.tooSmall).toBe(false);
    expect(r.input).toEqual({ x: 0, y: 49, w: 120, h: 1 });
    expect(r.docks.right!.rect).toEqual({ x: 87, y: 0, w: 33, h: 49 });
    expect(r.game).toEqual({ x: 0, y: 0, w: 86, h: 49 });
    expect(r.panes.map((p) => p.id)).toEqual([...PANE_IDS]);
    const heights = r.panes.map((p) => p.content.h);
    expect(heights).toEqual([9, 8, 6, 10, 5 + 1]); // 48 of 49 rows: one left over, to UI
    let y = 0;
    for (const p of r.panes) {
      expect(p.rect.y).toBe(y);
      expect(p.rect.x).toBe(87);
      expect(p.content).toEqual({ x: 88, y: y + 1, w: 31, h: p.rect.h - 2 });
      y += p.rect.h;
    }
    expect(y).toBe(49);
    expect(r.hidden).toEqual([]);
  });

  it('gives an unframed pane its full rectangle as content', () => {
    const r = allocate(input(120, 50, defaultLayout(), toggles([], ['timers'])));
    const t = r.panes.find((p) => p.id === 'timers')!;
    expect(t.framed).toBe(false);
    expect(t.content).toEqual(t.rect);
  });

  it('leaves out panes that are off and hides a dock with no pane on', () => {
    const r = allocate(input(120, 50, defaultLayout(), toggles(['group', 'comm'])));
    expect(r.panes.map((p) => p.id)).toEqual(['character', 'timers', 'ui']);
    const all = allocate(input(120, 50, defaultLayout(), toggles([...PANE_IDS])));
    expect(all.docks).toEqual({});
    expect(all.game).toEqual({ x: 0, y: 0, w: 120, h: 49 });
    expect(all.collapsed).toEqual([]);
  });

  it('drops panes when the window is short, without touching the toggles', () => {
    const r = allocate(input(120, 18));
    // 17 rows = every minimum with frames exactly.
    expect(r.hidden).toEqual([]);
    expect(r.panes.map((p) => p.content.h)).toEqual([3, 1, 1, 1, 1]);
  });

  it('shows the too-small state below 60 × 18', () => {
    expect(allocate(input(59, 40)).tooSmall).toBe(true);
    expect(allocate(input(100, 17)).tooSmall).toBe(true);
    const r = allocate(input(60, 18));
    expect(r.tooSmall).toBe(false);
  });

  it('collapses the side dock when the game pane would get fewer than 30 columns', () => {
    const wide = allocate(input(64, 30));
    expect(wide.game.w).toBe(GAME_MIN_COLS);
    expect(wide.docks.right).toBeDefined();
    const narrow = allocate(input(63, 30));
    expect(narrow.docks.right).toBeUndefined();
    expect(narrow.collapsed).toEqual(['right']);
    expect(narrow.hidden).toEqual([...PANE_IDS]);
    expect(narrow.game).toEqual({ x: 0, y: 0, w: 63, h: 29 });
  });

  it('keeps the right dock and collapses the left one first', () => {
    let m = movePane(defaultLayout(), 'comm', 'left', 0);
    m = setDockSize(m, 'left', 20);
    const both = allocate(input(120, 40, m));
    expect(both.docks.left!.rect).toEqual({ x: 0, y: 0, w: 20, h: 39 });
    expect(both.game).toEqual({ x: 21, y: 0, w: 120 - 21 - 34, h: 39 });
    const r = allocate(input(80, 40, m));
    expect(r.collapsed).toEqual(['left']);
    expect(r.docks.right).toBeDefined();
    expect(r.game.x).toBe(0);
    expect(r.hidden).toEqual(['comm']);
  });

  it('keeps the left dock when only it fits', () => {
    let m = setDockSize(defaultLayout(), 'right', 50);
    m = movePane(m, 'ui', 'left', 0);
    m = setDockSize(m, 'left', 12);
    const r = allocate(input(70, 30, m));
    expect(r.collapsed).toEqual(['right']);
    expect(r.docks.left!.rect.w).toBe(12);
  });

  it('lays out the bottom dock under the game pane, side by side', () => {
    let m = movePane(defaultLayout(), 'comm', 'bottom', 0);
    m = movePane(m, 'ui', 'bottom', 1);
    const r = allocate(input(120, 50, m));
    const b = r.docks.bottom!;
    expect(b.rect).toEqual({ x: 0, y: 49 - 10, w: 86, h: 10 });
    expect(r.game).toEqual({ x: 0, y: 0, w: 86, h: 49 - 10 - 1 });
    const [comm, ui] = r.panes.filter((p) => p.dock === 'bottom');
    expect(comm!.rect).toEqual({ x: 0, y: 39, w: 32, h: 10 });
    // UI takes the leftover columns.
    expect(ui!.rect).toEqual({ x: 32, y: 39, w: 86 - 32, h: 10 });
    expect(ui!.content.h).toBe(8);
  });

  it('shrinks the bottom dock to keep the game pane 5 rows high, then hides it', () => {
    const m = movePane(defaultLayout(), 'comm', 'bottom', 0);
    const r = allocate(input(120, 18, setDockSize(m, 'bottom', 20)));
    expect(r.game.h).toBe(5);
    expect(r.docks.bottom!.rect.h).toBe(17 - 6);
    const small = allocate(input(120, 18, setDockSize(m, 'bottom', 2)));
    expect(small.collapsed).toEqual(['bottom']);
    expect(small.hidden).toContain('comm');
  });

  it('lays out the top dock above the game pane, side by side, between the side docks', () => {
    let m = movePane(defaultLayout(), 'comm', 'top', 0);
    m = movePane(m, 'group', 'left', 0);
    m = setDockSize(m, 'left', 20);
    const r = allocate(input(120, 50, m));
    const t = r.docks.top!;
    expect(t.rect).toEqual({ x: 21, y: 0, w: 120 - 21 - 34, h: 10 });
    expect(r.game).toEqual({ x: 21, y: 11, w: 120 - 21 - 34, h: 49 - 11 });
    expect(r.docks.left!.rect).toEqual({ x: 0, y: 0, w: 20, h: 49 });
    const comm = r.panes.find((p) => p.id === 'comm')!;
    expect(comm).toMatchObject({ dock: 'top', index: 0, rect: t.rect });
    expect(r.panes.map((p) => p.dock)).toEqual(['left', 'right', 'right', 'right', 'top']);
    expect(r.input).toEqual({ x: 0, y: 49, w: 120, h: 1 });
  });

  it('fits top and bottom docks together and keeps the game pane 5 rows high', () => {
    let m = movePane(defaultLayout(), 'comm', 'top', 0);
    m = movePane(m, 'ui', 'bottom', 0);
    const r = allocate(input(120, 50, m));
    expect(r.docks.top!.rect).toEqual({ x: 0, y: 0, w: 86, h: 10 });
    expect(r.docks.bottom!.rect).toEqual({ x: 0, y: 39, w: 86, h: 10 });
    expect(r.game).toEqual({ x: 0, y: 11, w: 86, h: 49 - 22 });
    // 18 rows: 17 above the input, 12 for docks and gaps.
    const s = allocate(input(120, 18, m));
    expect(s.game.h).toBe(5);
    expect(s.docks.top!.rect.h).toBe(3);
    expect(s.docks.bottom!.rect.h).toBe(7);
    expect(s.game.y).toBe(4);
    // A top dock that cannot get its minimum collapses; the bottom dock stays.
    const t = allocate(input(120, 18, setDockSize(setDockSize(m, 'bottom', 8), 'top', 2)));
    expect(t.collapsed).toEqual(['top']);
    expect(t.hidden).toContain('comm');
    expect(t.docks.bottom!.rect.h).toBe(8);
    expect(t.game).toEqual({ x: 0, y: 0, w: 86, h: 17 - 9 });
  });

  it('never makes a side dock narrower than 10 cells', () => {
    const r = allocate(input(120, 30, setDockSize(defaultLayout(), 'right', 3)));
    expect(r.docks.right!.rect.w).toBe(10);
  });

  it('reports the model index of every shown pane', () => {
    const r = allocate(input(120, 50, defaultLayout(), toggles(['timers'])));
    expect(r.panes.map((p) => p.index)).toEqual([0, 2, 3, 4]);
  });

  it('lays floating panes over the game, in z-order, without changing the docks', () => {
    let m = floatPane(defaultLayout(), 'comm', { x: 10, y: 5, w: 30, h: 12 });
    m = floatPane(m, 'group', { x: 20, y: 8, w: 20, h: 6 });
    const r = allocate(input(120, 50, m));
    // The right dock holds the other three; the game pane is unchanged.
    expect(r.game).toEqual({ x: 0, y: 0, w: 86, h: 49 });
    expect(r.docks.right!.panes).toEqual(['character', 'timers', 'ui']);
    const floats = r.panes.filter((p) => p.dock === 'float');
    expect(floats.map((p) => [p.id, p.index])).toEqual([
      ['comm', 0],
      ['group', 1],
    ]);
    expect(floats[0]!.rect).toEqual({ x: 10, y: 5, w: 30, h: 12 });
    expect(floats[0]!.content).toEqual({ x: 11, y: 6, w: 28, h: 10 });
    expect(r.panes.slice(0, 3).every((p) => p.dock === 'right')).toBe(true);
    // Off: not shown and not hidden-for-space.
    const off = allocate(input(120, 50, m, toggles(['comm'], ['group'])));
    expect(off.panes.filter((p) => p.dock === 'float').map((p) => p.id)).toEqual(['group']);
    expect(off.panes.find((p) => p.id === 'group')!.content).toEqual({ x: 20, y: 8, w: 20, h: 6 });
    expect(off.hidden).toEqual([]);
  });

  it('clamps floating panes into the area above the input line, shrinking them if needed', () => {
    const m = floatPane(defaultLayout(), 'comm', { x: 100, y: 45, w: 40, h: 30 });
    const r = allocate(input(120, 50, m));
    expect(r.panes.find((p) => p.id === 'comm')!.rect).toEqual({ x: 80, y: 19, w: 40, h: 30 });
    const small = allocate(input(60, 18, m));
    expect(small.panes.find((p) => p.id === 'comm')!.rect).toEqual({ x: 20, y: 0, w: 40, h: 17 });
    // The model is untouched.
    expect(m.floating[0]).toEqual({ id: 'comm', x: 100, y: 45, w: 40, h: 30 });
    expect(allocate(input(59, 18, m)).tooSmall).toBe(true);
    expect(allocate(input(59, 18, m)).hidden).toContain('comm');
  });

  it('keeps a floating pane at least the frame plus its minimum content', () => {
    expect(floatMin('character', true)).toEqual({ w: 10, h: 5 });
    expect(floatMin('comm', false)).toEqual({ w: 8, h: 1 });
    expect(clampFloat({ x: 5, y: 5, w: 2, h: 2 }, floatMin('character', true), 100, 40)).toEqual({ x: 5, y: 5, w: 10, h: 5 });
  });
});
