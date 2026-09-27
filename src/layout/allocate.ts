// Layout allocation (ADR 0010 "Docking", ADR 0012, Inv §2.1 "Heights").
//
// A pure function from the layout model, the pane toggles and the viewport
// (in cells) to rectangles in cells. No DOM: src/layout/cockpit.ts turns
// the result into pixels once per frame.
//
// Screen (C × R cells):
//
//   +------+--+----------------------+--+---------+
//   | left |  |   top dock           |  |  right  |
//   | dock |g +----------------------+g |  dock   |
//   |      |a |      (gap row)       |a |         |
//   |      |p |        game          |p |         |
//   |      |  +----------------------+  |         |
//   |      |  | input line     clock |  |         |
//   |      |  +----------------------+  |         |
//   |      |  |      (gap row)       |  |         |
//   |      |  |   bottom dock        |  |         |
//   +------+--+----------------------+--+---------+
//
// - The centre column is, top to bottom: top dock, game pane, input line
//   (1 row, as wide as the game pane, clock strip at its right end),
//   bottom dock. The side docks run the full window height, beside the
//   input line and the bottom dock too (ADR 0012, ADR 0014 amendment).
// - One gap cell separates the game column from each shown side dock, and
//   one gap row separates the top dock from the game pane and the input
//   line from the bottom dock. The input line sits directly under the game
//   pane. Panes inside a dock touch (their frames separate them, as in
//   Cockpit).
// - Along a dock, panes get their `desired` content size if everything
//   fits, the leftover going to the highest-priority pane; otherwise
//   Character is reserved first and the rest scale between minimum and
//   desired; if even the minimums do not fit, panes are dropped in order
//   (`allocateAxis`). A framed pane adds two cells on each axis.
// - Narrow collapse: a side dock is hidden when the game pane would get
//   fewer than GAME_MIN_COLS columns. The model is untouched, so the dock
//   comes back as soon as the window is wide enough again.
// - Floating panes (ADR 0014) lie over everything else (the game pane, the
//   input line and the docks) and do not change the docked allocation.
//   Each is clamped into the window (shrunk if the window is smaller than
//   it) on every layout; the model keeps the stored rectangle.
// - Below MIN_VIEW_COLS × MIN_VIEW_ROWS the result is `tooSmall`.

import { DEFAULT_PANE_DESIRED, DEFAULT_SIDE_DOCK_SIZE, type DockId, type LayoutModel, PANE_IDS, type PaneId } from './types';

/** Smallest game pane (Inv §2.1 MAIN_MIN; ADR 0010). */
export const GAME_MIN_COLS = 30;
export const GAME_MIN_ROWS = 5;
/** Below this the "Window too small" screen replaces the view (Inv §2.1). */
export const MIN_VIEW_COLS = 60;
export const MIN_VIEW_ROWS = 18;
/** Cells a frame adds on each axis (top+bottom rows or left+right columns). */
export const FRAME_CELLS = 2;
/** Gap between the game column and a side dock, the top dock and the game pane, or the input line and the bottom dock. */
export const DOCK_GAP = 1;
/** Narrowest side dock and lowest top/bottom dock (cells, frame included). */
export const SIDE_DOCK_MIN = 10;
export const BOTTOM_DOCK_MIN = 3;
export const TOP_DOCK_MIN = 3;
/** Rows of the input line. */
export const INPUT_ROWS = 1;

/** Minimum content rows in a side dock (Inv §2.1 "Heights"). */
export const MIN_ROWS: Readonly<Record<PaneId, number>> = {
  character: 3,
  timers: 1,
  group: 1,
  comm: 1,
  ui: 1,
};
/** Minimum content columns in the top/bottom dock (ADR 0012). */
export const MIN_COLS = 8;
/** Desired content columns of a pane that enters the top/bottom dock (ADR 0012). */
export const DEFAULT_BOTTOM_DESIRED = 30;

/** Who gets the leftover cells first (Inv §2.1). */
export const LEFTOVER_PRIORITY: readonly PaneId[] = ['ui', 'character', 'comm', 'timers', 'group'];
/** Who is dropped first when even the minimums do not fit (Inv §2.1). */
export const DROP_ORDER: readonly PaneId[] = ['group', 'timers', 'comm', 'character', 'ui'];

/** True for the docks that stack panes vertically (left, right). */
export const isSideDock = (d: DockId): boolean => d === 'left' || d === 'right';

