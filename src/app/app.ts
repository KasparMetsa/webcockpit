// Application shell (spec §2.1, §2.2): wires the layers together and owns
// the built-in commands.
//
//   socket → Session (telnet, GMCP, keep-alive) → LineAssembler → bus
//   bus → AppStatus, Recorder, ScriptEngine → text.display → OutputPane
//   InputPane → ScriptEngine (aliases, # commands, client commands)
//             → Session.sendCommand
//   InputPane keydown → macro → ScriptEngine (synchronously, no await)
//
// Script engine (ADR 0015): the selected profile is loaded at start-up (so
// an offline replay runs it too) and again whenever a live session starts.
// `applyProfile(text)` swaps it atomically (the ESC-menu editor). Variables
// set at run time are written back to the profile (src/app/writeback.ts).
// Password mode bypasses the engine (InputPane sends secrets directly).
//
// The screen is the Cockpit view (src/layout/cockpit.ts): the output pane
// sits in its game slot, the input pane in its input slot, and the side
// panes in the docks, laid out from the settings (ADR 0010, ADR 0012).
//
// `app.status` is the read-only status observable (connection, character,
// Link, capture, XML) for the ESC menu header. Its text form is also kept
// in `data-status` on the app element for the browser tests.
//
// Live vs replay
// --------------
// A replay (`#replay`, `?fixture=`) runs through the same Session with a
// ReplaySocket. It is never captured: every `conn.state` of a replay
// carries `replay: true` and the Recorder never starts a run for it. A log
// with recorded GMCP (ADR 0016) reaches `playing` from its recorded
// `Char.Name`, so the side panes are active and fill as in the live game; a
// Cockpit log without GMCP stays in `login`. `status.replay` is true
// meanwhile.
//
// Side panes get a `PaneContext` (src/panes/context.ts) built here: the bus,
// the settings, the cells, a frame scheduler, the session as sender and a
// lazy IndexedDB opener. App also announces the screen settings as
// `view.settings` (at start and on change) for the run capture.
//
// After a replay, or when the page was opened in an offline mode (`?replay`,
// `?fixture=`, `?bench`), Enter on a closed connection does not connect to
// MUME; `#connect` does. After a live disconnect, Enter reconnects.

import { downloadRun } from '../capture/download';
import { Recorder, type RecorderOptions } from '../capture/recorder';
import type { ProfileStore } from '../profiles';
import { type LoadResult, type Scheduler, ScriptEngine } from '../script/engine';
import { Bus } from '../core/bus';
import type { BusEvents, Socketish } from '../core/types';
import { ReplaySocket } from '../net/replay-socket';
import { REASON_USER_RECONNECT, Session } from '../net/session';
import { LineAssembler } from '../text/assembler';
import { InputPane } from '../ui/input-pane';
import { CellMetrics } from '../theme/cells';
import { Cockpit } from '../layout/cockpit';
import { SettingsStore, viewSnapshot } from '../settings';
import { createPaneContext, defaultRequestFrame, lazyDb } from '../panes/context';
import { OutputPane } from '../ui/output-pane';
import { AppStatus, type AppStatusView, formatStatus } from './status';
import { VariableWriteBack } from './writeback';

/** Reason used when a live or replay connection is closed to start a replay. */
export const REASON_REPLAY_START = 'replay started';
/** Reason used when a replay is closed to go live. */
const REASON_REPLAY_STOP = 'replay stopped';
/** Reason ReplaySocket gives when the log is exhausted. */
const REASON_REPLAY_DONE = 'replay finished';

export const HELP_LINES: readonly string[] = [
  'Built-in commands:',
  '  #connect          connect to MUME',
  '  #disconnect       close the connection',
  '  #reconnect        close and connect again',
  '  #runlog           download the current (or last) run as a .log',
  '  #replay [speed]   replay a Cockpit .log file (1 = real time, 0 = max speed)',
  '  #help             this list',
  'While disconnected, Enter reconnects.',
  'tt++ commands work too: #alias #action #highlight #substitute #gag #macro',
  '  #variable #ticker #delay (and #un...), #if #elseif #else #showme #nop',
  '  #math #format #class #event. Separate commands with ;',
  '  _send <text> sends text as is. The profile is edited from the ESC menu.',
];

