// Cockpit view (ADR 0010 "Docking", ADR 0012): the game pane, the docks
// with their panes and the input line, positioned absolutely in whole
// cells from `allocate()`.
//
//   .wc-cockpit
//     .wc-game          the output pane (src/ui/output-pane.ts) goes in here
//     .wc-pane × 5      pane shells (src/panes/pane.ts)
//     .wc-input-slot    the input line (src/ui/input-pane.ts) goes in here
//     .wc-handles       invisible resize handles over the gaps and frames
//     .wc-drop-bar      insertion bar while a pane is dragged
//     .wc-too-small     "Window too small" (below 60 × 18 cells)
//
// Relayout is one atomic pass per animation frame after a size change of
// the cockpit element (window resize, padding), a cell size change or a
// settings change. Game output never triggers it: the game pane has a
// fixed size and `contain: strict`, so new lines lay out only inside it.
// NAWS follows from the output pane's own ResizeObserver when the game
// pane's size changes.
//
// Pointer interaction (no animation):
// - Drag a pane by its title row (the frame's top row; with the border off,
//   the top content row) to a dock or a position in a dock. The insertion
//   bar shows where it lands. Dropping on the screen edge of a dock that is
//   not shown opens that dock at its default size.
// - Drag the gap between the game pane and a dock to resize the dock, or
//   the boundary between two panes (the lower part of the upper pane's last
//   row, or the right part of the left pane's last column) to resize them.
// - Every drag previews live and writes the settings once, on release.
// - Grips and handles never take focus; after a drag or a click the focus
//   goes back to the input (Inv §1.3).

import './layout.css';
import { PANE_FACTORIES, type PaneShell } from '../panes/pane';
import type { SettingsStore } from '../settings';
import {
  BOTTOM_DOCK_MIN,
  DOCK_GAP,
  GAME_MIN_COLS,
  GAME_MIN_ROWS,
  INPUT_ROWS,
  type LayoutResult,
  MIN_VIEW_COLS,
  MIN_VIEW_ROWS,
  type PaneBox,
  type Rect,
  SIDE_DOCK_MIN,
  TOP_DOCK_MIN,
  allocate,
  isSideDock,
} from './allocate';
import { isNoopMove, movePane, setDesired, setDockSize, shiftBoundary } from './model';
import {
  type DockId,
  defaultDockSize,
  type LayoutModel,
  PANE_IDS,
  type PaneId,
} from './types';

/** The cell size source (src/theme/cells.ts `CellMetrics` fits). */
export interface CellSource {
  get(): { w: number; h: number };
  subscribe(fn: (c: { w: number; h: number }) => void): () => void;
}

export interface CockpitOptions {
  /** Parent element; the cockpit fills it. */
  root: HTMLElement;
  settings: SettingsStore;
  cells: CellSource;
  /** Returns the focus to the input line. */
  onFocusInput?: () => void;
  /** Frame scheduler (default requestAnimationFrame). */
  requestFrame?: (cb: () => void) => void;
}

/** Where a dragged pane would land. `bar` is in px relative to the cockpit. */
export interface DropTarget {
  dock: DockId;
  index: number;
  /** The dock is not shown now; the drop opens it at its default size. */
  open: boolean;
  bar: Rect;
}

/** Pointer travel (px) before a press on a title row becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Width in cells of the screen-edge zone that opens a hidden dock. */
const EDGE_CELLS = 2;

type Drag =
  | { kind: 'move'; id: PaneId; pointerId: number; x0: number; y0: number; active: boolean; target: DropTarget | null }
  | { kind: 'dock'; dock: DockId; pointerId: number; base: LayoutModel }
  | {
      kind: 'panes';
      dock: DockId;
      pointerId: number;
      a: { id: PaneId; size: number };
      b: { id: PaneId; size: number };
      cell0: number;
      base: LayoutModel;
    };

export class Cockpit {
  readonly el: HTMLDivElement;
  /** The game pane's container. */
  readonly gameEl: HTMLDivElement;
  /** The input line's container. */
  readonly inputEl: HTMLDivElement;
  private readonly handlesEl: HTMLDivElement;
  private readonly barEl: HTMLDivElement;
  private readonly tooSmallEl: HTMLDivElement;
  private readonly shells = new Map<PaneId, PaneShell>();
  private readonly settings: SettingsStore;
  private readonly cells: CellSource;
  private readonly onFocusInput: () => void;
  private readonly requestFrame: (cb: () => void) => void;
  private readonly unsubs: (() => void)[] = [];
  private readonly ro: ResizeObserver | null = null;
  private last: LayoutResult | null = null;
  private preview: LayoutModel | null = null;
  private drag: Drag | null = null;
  private scheduled = false;
  private disposed = false;
  private wasTooSmall = false;
  /** Set by a handled pointerdown so the following mousedown keeps the focus. */
  private swallowMouseDown = false;

