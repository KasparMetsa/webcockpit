// The Spotlights info box (Inv §7.6): a 30 × 7 framed box and a countdown
// row under it, top-right over the reel (row 2, 4 cells in from the right,
// clear of the strip), always shown (a PlayerView overlay with
// `keepVisible`), hidden when the player is too narrow for it.
//
//   ┌────────────────────────────┐   frame
//   │         ◄ 2 of 7 ►         │   arrows clickable, absent at the ends
//   │      RASTA: PvP kill       │   type line
//   │                            │
//   │    *Ibuki the Half-Elf*    │   label, bold, ≤ 2 lines then …
//   │                            │
//   └────────────────────────────┘
//       ▐████████████████████▌       drains from both sides to the moment
//
// Every cell has the canvas background, so the log behind never shows
// through. `update()` redraws only the rows whose text changed.

import './spotlight.css';
import { KIND_LABEL, type Spotlight } from '../share/spotlights';
import { BOX_INNER, boxFits, countdownRow, labelLines } from './spotlight-reel';

export interface SpotlightBoxState {
  /** Current spotlight index and the reel's length. */
  index: number;
  total: number;
  spot: Spotlight;
  /** Countdown half-fill (0 = no bar). */
  half: number;
  /** Player width in cells (the box hides when it does not fit). */
  cols: number;
}

const centre = (text: string, width = BOX_INNER): [string, string] => {
  const n = [...text].length;
  const pad = Math.max(0, width - n);
  return [' '.repeat(pad >> 1), ' '.repeat(pad - (pad >> 1))];
};

export class SpotlightBox {
  readonly el: HTMLDivElement;
  private readonly nav: HTMLDivElement;
  private readonly type: HTMLDivElement;
  private readonly label1: HTMLDivElement;
  private readonly label2: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private sig = '';
  private barSig = '';

  constructor(
    doc: Document,
    private readonly onNav: (dir: -1 | 1) => void,
  ) {
    const div = (cls: string, text = ''): HTMLDivElement => {
      const d = doc.createElement('div');
      d.className = cls;
      d.textContent = text;
      return d;
    };
    this.el = div('wc-spot-box');
    this.nav = div('wc-spot-row');
    this.type = div('wc-spot-row');
    this.label1 = div('wc-spot-row');
    this.label2 = div('wc-spot-row');
    this.bar = div('wc-spot-bar');
    const blank = (): HTMLDivElement => div('wc-spot-row', '│' + ' '.repeat(BOX_INNER) + '│');
    this.el.append(
      div('wc-spot-row', '┌' + '─'.repeat(BOX_INNER) + '┐'),
      this.nav,
      this.type,
      blank(),
      this.label1,
      this.label2,
      div('wc-spot-row', '└' + '─'.repeat(BOX_INNER) + '┘'),
      this.bar,
    );
    // Pointer presses on the box stay on it (the stage would move the cursor).
    this.el.addEventListener('click', (e) => e.stopPropagation());
  }

  update(s: SpotlightBoxState): void {
    this.el.toggleAttribute('data-narrow', !boxFits(s.cols));
    const sig = `${s.index}|${s.total}|${s.spot.id}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.drawNav(s.index, s.total);
      this.drawType(s.spot);
      const [a = '', b = ''] = labelLines(s.spot.label);
      this.drawLabel(this.label1, a);
      this.drawLabel(this.label2, b);
    }
    const bar = countdownRow(s.half);
    if (bar !== this.barSig) {
      this.barSig = bar;
      this.bar.textContent = bar;
    }
  }

  private frameRow(row: HTMLDivElement, parts: Array<string | HTMLElement>): void {
    row.textContent = '';
    row.append('│', ...parts, '│');
  }

  private span(cls: string, text: string): HTMLSpanElement {
    const s = this.el.ownerDocument.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  private drawNav(index: number, total: number): void {
    const count = `${index + 1} of ${total}`;
    // Each arrow keeps its 3-cell region, so the count stays centred.
    const [l, r] = centre(' '.repeat(3) + count + ' '.repeat(3));
    const arrow = (dir: -1 | 1, shown: boolean): HTMLSpanElement | string => {
      if (!shown) return '   ';
      const a = this.span('wc-spot-arrow', dir < 0 ? ' ◄ ' : ' ► ');
      a.dataset.nav = dir < 0 ? 'prev' : 'next';
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onNav(dir);
      });
      return a;
    };
    this.frameRow(this.nav, [l, arrow(-1, index > 0), this.span('wc-spot-count', count), arrow(1, index + 1 < total), r]);
  }

  private drawType(spot: Spotlight): void {
    const full = `${spot.character.toUpperCase()}: ${KIND_LABEL[spot.kind]}`;
    const cps = [...full];
    const text = cps.length > BOX_INNER ? cps.slice(0, BOX_INNER - 1).join('') + '…' : full;
    const [l, r] = centre(text);
    this.frameRow(this.type, [l, this.span('wc-spot-type', text), r]);
  }

  private drawLabel(row: HTMLDivElement, text: string): void {
    const [l, r] = centre(text);
    this.frameRow(row, [l, this.span('wc-spot-label', text), r]);
  }
}