/** Minimum content size of `id` along the axis of `dock`. */
export function minContent(id: PaneId, dock: DockId): number {
  return isSideDock(dock) ? MIN_ROWS[id] : MIN_COLS;
}

/** Smallest floating pane (outer cells): the frame plus the pane's minimum content. */
export function floatMin(id: PaneId, framed: boolean): { w: number; h: number } {
  const f = framed ? FRAME_CELLS : 0;
  return { w: MIN_COLS + f, h: MIN_ROWS[id] + f };
}

/**
 * Outer size (frame included) a docked pane gets when it is dragged out to
 * float (ADR 0014 amendment); clamped to the window. A floating pane that
 * is moved keeps its size.
 */
export const FLOAT_STANDARD_W = 36;
export const FLOAT_STANDARD_H = 14;

/** Size of a pane that starts floating without a shown rectangle to copy (settings migration). */
export function defaultFloatSize(id: PaneId): { w: number; h: number } {
  return { w: DEFAULT_SIDE_DOCK_SIZE, h: DEFAULT_PANE_DESIRED[id] + FRAME_CELLS };
}

/**
 * The rectangle a floating pane shows at in a `cols` × `rows` area: at
 * least `min`, at most the area, moved inside it.
 */
export function clampFloat(r: Rect, min: { w: number; h: number }, cols: number, rows: number): Rect {
  const w = Math.max(1, Math.min(cols, Math.max(min.w, Math.round(r.w))));
  const h = Math.max(1, Math.min(rows, Math.max(min.h, Math.round(r.h))));
  const x = Math.max(0, Math.min(cols - w, Math.round(r.x)));
  const y = Math.max(0, Math.min(rows - h, Math.round(r.y)));
  return { x, y, w, h };
}

// ------------------------------------------------------------------ axis

export interface AxisItem {
  id: PaneId;
  /** Wanted content cells. */
  desired: number;
  /** Minimum content cells. */
  min: number;
  /** Cells the frame adds (0 or FRAME_CELLS). */
  frame: number;
}

export interface AxisResult {
  /** Content cells per surviving pane, in input order. */
  sizes: { id: PaneId; size: number }[];
  /** Panes that did not fit even at their minimum (DROP_ORDER). */
  dropped: PaneId[];
  /**
   * `fit`: every pane got at least its desired size. `scaled`: some got
   * less. `empty`: no pane survived.
   */
  mode: 'fit' | 'scaled' | 'empty';
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Splits `length` cells among `items` (Inv §2.1 "Heights"). The sizes plus
 * frames fill `length` exactly unless nothing survives.
 */
export function allocateAxis(items: readonly AxisItem[], length: number): AxisResult {
  const norm = items.map((it) => ({ ...it, desired: Math.max(it.min, Math.round(it.desired)) }));
  let live = norm;
  const dropped: PaneId[] = [];
  while (live.length > 0 && sum(live.map((i) => i.min + i.frame)) > length) {
    const victim = DROP_ORDER.find((id) => live.some((i) => i.id === id))!;
    dropped.push(victim);
    live = live.filter((i) => i.id !== victim);
  }
  if (live.length === 0) return { sizes: [], dropped, mode: 'empty' };

  const size = new Map<PaneId, number>();
  const frames = sum(live.map((i) => i.frame));
  const wanted = sum(live.map((i) => i.desired)) + frames;
  const byPriority = LEFTOVER_PRIORITY.filter((id) => live.some((i) => i.id === id));

  if (wanted <= length) {
    for (const i of live) size.set(i.id, i.desired);
    const top = byPriority[0]!;
    size.set(top, size.get(top)! + (length - wanted));
    return { sizes: live.map((i) => ({ id: i.id, size: size.get(i.id)! })), dropped, mode: 'fit' };
  }

  // Character reserved first (ADR 0137 in Cockpit), if that leaves the
  // others their minimums; the rest scale between minimum and desired.
  const ch = live.find((i) => i.id === 'character');
  let scaled = live;
  let avail = length - frames;
  if (ch && live.length > 1) {
    const othersMin = sum(live.filter((i) => i !== ch).map((i) => i.min));
    if (ch.desired + othersMin <= avail) {
      size.set(ch.id, ch.desired);
      scaled = live.filter((i) => i !== ch);
      avail -= ch.desired;
    }
  }
  const mins = sum(scaled.map((i) => i.min));
  const span = sum(scaled.map((i) => i.desired - i.min));
  const extra = avail - mins; // 0 ≤ extra < span here
  let given = 0;
  for (const i of scaled) {
    const e = span > 0 ? Math.floor(((i.desired - i.min) * extra) / span) : 0;
    size.set(i.id, i.min + e);
    given += e;
  }
  // Rounding remainder: one cell each, by priority, never past desired.
  let rest = extra - given;
  while (rest > 0) {
    let moved = false;
    for (const id of byPriority) {
      const it = scaled.find((i) => i.id === id);
      if (!it || rest === 0) continue;
      if (size.get(id)! < it.desired) {
        size.set(id, size.get(id)! + 1);
        rest--;
        moved = true;
      }
    }
    if (!moved) {
      const top = byPriority[0]!;
      size.set(top, size.get(top)! + rest);
      rest = 0;
    }
  }
  return { sizes: live.map((i) => ({ id: i.id, size: size.get(i.id)! })), dropped, mode: 'scaled' };
}

// ---------------------------------------------------------------- screen

/** A rectangle in cells. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PaneToggle {
  on: boolean;
  border: boolean;
}

export interface AllocateInput {
  layout: LayoutModel;
  panes: Readonly<Record<PaneId, PaneToggle>>;
  /** Viewport in whole cells. */
  cols: number;
  rows: number;
}