export interface AppOptions {
  /** Element the app is built into. */
  root: HTMLElement;
  /** Socket factory for live connections (default: the MUME WebSocket). */
  socketFactory?: () => Socketish;
  /** Recorder options (tests inject the store and locks). */
  recorder?: RecorderOptions;
  /** Frame scheduler for the output pane (tests, benchmark). */
  requestFrame?: (cb: () => void) => void;
  /** Start without a live connection path on Enter (`?replay`, `?fixture=`). */
  offline?: boolean;
  /**
   * Cell metrics (src/theme/cells.ts). The output pane measures NAWS with
   * them and the input caret moves by their width. Default: each pane
   * measures its own font.
   */
  cells?: CellMetrics;
  /**
   * The settings store (pane layout, toggles, colours). Default: an
   * in-memory store with the default settings (unit tests).
   */
  settings?: SettingsStore;
  /** ESC in the input when the output is not scrolled: open the ESC menu (src/app/shell.ts). */
  onEscape?: () => void;
  /**
   * The profile store. The selected profile (`settings.profile`) is loaded
   * into the script engine at start-up and when a live session starts, and
   * runtime variables are written back to it. Default: none (no profile).
   */
  profiles?: ProfileStore;
  /** Timer clock for #ticker / #delay (tests). */
  scheduler?: Scheduler;
  /** Write-back debounce in ms (tests). */
  writeBackDelayMs?: number;
  /** Frame scheduler for the side panes (tests). Default requestAnimationFrame. */
  paneRequestFrame?: (cb: () => void) => void;
  /**
   * IndexedDB for the side panes' storage (comm history). Default
   * `globalThis.indexedDB`; null = none.
   */
  paneDb?: IDBFactory | null;
}

export class App {
  readonly bus = new Bus();
  readonly el: HTMLDivElement;
  /** Read-only status observable (connection, character, Link, capture, XML). */
  readonly status: AppStatusView;
  private readonly statusImpl: AppStatus;
  readonly assembler: LineAssembler;
  readonly session: Session;
  /** Game pane, docks with the side panes, input line (src/layout/cockpit.ts). */
  readonly cockpit: Cockpit;
  readonly output: OutputPane;
  readonly input: InputPane;
  readonly recorder: Recorder;
  /** The tt++ script engine (ADR 0015). */
  readonly script: ScriptEngine;
  private readonly settings: SettingsStore;
  private readonly profiles: ProfileStore | null;
  private readonly writeBack: VariableWriteBack | null;
  /** Bumped by every profile load, so a slow store read cannot undo a newer load. */
  private loadToken = 0;
  /** True while a typed line or a macro runs (it may reconnect). */
  private userAction = false;
  /** The current typed line already reconnected or reported "not connected". */
  private userActionHandled = false;

  /** The current (or last) connection is a replay. */
  private replaying = false;
  /** Enter on a closed connection does not connect live. */
  private offline: boolean;
  private replayLabel = '';
  private charName = '';
  private fileInput: HTMLInputElement | null = null;
  private viewJson = '';

