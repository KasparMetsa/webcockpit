// A bottom-anchored list scrolled by item (Inv §2.4 "Scroll", §2.7.5): the
// Comm and UI panes' message lists. CSS wraps the items; the list decides
// which items to build and measures what the browser laid out.
//
//   .wc-alist                 flex: 1, overflow hidden, position relative
//     .wc-alist-stack         absolute, bottom 0: the items, newest last
//   .wc-alist-more            the `↓ N newer messages` row (hidden when live)
//
// - `offset` counts items hidden below the view; 0 = live (the newest item
//   sits on the bottom edge; an item taller than the view clips at the top).
// - Wheel up +1, down −1. Up stops when the oldest item is at the top with
//   no blank space above it (checked with the measured heights).
// - `added(n)` while scrolled grows the offset by n, so the view stays put.
// - The indicator row takes one row below the list; a mouse down on it
//   returns to live.
// - Only the items that can show are built: at most `rows + 1` (every item
//   is at least one row high).
//
// Measuring reads layout (once per render, the pane's frame). Tests inject
// `ListMetrics`.

/** How the list reads heights (px). */
export interface ListMetrics {
  itemHeight(el: HTMLElement): number;
  listHeight(list: HTMLElement): number;
}

const DOM_METRICS: ListMetrics = {
  itemHeight: (el) => el.getBoundingClientRect().height,
  listHeight: (list) => list.clientHeight,
};

/** Wheel movement (px) that counts as one step; a notch is one step at most. */
export const WHEEL_STEP_PX = 40;

export class AnchoredList {
  /** The list area (flex item). */
  readonly el: HTMLDivElement;
  /** The indicator row; the owner places it below `el`. */
  readonly more: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly onChange: () => void;
  private readonly metrics: ListMetrics;
  private readonly cellH: () => number;
  private _offset = 0;
  private canUp = false;
  private wheelAcc = 0;
  private count = 0;

  constructor(
    doc: Document,
    onChange: () => void,
    opts: { metrics?: ListMetrics; cellHeight?: () => number } = {},
  ) {
    this.onChange = onChange;
    this.metrics = opts.metrics ?? DOM_METRICS;
    this.cellH = opts.cellHeight ?? (() => 16);
    this.el = doc.createElement('div');
    this.el.className = 'wc-alist';
    this.stack = doc.createElement('div');
    this.stack.className = 'wc-alist-stack';
    this.el.append(this.stack);
    this.more = doc.createElement('div');
    this.more.className = 'wc-alist-more';
    this.more.hidden = true;
    this.el.addEventListener('wheel', this.onWheel, { passive: true });
    this.more.addEventListener('mousedown', this.onMore);
  }

  /** Items hidden below the view (0 = live). */
  get offset(): number {
    return this._offset;
  }

  /** True while scrolled back. */
  get scrolled(): boolean {
    return this._offset > 0;
  }

  /** `n` items were appended; while scrolled the view stays where it is. */
  added(n: number): void {
    if (this._offset > 0 && n > 0) this._offset += n;
  }

  /** Back to the live bottom. */
  toLive(): void {
    if (this._offset === 0) return;
    this._offset = 0;
    this.onChange();
  }

  /** One step up (older) when there is more above; returns whether it moved. */
  up(): boolean {
    if (!this.canUp) return false;
    this._offset++;
    this.onChange();
    return true;
  }

  /** One step down (newer); returns whether it moved. */
  down(): boolean {
    if (this._offset === 0) return false;
    this._offset--;
    this.onChange();
    return true;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    const px = e.deltaMode === 1 ? e.deltaY * this.cellH() : e.deltaMode === 2 ? e.deltaY * 10 * this.cellH() : e.deltaY;
    if (px === 0) return;
    if (Math.sign(px) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelAcc += px;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP_PX) return;
    const dir = Math.sign(this.wheelAcc);
    this.wheelAcc = 0;
    if (dir < 0) this.up();
    else this.down();
  };

  private readonly onMore = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.toLive();
  };

  /**
   * Builds the view of `count` items (index 0 = oldest). `build(i)` makes
   * item i's element; `rows` is an upper bound of the rows the list can
   * show. `moreText(n)` is the indicator text for n hidden items.
   */
  render(count: number, rows: number, build: (i: number) => HTMLElement, moreText: (n: number) => string): void {
    this.count = count;
    if (this._offset > count - 1) this._offset = Math.max(0, count - 1);
    for (;;) {
      const scrolled = this._offset > 0;
      this.more.hidden = !scrolled;
      if (scrolled) this.more.textContent = moreText(this._offset);
      const anchor = count - 1 - this._offset;
      const start = Math.max(0, anchor - Math.max(1, rows));
      const els: HTMLElement[] = [];
      for (let i = start; i <= anchor; i++) els.push(build(i));
      this.stack.replaceChildren(...els);
      if (count === 0) {
        this.canUp = false;
        return;
      }
      const listH = this.metrics.listHeight(this.el);
      if (start > 0) {
        this.canUp = true;
        return;
      }
      let total = 0;
      for (const el of els) total += this.metrics.itemHeight(el);
      // Scrolled past the oldest: blank space above it. Step back down.
      if (scrolled && total < listH - 0.5) {
        this._offset--;
        continue;
      }
      const above = total - this.metrics.itemHeight(els[els.length - 1]!);
      // Going up shows the indicator row, so the list is one row shorter then.
      const upH = scrolled ? listH : listH - this.cellH();
      this.canUp = above >= upH - 0.5;
      return;
    }
  }

  /** Number of items at the last render (tests). */
  get size(): number {
    return this.count;
  }

  dispose(): void {
    this.el.removeEventListener('wheel', this.onWheel);
    this.more.removeEventListener('mousedown', this.onMore);
  }
}