export interface PaneBox {
  id: PaneId;
  /** The dock, or `float` for a floating pane. */
  dock: DockId | 'float';
  /** Index of the pane in the dock's model list (or in `floating`: its z-order). */
  index: number;
  /** Outer rectangle (frame included). */
  rect: Rect;
  /** Content rectangle (the rect minus the frame). */
  content: Rect;
  framed: boolean;
}

export interface DockBox {
  id: DockId;
  rect: Rect;
  /** Shown panes in order. */
  panes: PaneId[];
  /** `fit` or `scaled` (see AxisResult). */
  mode: 'fit' | 'scaled';
}

export interface LayoutResult {
  cols: number;
  rows: number;
  /** The viewport is below MIN_VIEW_COLS × MIN_VIEW_ROWS; nothing else is laid out. */
  tooSmall: boolean;
  game: Rect;
  input: Rect;
  /** Shown docks only. */
  docks: Partial<Record<DockId, DockBox>>;
  /** Docks with panes switched on that are hidden for lack of space. */
  collapsed: DockId[];
  /**
   * Shown panes, dock by dock (left, right, top, bottom), in stack order,
   * then the floating panes bottom to top.
   */
  panes: PaneBox[];
  /** Panes switched on but not shown: dropped by allocation or in a collapsed dock. */
  hidden: PaneId[];
}

const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };

function axisItems(input: AllocateInput, dock: DockId): AxisItem[] {
  return input.layout.docks[dock].panes
    .filter((p) => input.panes[p.id]?.on)
    .map((p) => ({
      id: p.id,
      desired: p.desired,
      min: minContent(p.id, dock),
      frame: input.panes[p.id].border ? FRAME_CELLS : 0,
    }));
}