  constructor(opts: AppOptions) {
    const doc = opts.root.ownerDocument;
    const bus = this.bus;
    this.offline = opts.offline ?? false;

    this.el = doc.createElement('div');
    this.el.className = 'wc-app';
    opts.root.appendChild(this.el);

    this.statusImpl = new AppStatus(bus);
    this.status = this.statusImpl;
    this.el.dataset.status = formatStatus(this.status.get());
    this.status.subscribe((st) => {
      this.el.dataset.status = formatStatus(st);
    });
    const cells = opts.cells;
    this.assembler = new LineAssembler(bus);
    this.session = new Session({
      bus,
      sink: this.assembler,
      ...(opts.socketFactory ? { socketFactory: opts.socketFactory } : {}),
    });
    this.settings = opts.settings ?? new SettingsStore({ factory: null, storage: null, win: null });
    this.profiles = opts.profiles ?? null;
    // Before the cockpit, so the recorder sees its first `view.size`.
    const recOpts = opts.recorder ?? {};
    this.recorder = new Recorder(bus, {
      ...recOpts,
      onStatus: (s) => {
        this.statusImpl.set({ capture: s });
        recOpts.onStatus?.(s);
      },
    });
    this.announceView();
    this.settings.subscribe(() => this.announceView());
    const cellSource = cells ?? new CellMetrics({ doc });
    const paneContext = createPaneContext({
      doc,
      bus,
      settings: this.settings,
      cells: cellSource,
      requestFrame: opts.paneRequestFrame ?? defaultRequestFrame,
      sender: this.session,
      connState: () => this.session.state,
      openDb: lazyDb(opts.paneDb),
    });
    this.cockpit = new Cockpit({
      root: this.el,
      settings: this.settings,
      cells: cellSource,
      onFocusInput: () => this.input.focus(),
      paneContext,
    });
    this.output = new OutputPane(bus, this.cockpit.gameEl, {
      onResize: (cols, rows) => this.session.setWindowSize(cols, rows),
      onFocusInput: () => this.input.focus(),
      ...(opts.requestFrame ? { requestFrame: opts.requestFrame } : {}),
      ...(cells ? { cellSize: () => cells.get() } : {}),
    });
    this.input = new InputPane(bus, this.cockpit.inputEl, {
      sender: this.session,
      output: this.output,
      onCommand: (text) => this.onCommand(text),
      onMacroKey: (key) => this.onMacroKey(key),
      ...(opts.onEscape ? { onEscape: opts.onEscape } : {}),
      ...(cells ? { cellWidth: () => cells.get().w } : {}),
    });
    cells?.subscribe(() => {
      this.output.remeasure();
      this.input.scheduleCaret();
    });
    // After the recorder: capture sees a line before the commands its
    // actions send.
    this.script = new ScriptEngine({
      send: (text) => this.sendFromScript(text),
      message: (text) => this.sys(text),
      client: (name, args) => this.runClient(name, args),
      onVariable: (name, value) => this.writeBack?.queue(name, value),
      ...(opts.scheduler ? { scheduler: opts.scheduler } : {}),
    });
    this.script.attach(bus);
    this.writeBack = this.profiles
      ? new VariableWriteBack(this.profiles, {
          ...(opts.writeBackDelayMs !== undefined ? { delayMs: opts.writeBackDelayMs } : {}),
          onError: (m) => this.sys(m),
        })
      : null;
    doc.defaultView?.addEventListener('pagehide', () => void this.writeBack?.flush());
    if (this.profiles) void this.loadSelectedProfile(false);

    bus.on('gmcp', (m) => {
      if (m.pkg.toLowerCase() !== 'char.name') return;
      const n = (m.data as { name?: unknown } | undefined)?.name;
      if (typeof n === 'string' && n) this.charName = n;
    });
    bus.on('conn.state', this.onState);
  }

  /** True while the replay socket is the connection. */
  get isReplaying(): boolean {
    return this.replaying && this.isConnected;
  }

  private get isConnected(): boolean {
    const s = this.session.state;
    return s === 'connecting' || s === 'login' || s === 'playing';
  }

  // ------------------------------------------------------------ connecting

  /** Connects to MUME (closing a running replay first). */
  connectLive(): void {
    if (this.isConnected) {
      if (!this.replaying) {
        this.sys('Already connected. Use #reconnect to start over.');
        return;
      }
      this.session.disconnect(REASON_REPLAY_STOP);
    }
    this.replaying = false;
    this.offline = false;
    this.statusImpl.set({ replay: false });
    this.session.connect();
  }

