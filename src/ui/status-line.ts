// Temporary one-row status line (stage 1; stage 2 replaces it).
//
//   playing · Rasta · Link: 38ms · XML: on · capture: recording
//
// Muted grey (C_HINT) text. Updated from the bus; the capture segment is
// set by the app through `setCapture`.

import type { Bus } from '../core/bus';
import type { ConnState } from '../core/types';

export class StatusLine {
  readonly el: HTMLDivElement;
  private state: ConnState = 'idle';
  private name = '';
  private link = 'Link: —';
  private xml = false;
  private capture = '';
  private replay = false;
  private readonly unsubs: Array<() => void> = [];

  constructor(bus: Bus, root: HTMLElement) {
    this.el = root.ownerDocument.createElement('div');
    this.el.className = 'wc-status';
    root.appendChild(this.el);

    this.unsubs.push(
      bus.on('conn.state', (s) => {
        this.state = s.state;
        if (s.state === 'connecting') {
          this.xml = false;
          this.link = 'Link: —';
        }
        this.render();
      }),
      bus.on('gmcp', (m) => {
        if (m.pkg.toLowerCase() !== 'char.name') return;
        const n = (m.data as { name?: unknown } | undefined)?.name;
        if (typeof n === 'string' && n !== this.name) {
          this.name = n;
          this.render();
        }
      }),
      bus.on('link.rtt', (r) => {
        this.link = formatLink(r.ms, r.suspect);
        this.render();
      }),
      bus.on('xml.seen', () => {
        if (this.xml) return;
        this.xml = true;
        this.render();
      }),
    );
    this.render();
  }

  /** Sets the capture segment, e.g. `capture: recording`. '' hides it. */
  setCapture(text: string): void {
    if (text === this.capture) return;
    this.capture = text;
    this.render();
  }

  /**
   * Replay mode: while the replay socket is connected the state reads
   * `replay` instead of `connecting`/`login`, so a replay is never mistaken
   * for a live login.
   */
  setReplay(on: boolean): void {
    if (on === this.replay) return;
    this.replay = on;
    this.render();
  }

  /** The rendered text (for tests). */
  get text(): string {
    return this.el.textContent ?? '';
  }

  private render(): void {
    const live = this.state === 'connecting' || this.state === 'login' || this.state === 'playing';
    const parts: string[] = [this.replay && live ? 'replay' : this.state];
    if (this.name) parts.push(this.name);
    parts.push(this.link, this.xml ? 'XML: on' : 'XML: off');
    if (this.capture) parts.push(this.capture);
    this.el.textContent = ' ' + parts.join(' · ');
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.el.remove();
  }
}

/** `Link: 38ms`, `Link: 38ms?` when suspect, `Link: —` before the first pong. */
export function formatLink(ms: number | null, suspect: boolean): string {
  if (ms === null) return 'Link: —';
  return `Link: ${Math.round(ms)}ms${suspect ? '?' : ''}`;
}
