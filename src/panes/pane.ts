// Pane shell (ADR 0010 "Consequences", ADR 0012): the element a side pane
// lives in. The cockpit (src/layout/cockpit.ts) positions it and draws its
// frame; later stages fill `content` and listen to `onResize`.
//
//   .wc-pane.wc-pane-<id>          positioned in whole cells, --pane-* tokens
//     .wc-pane-frame               the glyph frame (absent text when border off)
//     .wc-pane-content             the inner area, `cols` × `rows` cells
//
// Stage 2 panes are empty, like Cockpit's panes while disconnected.

import { applyPaneTheme } from '../theme/apply';
import type { Settings } from '../settings/types';
import type { Rect } from '../layout/allocate';
import { PANE_LABELS, type PaneId } from '../layout/types';
import { frameText } from './frame';

export type PaneResizeListener = (cols: number, rows: number) => void;

/** z-index of the backmost floating pane; the others stack above it. */
export const FLOAT_Z = 10;

/** Where and how the cockpit shows a pane (cells), or null when hidden. */
export interface PanePlacement {
  rect: Rect;
  content: Rect;
  framed: boolean;
  /** Set for a floating pane: its z-order (0 = backmost). */
  floating?: number;
}

export class PaneShell {
  readonly id: PaneId;
  readonly label: string;
  /** Outer element, positioned by the cockpit. */
  readonly el: HTMLDivElement;
  /** Content element: later stages render into it. */
  readonly content: HTMLDivElement;
  private readonly frameEl: HTMLDivElement;
  private readonly listeners = new Set<PaneResizeListener>();
  private frameKey = '';
  private _cols = 0;
  private _rows = 0;
  private _visible = false;

  constructor(doc: Document, id: PaneId) {
    this.id = id;
    this.label = PANE_LABELS[id];
    this.el = doc.createElement('div');
    this.el.className = `wc-pane wc-pane-${id}`;
    this.el.dataset.pane = id;
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', this.label);
    this.el.hidden = true;
    this.frameEl = doc.createElement('div');
    this.frameEl.className = 'wc-pane-frame';
    this.frameEl.setAttribute('aria-hidden', 'true');
    this.content = doc.createElement('div');
    this.content.className = 'wc-pane-content';
    this.el.append(this.frameEl, this.content);
  }

  /** Inner width in cells (0 while hidden). */
  get cols(): number {
    return this._cols;
  }

  /** Inner height in cells (0 while hidden). */
  get rows(): number {
    return this._rows;
  }

  /** True while the pane is on screen. */
  get visible(): boolean {
    return this._visible;
  }

  /**
   * Calls `fn(cols, rows)` whenever the inner size changes (0 × 0 when the
   * pane is hidden). Returns the unsubscribe function.
   */
  onResize(fn: PaneResizeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Re-applies the pane colour tokens (every settings change). */
  applyTheme(s: Readonly<Settings>): void {
    applyPaneTheme(this.el, s, this.id);
  }

  /** Cockpit only: shows the pane at `p` (cells × `cell` px) or hides it. */
  place(p: PanePlacement | null, cell: { w: number; h: number }): void {
    if (!p) {
      this.el.hidden = true;
      this._visible = false;
      this.setSize(0, 0);
      return;
    }
    const { rect, content } = p;
    const st = this.el.style;
    st.left = `${rect.x * cell.w}px`;
    st.top = `${rect.y * cell.h}px`;
    st.width = `${rect.w * cell.w}px`;
    st.height = `${rect.h * cell.h}px`;
    const cs = this.content.style;
    cs.left = `${(content.x - rect.x) * cell.w}px`;
    cs.top = `${(content.y - rect.y) * cell.h}px`;
    cs.width = `${content.w * cell.w}px`;
    cs.height = `${content.h * cell.h}px`;
    const key = p.framed ? `${rect.w}x${rect.h}` : '';
    if (key !== this.frameKey) {
      this.frameKey = key;
      this.frameEl.textContent = p.framed ? frameText(rect.w, rect.h, this.label) : '';
    }
    this.el.toggleAttribute('data-framed', p.framed);
    this.el.toggleAttribute('data-floating', p.floating !== undefined);
    st.zIndex = p.floating === undefined ? '' : String(FLOAT_Z + p.floating);
    this.el.hidden = false;
    this._visible = true;
    this.setSize(content.w, content.h);
  }

  private setSize(cols: number, rows: number): void {
    if (cols === this._cols && rows === this._rows) return;
    this._cols = cols;
    this._rows = rows;
    for (const fn of [...this.listeners]) fn(cols, rows);
  }
}

/**
 * One shell per pane. Stage 2 panes are all plain shells; later stages
 * swap in their own subclasses here.
 */
export const PANE_FACTORIES: Readonly<Record<PaneId, (doc: Document) => PaneShell>> = {
  character: (doc) => new PaneShell(doc, 'character'),
  timers: (doc) => new PaneShell(doc, 'timers'),
  group: (doc) => new PaneShell(doc, 'group'),
  comm: (doc) => new PaneShell(doc, 'comm'),
  ui: (doc) => new PaneShell(doc, 'ui'),
};