  /**
   * Replays a Cockpit `.log` (Inv §7.1). `speed` 1 = real time with gaps
   * capped at 2 s, 0 = as fast as possible. Any connection is closed first.
   */
  startReplay(logText: string, label: string, speed = 1): void {
    if (this.isConnected) this.session.disconnect(REASON_REPLAY_START);
    this.replaying = true;
    this.offline = true;
    this.replayLabel = `${label} (speed ${speed === 0 ? 'max' : speed})`;
    this.statusImpl.set({ replay: true });
    this.session.connect(new ReplaySocket(logText, { speed }));
  }

  private readonly onState = (s: BusEvents['conn.state']): void => {
    this.input.setLeaveGuard(!this.replaying && (s.state === 'login' || s.state === 'playing'));
    switch (s.state) {
      case 'connecting':
        this.assembler.reset();
        this.sys(this.replaying ? `Replaying ${this.replayLabel}...` : 'Connecting to MUME...');
        if (!this.replaying && this.profiles) void this.loadSelectedProfile(true);
        break;
      case 'login':
        if (!this.replaying) this.sys('Connected.');
        break;
      case 'playing':
        this.sys(`${this.charName || 'Character'} logged in.`);
        break;
      case 'disconnected':
        void this.writeBack?.flush();
        this.onDisconnected(s.reason ?? '');
        break;
    }
  };

  private onDisconnected(reason: string): void {
    if (this.replaying) {
      this.statusImpl.set({ replay: false });
      if (reason === REASON_REPLAY_START) return;
      if (reason === REASON_REPLAY_STOP) return this.sys('Replay stopped.');
      this.sys(reason === REASON_REPLAY_DONE ? 'Replay finished.' : `Replay stopped: ${reason}`);
      this.sys('#connect plays live, #replay loads another log.');
      return;
    }
    this.sys(`Connection closed: ${reason || 'unknown reason'}`);
    if (reason !== REASON_USER_RECONNECT && reason !== REASON_REPLAY_START) {
      this.sys('Press Enter to reconnect.');
    }
  }

  // --------------------------------------------------------------- profile