  constructor(opts: CockpitOptions) {
    const doc = opts.root.ownerDocument;
    this.settings = opts.settings;
    this.cells = opts.cells;
    this.onFocusInput = opts.onFocusInput ?? (() => {});
    this.requestFrame =
      opts.requestFrame ??
      (typeof requestAnimationFrame === 'function'
        ? (cb) => void requestAnimationFrame(() => cb())
        : (cb) => void setTimeout(cb, 0));

    const div = (cls: string): HTMLDivElement => {
      const d = doc.createElement('div');
      d.className = cls;
      return d;
    };
    this.el = div('wc-cockpit');
    this.gameEl = div('wc-game');
    this.inputEl = div('wc-input-slot');
    this.handlesEl = div('wc-handles');
    this.barEl = div('wc-drop-bar');
    this.barEl.hidden = true;
    this.tooSmallEl = div('wc-too-small');
    this.tooSmallEl.hidden = true;
    this.el.append(this.gameEl);
    for (const id of PANE_IDS) {
      const shell = PANE_FACTORIES[id](doc);
      const grip = div('wc-pane-grip');
      grip.dataset.grip = id;
      shell.el.append(grip);
      this.shells.set(id, shell);
      this.el.append(shell.el);
    }
    this.el.append(this.inputEl, this.handlesEl, this.barEl, this.tooSmallEl);
    opts.root.appendChild(this.el);

    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointermove', this.onPointerMove);
    this.el.addEventListener('pointerup', this.onPointerUp);
    this.el.addEventListener('pointercancel', this.onPointerCancel);
    this.el.addEventListener('lostpointercapture', this.onPointerCancel);
    this.el.addEventListener('mousedown', this.onMouseDown);
    this.el.addEventListener('mouseup', this.onMouseUp);

    this.unsubs.push(
      this.settings.subscribe(() => this.scheduleRelayout()),
      this.cells.subscribe(() => this.scheduleRelayout()),
    );
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.scheduleRelayout());
      this.ro.observe(this.el);
    }
    this.relayoutNow();
  }

  /** The shell of pane `id` (content element, size, onResize). */
  pane(id: PaneId): PaneShell {
    return this.shells.get(id)!;
  }

  /** The last layout (cells), or null before the cockpit has a size. */
  get layout(): LayoutResult | null {
    return this.last;
  }

  /** Relayouts in the next animation frame (coalesced). */
  scheduleRelayout(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    this.requestFrame(() => {
      this.scheduled = false;
      if (!this.disposed) this.relayoutNow();
    });
  }

  /** Relayouts at once. */
  relayoutNow(): void {
    const cell = this.cells.get();
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    if (!(W > 0 && H > 0 && cell.w > 0 && cell.h > 0)) return;
    const s = this.settings.get();
    const r = allocate({
      layout: this.preview ?? s.layout,
      panes: s.panes,
      cols: Math.floor(W / cell.w + 1e-6),
      rows: Math.floor(H / cell.h + 1e-6),
    });
    this.last = r;
    this.el.dataset.cells = `${r.cols}x${r.rows}`;
    this.el.dataset.collapsed = r.collapsed.join(' ');
    this.setTooSmall(r);

    placeEl(this.gameEl, r.game, cell);
    placeEl(this.inputEl, r.input, cell);
    const boxes = new Map(r.panes.map((p) => [p.id, p]));
    for (const [id, shell] of this.shells) {
      shell.applyTheme(s);
      const b = boxes.get(id);
      shell.place(b ? { rect: b.rect, content: b.content, framed: b.framed } : null, cell);
    }
    this.renderHandles(r, cell);
  }

  /** Stops listening and removes the cockpit. */
  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.ro?.disconnect();
    this.el.remove();
  }

  // ---------------------------------------------------------------- render

  private setTooSmall(r: LayoutResult): void {
    const small = r.tooSmall;
    if (small) {
      this.tooSmallEl.textContent =
        `Window too small\n\n` +
        `${r.cols} × ${r.rows} cells, needs ${MIN_VIEW_COLS} × ${MIN_VIEW_ROWS}.\n` +
        `Enlarge the window or make the font smaller.`;
    }
    if (small === this.wasTooSmall) return;
    const hadFocus = this.el.contains(this.el.ownerDocument.activeElement);
    this.wasTooSmall = small;
    this.tooSmallEl.hidden = !small;
    this.el.toggleAttribute('data-too-small', small);
    for (const child of [this.gameEl, this.inputEl, ...[...this.shells.values()].map((s) => s.el)]) {
      child.inert = small;
    }
    if (small) this.cancelDrag();
    else if (hadFocus || this.el.ownerDocument.activeElement === this.el.ownerDocument.body) this.onFocusInput();
  }

  private renderHandles(r: LayoutResult, cell: { w: number; h: number }): void {
    const doc = this.el.ownerDocument;
    const frag = doc.createDocumentFragment();
    const add = (rect: Rect, axis: 'x' | 'y', data: Record<string, string>): void => {
      const h = doc.createElement('div');
      h.className = 'wc-handle';
      h.dataset.axis = axis;
      Object.assign(h.dataset, data);
      const st = h.style;
      st.left = `${rect.x}px`;
      st.top = `${rect.y}px`;
      st.width = `${rect.w}px`;
      st.height = `${rect.h}px`;
      frag.append(h);
    };
    if (!r.tooSmall) {
      const hz = Math.max(4, Math.round(cell.h * 0.4));
      const wz = Math.max(3, Math.round(cell.w * 0.4));
      for (const dock of Object.values(r.docks)) {
        const d = dock.rect;
        if (dock.id === 'right') {
          add({ x: (d.x - DOCK_GAP) * cell.w, y: 0, w: DOCK_GAP * cell.w, h: d.h * cell.h }, 'x', { dock: 'right' });
        } else if (dock.id === 'left') {
          add({ x: (d.x + d.w) * cell.w, y: 0, w: DOCK_GAP * cell.w, h: d.h * cell.h }, 'x', { dock: 'left' });
        } else if (dock.id === 'top') {
          add({ x: d.x * cell.w, y: (d.y + d.h) * cell.h, w: d.w * cell.w, h: DOCK_GAP * cell.h }, 'y', { dock: 'top' });
        } else {
          add({ x: d.x * cell.w, y: (d.y - DOCK_GAP) * cell.h, w: d.w * cell.w, h: DOCK_GAP * cell.h }, 'y', {
            dock: 'bottom',
          });
        }
        const boxes = r.panes.filter((p) => p.dock === dock.id);
        for (let i = 0; i + 1 < boxes.length; i++) {
          const a = boxes[i]!;
          const b = boxes[i + 1]!;
          const data = { dock: dock.id, a: a.id, b: b.id };
          if (isSideDock(dock.id)) {
            add({ x: d.x * cell.w, y: b.rect.y * cell.h - hz, w: d.w * cell.w, h: hz }, 'y', data);
          } else {
            add({ x: b.rect.x * cell.w - wz, y: d.y * cell.h, w: wz, h: d.h * cell.h }, 'x', data);
          }
        }
      }
    }
    this.handlesEl.replaceChildren(frag);
  }

  // ------------------------------------------------------------- pointers

  private local(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.swallowMouseDown = false;
    if (e.button !== 0 || this.drag || !this.last || this.last.tooSmall) return;
    const t = e.target as HTMLElement;
    const grip = t.closest<HTMLElement>('.wc-pane-grip');
    const handle = t.closest<HTMLElement>('.wc-handle');
    const { x, y } = this.local(e);
    if (grip) {
      this.drag = { kind: 'move', id: grip.dataset.grip as PaneId, pointerId: e.pointerId, x0: x, y0: y, active: false, target: null };
    } else if (handle) {
      const dock = handle.dataset.dock as DockId;
      const base = this.settings.get().layout;
      if (handle.dataset.a && handle.dataset.b) {
        const box = (id: string): PaneBox | undefined => this.last!.panes.find((p) => p.id === id);
        const a = box(handle.dataset.a);
        const b = box(handle.dataset.b);
        if (!a || !b) return;
        const side = isSideDock(dock);
        const size = (p: PaneBox): number => (side ? p.content.h : p.content.w);
        const cell = this.cells.get();
        // A dock that is short of space is frozen at what it shows now, so
        // the boundary follows the pointer exactly (ADR 0012).
        let frozen = base;
        if (this.last.docks[dock]?.mode === 'scaled') {
          const all: Partial<Record<PaneId, number>> = {};
          for (const p of this.last.panes) if (p.dock === dock) all[p.id] = size(p);
          frozen = setDesired(base, all);
        }
        this.drag = {
          kind: 'panes',
          dock,
          pointerId: e.pointerId,
          a: { id: a.id, size: size(a) },
          b: { id: b.id, size: size(b) },
          cell0: side ? Math.floor(y / cell.h) : Math.floor(x / cell.w),
          base: frozen,
        };
      } else {
        this.drag = { kind: 'dock', dock, pointerId: e.pointerId, base };
      }
      this.el.dataset.drag = handle.dataset.axis!;
    } else {
      return;
    }
    this.swallowMouseDown = true;
    e.preventDefault();
    try {
      // On the cockpit itself: handles are re-created by every relayout.
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    // Grips, handles and the gaps between panes never take the focus.
    if (this.swallowMouseDown || e.target === this.el || e.target === this.handlesEl) e.preventDefault();
    this.swallowMouseDown = false;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (this.drag) return;
    const t = e.target as HTMLElement;
    if (t.closest('.wc-output, .wc-input-slot')) return; // they handle their own
    const sel = this.el.ownerDocument.getSelection();
    if (sel && !sel.isCollapsed && this.el.contains(sel.anchorNode)) return;
    this.onFocusInput();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId || !this.last) return;
    const { x, y } = this.local(e);
    const cell = this.cells.get();
    const r = this.last;
    if (d.kind === 'move') {
      if (!d.active) {
        if (Math.hypot(x - d.x0, y - d.y0) < DRAG_THRESHOLD) return;
        d.active = true;
        this.el.dataset.drag = 'move';
        this.shells.get(d.id)!.el.toggleAttribute('data-dragging', true);
      }
      d.target = this.dropTarget(x, y, d.id);
      this.showBar(d.target);
      return;
    }
    if (d.kind === 'dock') {
      const H = r.rows - INPUT_ROWS;
      let size: number;
      let min: number;
      let max: number;
      if (d.dock === 'bottom' || d.dock === 'top') {
        // The other of the two keeps what it shows now.
        const other = r.docks[d.dock === 'bottom' ? 'top' : 'bottom'];
        const row = Math.floor(y / cell.h);
        size = d.dock === 'bottom' ? H - DOCK_GAP - row : row;
        min = d.dock === 'bottom' ? BOTTOM_DOCK_MIN : TOP_DOCK_MIN;
        max = H - DOCK_GAP - GAME_MIN_ROWS - (other ? other.rect.h + DOCK_GAP : 0);
      } else {
        const col = Math.floor(x / cell.w);
        size = d.dock === 'right' ? r.cols - DOCK_GAP - col : col;
        const other = r.docks[d.dock === 'right' ? 'left' : 'right'];
        min = SIDE_DOCK_MIN;
        max = r.cols - GAME_MIN_COLS - DOCK_GAP - (other ? other.rect.w + DOCK_GAP : 0);
      }
      if (max < min) return;
      this.setPreview(setDockSize(d.base, d.dock, Math.max(min, Math.min(max, size))));
      return;
    }
    const side = isSideDock(d.dock);
    const delta = (side ? Math.floor(y / cell.h) : Math.floor(x / cell.w)) - d.cell0;
    const n = shiftBoundary(d.a, d.b, d.dock, delta);
    this.setPreview(setDesired(d.base, { [d.a.id]: n.a, [d.b.id]: n.b }));
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.kind === 'move') {
      if (d.active && d.target) {
        const t = d.target;
        this.settings.update((draft) => {
          let m = movePane(draft.layout, d.id, t.dock, t.index);
          if (t.open) m = setDockSize(m, t.dock, defaultDockSize(t.dock));
          draft.layout = m;
        });
      }
    } else if (this.preview) {
      const m = this.preview;
      this.settings.update((draft) => {
        draft.layout = m;
      });
    }
    this.endDrag();
    this.onFocusInput();
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) {
      // lostpointercapture also follows a normal pointerup, which already ended the drag.
      this.cancelDrag();
    }
  };

  private cancelDrag(): void {
    if (!this.drag) return;
    this.endDrag();
  }

  private endDrag(): void {
    this.drag = null;
    this.preview = null;
    this.barEl.hidden = true;
    delete this.el.dataset.drag;
    for (const s of this.shells.values()) s.el.removeAttribute('data-dragging');
    this.scheduleRelayout();
  }

  private setPreview(m: LayoutModel): void {
    if (this.preview && JSON.stringify(this.preview) === JSON.stringify(m)) return;
    this.preview = m;
    this.scheduleRelayout();
  }

  private showBar(t: DropTarget | null): void {
    if (!t) {
      this.barEl.hidden = true;
      return;
    }
    const st = this.barEl.style;
    st.left = `${t.bar.x}px`;
    st.top = `${t.bar.y}px`;
    st.width = `${t.bar.w}px`;
    st.height = `${t.bar.h}px`;
    this.barEl.dataset.dock = t.dock;
    this.barEl.hidden = false;
  }

  /** Where a pane dragged to (x, y) px would land, or null (drop cancels). */
  dropTarget(x: number, y: number, id: PaneId): DropTarget | null {
    const r = this.last;
    if (!r || r.tooSmall) return null;
    const cell = this.cells.get();
    const cx = x / cell.w;
    const cy = y / cell.h;
    const H = r.rows - INPUT_ROWS;
    const T = Math.max(2, Math.round(cell.h / 4));
    const layout = this.settings.get().layout;
    const W = r.cols * cell.w;
    const clampBar = (b: Rect): Rect => {
      const bx = Math.max(0, Math.min(W - b.w, b.x));
      const by = Math.max(0, Math.min(H * cell.h - b.h, b.y));
      return { ...b, x: bx, y: by };
    };

    for (const dock of Object.values(r.docks)) {
      const d = dock.rect;
      if (cx < d.x || cx >= d.x + d.w || cy < d.y || cy >= d.y + d.h) continue;
      const side = isSideDock(dock.id);
      const boxes = r.panes.filter((p) => p.dock === dock.id);
      const lastBox = boxes[boxes.length - 1]!;
      let index = lastBox.index + 1;
      let at = side ? lastBox.rect.y + lastBox.rect.h : lastBox.rect.x + lastBox.rect.w;
      for (const b of boxes) {
        const mid = side ? b.rect.y + b.rect.h / 2 : b.rect.x + b.rect.w / 2;
        if ((side ? cy : cx) < mid) {
          index = b.index;
          at = side ? b.rect.y : b.rect.x;
          break;
        }
      }
      if (isNoopMove(layout, id, dock.id, index)) return null;
      const bar = side
        ? { x: d.x * cell.w, y: at * cell.h - T / 2, w: d.w * cell.w, h: T }
        : { x: at * cell.w - T / 2, y: d.y * cell.h, w: T, h: d.h * cell.h };
      return { dock: dock.id, index, open: false, bar: clampBar(bar) };
    }

    // Screen-edge zones of docks that are not shown (and not collapsed).
    const open = (dock: DockId, bar: Rect): DropTarget => ({
      dock,
      index: layout.docks[dock].panes.length,
      open: true,
      bar,
    });
    const E = EDGE_CELLS;
    const hidden = (dock: DockId): boolean => !r.docks[dock] && !r.collapsed.includes(dock);
    if (cy < H) {
      if (hidden('left') && cx < E) return open('left', { x: 0, y: 0, w: 2 * T, h: H * cell.h });
      if (hidden('right') && cx >= r.cols - E) return open('right', { x: W - 2 * T, y: 0, w: 2 * T, h: H * cell.h });
      const inGameCol = cx >= r.game.x && cx < r.game.x + r.game.w;
      if (hidden('top') && cy < E && inGameCol) {
        return open('top', { x: r.game.x * cell.w, y: 0, w: r.game.w * cell.w, h: 2 * T });
      }
      if (hidden('bottom') && cy >= H - E && inGameCol) {
        return open('bottom', { x: r.game.x * cell.w, y: H * cell.h - 2 * T, w: r.game.w * cell.w, h: 2 * T });
      }
    }
    return null;
  }
}

function placeEl(el: HTMLElement, r: Rect, cell: { w: number; h: number }): void {
  const st = el.style;
  st.left = `${r.x * cell.w}px`;
  st.top = `${r.y * cell.h}px`;
  st.width = `${r.w * cell.w}px`;
  st.height = `${r.h * cell.h}px`;
}
