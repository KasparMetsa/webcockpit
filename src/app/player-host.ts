// The log player in the app (ADR 0018 "Log player"): History → RUN LOG
// opens a session here (Shell.openPlayer). One `PlayerHost` per open:
//
//   .wc-player                  fills the page; the recorded theme and the
//                               cell size are custom properties on it
//     .wc-player-stage          the window left of the strip
//       .wc-app                 a player App (src/app/app.ts `player: true`)
//     .wc-player-chrome         src/player/view.ts
//
// The engine (src/player/engine.ts) builds the App through `build(clock)`:
// offline, no profile, never captured, on the replay clock, with its own
// settings store (in memory, never saved) holding the viewer's settings;
// VIEW records replace their parts as they pass (src/player/fit.ts), so
// after a seek the settings are those of the latest VIEW before it. The
// stage is the window left of the strip, laid out by the cockpit at the
// recorded font size (smaller only when the grid would be below the
// cockpit's minimum): docks keep their recorded cell sizes, the game pane
// takes the rest and the text reflows, as live. SIZE records are not used
// (owner decision 2026-09-28: no letterboxing). The App's output and side
// panes paint through a gate the engine closes while it fast-forwards.
//
// Stage 7 (ADR 0019): `openChain` takes options, so the HTML replay and
// the Spotlights reel use the same host: timeline edits (comments, cuts,
// spotlight windows), their own markers and the view's mode options
// (header, keys, overlay …). The target shows comments as wrapped `## `
// rows and blanks as `.wc-blank` rows in the output pane.

import type { RunLibrary } from '../runs/library';
import type { RunEvent } from '../runs/events';
import type { Session } from '../runs/stitch';
import { SettingsStore, type ViewSnapshot } from '../settings';
import { applyTheme } from '../theme/apply';
import { CellMetrics } from '../theme/cells';
import { PlayerEngine, type PlayerTarget, type Wall } from '../player/engine';
import { overlayView, parseView, playerFontSize } from '../player/fit';
import { type MarkLetter, STRIP_COLS, markersOf } from '../player/strip';
import { type ChainRun, type Timeline, type TimelineEdits, buildTimeline, playAtLogUs } from '../player/timeline';
import { PlayerView, type PlayerViewOptions, runHeader } from '../player/view';
import { commentLines } from '../share/edits';
import type { ReplayClock } from '../player/clock';
import { App } from './app';

export interface PlayerHostOptions {
  /** Parent element (the page root); the player fills it. */
  root: HTMLElement;
  /** The viewer's settings (read, never written). */
  settings: SettingsStore;
  /** ESC: the player closes itself, then this runs (the shell shows History). */
  onClose: () => void;
  /** Wall-time services (tests). */
  wall?: Wall;
  /** Chrome auto-hide delay (tests). */
  hideMs?: number;
}

/** What the header shows besides the runs (from the History session). */
export interface PlayerInfo {
  character: string;
  level?: number | undefined;
}

/** Mode options of `openChain` (stage 7; none = the in-app log player). */
export interface PlayerOpenOptions {
  edits?: TimelineEdits;
  /** Markers as playback offsets; default: the events' markers (`markersOf`) on `playAtLogUs`. */
  marks?: (tl: Timeline) => Array<{ letter: MarkLetter; offset: number }>;
  /** View mode options; `header` and `onEsc` replace the log player's. */
  view?: Partial<Pick<PlayerViewOptions, 'header' | 'keys' | 'overlay' | 'startHidden' | 'stripHoverTime' | 'boxButtons' | 'onEsc'>>;
  /** Start playing at once (default true). */
  autoplay?: boolean;
  /** Runs whose login system line is not printed (HTML replay `hiddenSys`, ADR 0019). */
  hiddenSys?: readonly number[];
}

/** Paint gate: frame callbacks wait while it is closed. */
class FrameGate {
  private open = true;
  private queue: Array<() => void> = [];
  private dead = false;

  readonly request = (cb: () => void): void => {
    if (this.dead) return;
    if (this.open) requestAnimationFrame(() => !this.dead && cb());
    else this.queue.push(cb);
  };

  set(on: boolean): void {
    if (on === this.open) return;
    this.open = on;
    if (!on) return;
    const q = this.queue;
    this.queue = [];
    if (q.length) requestAnimationFrame(() => !this.dead && q.forEach((f) => f()));
  }

  dispose(): void {
    this.dead = true;
    this.queue = [];
  }
}

export class PlayerHost {
  readonly el: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly opts: PlayerHostOptions;
  private readonly cells: CellMetrics;
  private engineRef: PlayerEngine | null = null;
  private view: PlayerView | null = null;
  private appRef: App | null = null;
  private store: SettingsStore | null = null;
  private readonly ro: ResizeObserver | null = null;
  private fitKey = '';
  private closed = false;
  private hiddenSys: ReadonlySet<number> = new Set();

