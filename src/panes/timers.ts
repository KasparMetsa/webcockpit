// Timers pane (Inv §2.6, ADR 0017) — placeholder from stage 5 P0; P2
// replaces it with the real grid (bars, countdowns, charm rows, herblore
// add-view, scroll).
//
// It follows `game.timers` (part `timers`) and the `timers` settings and
// lists the enabled groups' cell names, one per row, plainly.

import { TIMER_GROUPS } from '../timers/entry';
import { CellLine } from './grid';
import type { PaneContext } from './context';
import { PaneShell } from './pane';
import { paneShade } from './shade';

export class TimersPane extends PaneShell {
  constructor(ctx: PaneContext) {
    super(ctx, 'timers');
    this.own(ctx.game.subscribe((part) => part === 'timers' && this.markDirty()));
    this.own(ctx.settings.subscribe((next, prev) => next.timers !== prev.timers && this.markDirty()));
  }

  protected override render(): void {
    const s = this.ctx.settings.get();
    const shade = paneShade(s, 'timers');
    const view = this.ctx.game.timers.view(this.ctx.now());
    const w = this.cols;
    const lines: CellLine[] = [];
    for (const g of TIMER_GROUPS) {
      if (!s.timers.groups[g].enabled) continue;
      for (const c of view.cells[g]) {
        if (lines.length >= this.rows) break;
        const l = new CellLine(w);
        l.put(0, c.name.toUpperCase().slice(0, w), { fg: shade.ramp.vtext });
        lines.push(l);
      }
    }
    this.content.replaceChildren(...lines.map((l) => l.toElement(this.ctx.doc)));
  }
}