  /**
   * Loads the selected profile from the store into the engine. `announce`
   * reports success (a live session start); problems are always reported.
   */
  async loadSelectedProfile(announce: boolean): Promise<void> {
    const store = this.profiles;
    if (!store) return;
    const token = ++this.loadToken;
    const name = this.settings.get().profile;
    let text: string;
    try {
      const rec = await store.get(name);
      if (token !== this.loadToken) return;
      if (!rec) {
        if (announce) this.sys(`Profile ${name} not found; no profile loaded.`);
        return;
      }
      text = rec.text;
    } catch (err) {
      if (token === this.loadToken) this.sys(`Profile ${name} could not be read: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    await this.writeBack?.setTarget(null);
    if (token !== this.loadToken) return;
    const r = this.script.loadProfile(text);
    if (!r.ok) {
      this.sys(`Profile ${name} not loaded: ${r.reason}`);
      return;
    }
    void this.writeBack?.setTarget(name);
    this.reportLoad(name, r.warnings, announce);
  }

  private reportLoad(name: string, warnings: readonly string[], announce: boolean): void {
    if (warnings.length === 0) {
      if (announce) this.sys(`Profile ${name} loaded.`);
      return;
    }
    this.sys(`Profile ${name} loaded with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
    const MAX = 10;
    for (const w of warnings.slice(0, MAX)) this.sys('  ' + w);
    if (warnings.length > MAX) this.sys(`  … and ${warnings.length - MAX} more.`);
  }

  /**
   * Replaces the live profile with `text` (the ESC-menu editor's Apply).
   * All or nothing: on failure the running profile stays as it was.
   * Variables set later are written back to the loaded profile.
   */
  applyProfile(text: string): { ok: true; warnings: string[] } | { ok: false; reason: string } {
    this.loadToken++;
    const r: LoadResult = this.script.loadProfile(text);
    if (!r.ok) return r;
    if (this.writeBack && this.writeBack.target === null) void this.writeBack.setTarget(this.settings.get().profile);
    return { ok: true, warnings: r.warnings };
  }

  /** Values queued for the profile write-back are saved now. */
  flushWriteBack(): Promise<void> {
    return this.writeBack?.flush() ?? Promise.resolve();
  }

  // -------------------------------------------------------------- commands

  /**
   * Input hook: runs a typed line through the script engine (aliases, `;`,
   * `#` commands, client commands). Always handled. While disconnected the
   * first command that would go to the game reconnects instead (or, offline,
   * says how to connect).
   */
  onCommand(text: string): boolean {
    this.userAction = true;
    this.userActionHandled = false;
    try {
      this.script.input(text);
    } finally {
      this.userAction = false;
    }
    return true;
  }

  /** Macro hook: runs the macro for a key; false when none is bound. */
  onMacroKey(key: string): boolean {
    if (!this.script.hasMacro(key)) return false;
    this.userAction = true;
    this.userActionHandled = false;
    try {
      this.script.runMacro(key);
    } finally {
      this.userAction = false;
    }
    return true;
  }

  /** The engine's sender: to the game when connected. */
  private sendFromScript(text: string): void {
    const s = this.session.state;
    if (s !== 'disconnected' && s !== 'idle') {
      this.session.sendCommand(text);
      return;
    }
    // Rules and timers do not reconnect; a typed line or key does, once.
    if (!this.userAction || this.userActionHandled) return;
    this.userActionHandled = true;
    if (this.offline) this.sys('Not connected. #connect plays live, #replay loads a log.');
    else this.connectLive();
  }

  /** Client commands from the engine (`#connect`, `#help` …). */
  private runClient(name: string, argText: string): void {
    const args = argText.split(/\s+/).filter(Boolean);
    switch (name) {
      case 'connect':
        this.connectLive();
        return;
      case 'disconnect':
        if (!this.isConnected) this.sys('Not connected.');
        else this.session.disconnect();
        return;
      case 'reconnect':
        if (this.replaying && this.isConnected) this.session.disconnect(REASON_REPLAY_STOP);
        this.replaying = false;
        this.offline = false;
        this.statusImpl.set({ replay: false });
        this.session.reconnect();
        return;
      case 'runlog':
        void this.runlog();
        return;
      case 'replay': {
        const speed = args[0] === undefined ? 1 : Number(args[0]);
        if (!Number.isFinite(speed) || speed < 0) {
          this.sys('Usage: #replay [speed]   (1 = real time, 0 = max speed)');
          return;
        }
        this.pickReplayFile(speed);
        return;
      }
      case 'help':
        for (const l of HELP_LINES) this.sys(l);
        return;
      default:
        this.sys(`Unknown command: #${name}`);
    }
  }

  private async runlog(): Promise<void> {
    try {
      const name = await downloadRun(this.recorder);
      this.sys(name ? `Downloaded ${name}.` : 'No run to download yet.');
    } catch (err) {
      this.sys(`#runlog failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Opens a file picker (Enter is a user gesture) and replays the chosen log. */
  private pickReplayFile(speed: number): void {
    const doc = this.el.ownerDocument;
    this.fileInput?.remove();
    const fi = doc.createElement('input');
    fi.type = 'file';
    fi.accept = '.log,text/plain';
    fi.hidden = true;
    fi.className = 'wc-replay-file';
    fi.addEventListener('change', () => {
      const file = fi.files?.[0];
      fi.remove();
      if (this.fileInput === fi) this.fileInput = null;
      if (!file) return;
      file.text().then(
        (text) => this.startReplay(text, file.name, speed),
        (err: unknown) => this.sys(`Could not read ${file.name}: ${String(err)}`),
      );
    });
    this.fileInput = fi;
    this.el.appendChild(fi);
    fi.click();
  }

  /** Emits `view.settings` when the screen part of the settings changed. */
  private announceView(): void {
    const json = JSON.stringify(viewSnapshot(this.settings.get()));
    if (json === this.viewJson) return;
    this.viewJson = json;
    this.bus.emit('view.settings', { json });
  }

  private sys(text: string): void {
    this.bus.emit('sys.message', { text });
  }
}