/** Lays out the whole screen (see the file header). */
export function allocate(input: AllocateInput): LayoutResult {
  const cols = Math.max(0, Math.floor(input.cols));
  const rows = Math.max(0, Math.floor(input.rows));
  const res: LayoutResult = {
    cols,
    rows,
    tooSmall: false,
    game: EMPTY,
    input: { x: 0, y: Math.max(0, rows - INPUT_ROWS), w: cols, h: Math.min(rows, INPUT_ROWS) },
    docks: {},
    collapsed: [],
    panes: [],
    hidden: [],
  };
  if (cols < MIN_VIEW_COLS || rows < MIN_VIEW_ROWS) {
    res.tooSmall = true;
    res.game = { x: 0, y: 0, w: cols, h: Math.max(0, rows - INPUT_ROWS) };
    res.hidden = PANE_IDS.filter((id) => input.panes[id]?.on);
    return res;
  }

  const items: Record<DockId, AxisItem[]> = {
    left: axisItems(input, 'left'),
    right: axisItems(input, 'right'),
    top: axisItems(input, 'top'),
    bottom: axisItems(input, 'bottom'),
  };
  const sideW = (d: DockId): number => Math.max(SIDE_DOCK_MIN, input.layout.docks[d].size);
  const need = (d: DockId, on: boolean): number => (on && items[d].length > 0 ? sideW(d) + DOCK_GAP : 0);

  // Narrow collapse: keep both, else the right, else the left, else none.
  let showL = items.left.length > 0;
  let showR = items.right.length > 0;
  const fits = (l: boolean, r: boolean): boolean => cols - need('left', l) - need('right', r) >= GAME_MIN_COLS;
  if (!fits(showL, showR)) {
    if (showR && fits(false, true)) showL = false;
    else if (showL && fits(true, false)) showR = false;
    else showL = showR = false;
  }
  for (const [d, shown] of [['left', showL], ['right', showR]] as const) {
    if (!shown && items[d].length > 0) {
      res.collapsed.push(d);
      res.hidden.push(...items[d].map((i) => i.id));
    }
  }

  const leftW = showL ? sideW('left') : 0;
  const rightW = showR ? sideW('right') : 0;
  const gx = showL ? leftW + DOCK_GAP : 0;
  const gw = cols - gx - (showR ? rightW + DOCK_GAP : 0);

  // Top and bottom docks: they shrink to keep the game pane GAME_MIN_ROWS
  // high above the input row, which is never dropped. The bottom dock is
  // sized first; if that leaves the top dock less than its minimum, the
  // bottom dock gives up rows down to its own minimum. A dock that still
  // gets less than its minimum is collapsed.
  const avail = rows - INPUT_ROWS - GAME_MIN_ROWS;
  const size = (d: DockId): number => input.layout.docks[d].size;
  let bottomH = items.bottom.length > 0 ? Math.min(size('bottom'), avail - DOCK_GAP) : 0;
  if (bottomH < BOTTOM_DOCK_MIN) bottomH = 0;
  let topH = 0;
  if (items.top.length > 0) {
    topH = Math.min(size('top'), avail - DOCK_GAP - (bottomH > 0 ? bottomH + DOCK_GAP : 0));
    if (topH < TOP_DOCK_MIN && bottomH > 0) {
      const b = avail - 2 * DOCK_GAP - TOP_DOCK_MIN;
      if (b >= BOTTOM_DOCK_MIN && size('top') >= TOP_DOCK_MIN) {
        bottomH = Math.min(bottomH, b);
        topH = Math.min(size('top'), avail - 2 * DOCK_GAP - bottomH);
      }
    }
    if (topH < TOP_DOCK_MIN) topH = 0;
  }
  for (const [d, h] of [['top', topH], ['bottom', bottomH]] as const) {
    if (h === 0 && items[d].length > 0) {
      res.collapsed.push(d);
      res.hidden.push(...items[d].map((i) => i.id));
    }
  }
  const gy = topH > 0 ? topH + DOCK_GAP : 0;
  const below = bottomH > 0 ? bottomH + DOCK_GAP : 0;
  res.game = { x: gx, y: gy, w: gw, h: rows - gy - INPUT_ROWS - below };
  res.input = { x: gx, y: rows - below - INPUT_ROWS, w: gw, h: INPUT_ROWS };

  const place = (dock: DockId, rect: Rect): void => {
    const side = isSideDock(dock);
    const ax = allocateAxis(items[dock], side ? rect.h : rect.w);
    res.hidden.push(...ax.dropped);
    if (ax.mode === 'empty') return;
    res.docks[dock] = { id: dock, rect, panes: ax.sizes.map((s) => s.id), mode: ax.mode };
    const model = input.layout.docks[dock].panes;
    let at = side ? rect.y : rect.x;
    for (const { id, size } of ax.sizes) {
      const framed = input.panes[id].border;
      const f = framed ? FRAME_CELLS : 0;
      const len = size + f;
      const r: Rect = side
        ? { x: rect.x, y: at, w: rect.w, h: len }
        : { x: at, y: rect.y, w: len, h: rect.h };
      const c: Rect = framed
        ? { x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }
        : { ...r };
      res.panes.push({ id, dock, index: model.findIndex((p) => p.id === id), rect: r, content: c, framed });
      at += len;
    }
  };
  if (showL) place('left', { x: 0, y: 0, w: leftW, h: rows });
  if (showR) place('right', { x: cols - rightW, y: 0, w: rightW, h: rows });
  if (topH > 0) place('top', { x: gx, y: 0, w: gw, h: topH });
  if (bottomH > 0) place('bottom', { x: gx, y: rows - bottomH, w: gw, h: bottomH });

  input.layout.floating.forEach((f, index) => {
    const t = input.panes[f.id];
    if (!t?.on) return;
    const framed = t.border;
    const r = clampFloat(f, floatMin(f.id, framed), cols, rows);
    const c: Rect = framed ? { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 } : { ...r };
    res.panes.push({ id: f.id, dock: 'float', index, rect: r, content: c, framed });
  });
  return res;
}