  constructor(opts: PlayerHostOptions) {
    this.opts = opts;
    const doc = opts.root.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'wc-player';
    this.stage = doc.createElement('div');
    this.stage.className = 'wc-player-stage';
    this.el.appendChild(this.stage);
    opts.root.appendChild(this.el);
    this.cells = new CellMetrics({ doc, root: this.el });
    this.cells.subscribe(() => this.placeStage());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.relayout());
      this.ro.observe(this.el);
    }
  }

  /** The engine (tests, the dev hook). */
  get engine(): PlayerEngine | null {
    return this.engineRef;
  }

  /** The current player App (it changes on a backward seek). */
  get app(): App | null {
    return this.appRef;
  }

  /** Loads a History session's logs and events and starts playing. */
  async open(session: Session, lib: RunLibrary): Promise<void> {
    const ids = session.runs.map((r) => r.runId);
    const [chain, events] = await Promise.all([lib.chainLog(ids), lib.events(ids)]);
    if (this.closed) return;
    this.openChain(chain, events, { character: session.character, level: session.level });
  }

  /** The player view (stage 7 modes: refresh, cursor). */
  get playerView(): PlayerView | null {
    return this.view;
  }

  /**
   * Starts playing `chain` (oldest run first) with the chain's events for
   * the markers. `opts` configures another mode (HTML replay, Spotlights).
   */
  openChain(chain: readonly ChainRun[], events: readonly RunEvent[], info: PlayerInfo, opts: PlayerOpenOptions = {}): void {
    const tl = buildTimeline(chain, opts.edits);
    this.hiddenSys = new Set(opts.hiddenSys ?? []);
    const engine = new PlayerEngine({
      timeline: tl,
      build: (clock) => this.build(clock),
      ...(this.opts.wall ? { wall: this.opts.wall } : {}),
    });
    this.engineRef = engine;
    const marks = opts.marks
      ? opts.marks(tl)
      : markersOf(events).map((m) => ({ letter: m.letter, offset: playAtLogUs(tl, m.us) }));
    const onEsc = (): void => this.close();
    this.view = new PlayerView({
      root: this.el,
      engine,
      marks,
      header: (run) => {
        const r = tl.runs[run]?.meta;
        return runHeader(
          {
            character: info.character,
            level: r?.summary?.level ?? info.level,
            run,
            runs: tl.runs.length,
            startUs: r ? (r.summary?.startUs ?? r.startedUs) : 0,
          },
          onEsc,
        );
      },
      output: () => this.appRef?.output ?? null,
      cells: () => this.cells.get(),
      onEsc,
      ...(this.opts.hideMs !== undefined ? { hideMs: this.opts.hideMs } : {}),
      ...opts.view,
    });
    if (opts.autoplay !== false) engine.play();
  }

  /** Closes the player and tells the shell. */
  close(): void {
    if (this.closed) return;
    this.dispose();
    this.opts.onClose();
  }

  /** Tears everything down (no callback). */
  dispose(): void {
    this.closed = true;
    this.view?.dispose();
    this.view = null;
    this.engineRef?.dispose();
    this.engineRef = null;
    this.ro?.disconnect();
    this.el.remove();
  }

  // ------------------------------------------------------------------ App

  private build(clock: ReplayClock): PlayerTarget {
    const gate = new FrameGate();
    const store = new SettingsStore({ factory: null, storage: null, win: null });
    void store.load();
    store.update(() => JSON.parse(JSON.stringify(this.opts.settings.get())) as never);
    this.store = store;
    const app = new App({
      root: this.stage,
      player: true,
      offline: true,
      settings: store,
      cells: this.cells,
      scheduler: clock,
      now: () => clock.now(),
      clockUs: () => clock.nowUs(),
      requestFrame: gate.request,
      paneRequestFrame: gate.request,
    });
    this.appRef = app;
    const unsub = store.subscribe(() => this.relayout());
    this.relayout();
    return {
      connect: (sock, run) => {
        app.quietLogin = this.hiddenSys.has(run);
        app.replayOn(sock, `run ${run + 1}`);
      },
      view: (json) => {
        const v = parseView(json);
        if (v) store.update((d) => overlayView(d, v as Partial<ViewSnapshot>));
      },
      // The recorded size is not used: the player fills the viewer's window.
      size: () => {},
      paint: (on) => gate.set(on),
      comment: (text) => app.output.pushRows('comment', commentLines(text), clock.nowUs()),
      blank: (lines) => app.output.pushRows('blank', new Array<string>(Math.max(0, lines)).fill('')),
      dispose: () => {
        unsub();
        gate.dispose();
        app.dispose();
        if (this.appRef === app) this.appRef = null;
      },
    };
  }

  // --------------------------------------------------------------- layout

  /** Theme and cell size from the player settings and the window. */
  private relayout(): void {
    const store = this.store;
    if (!store || this.closed) return;
    const s = store.get();
    applyTheme(s, this.el);
    let a = s.appearance;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    // The strip's columns are kept free, so it never covers a pane.
    if (W > 0 && H > 0) a = { ...a, size: playerFontSize(a, W, H, STRIP_COLS) };
    const key = JSON.stringify(a);
    if (key !== this.fitKey) {
      this.fitKey = key;
      void this.cells.update(a);
    }
    this.placeStage();
  }

  /** Sizes the stage: the whole player less the strip's columns on the right. */
  private placeStage(): void {
    const st = this.stage.style;
    const c = this.cells.get();
    st.left = '0';
    st.top = '0';
    st.height = '100%';
    st.width = c.w > 0 ? `${Math.max(0, this.el.clientWidth - STRIP_COLS * c.w)}px` : '100%';
  }
}
