// Application shell (spec §2.1, §2.2): wires the layers together and owns
// the built-in commands.
//
//   socket → Session (telnet, GMCP, keep-alive) → LineAssembler → bus
//   bus → OutputPane, AppStatus, Recorder
//   InputPane → built-in commands | Session.sendCommand
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
// ReplaySocket. It is never captured: the replay socket is started without
// a character name, so the session stays in `login` and the Recorder (which
// starts only at `playing`) never records. `status.replay` is true meanwhile.
//
// After a replay, or when the page was opened in an offline mode (`?replay`,
// `?fixture=`, `?bench`), Enter on a closed connection does not connect to
// MUME; `#connect` does. After a live disconnect, Enter reconnects.

import { downloadRun } from '../capture/download';
import { Recorder, type RecorderOptions } from '../capture/recorder';
import { Bus } from '../core/bus';
import type { BusEvents, Socketish } from '../core/types';
import { ReplaySocket } from '../net/replay-socket';
import { REASON_USER_RECONNECT, Session } from '../net/session';
import { LineAssembler } from '../text/assembler';
import { InputPane } from '../ui/input-pane';
import { CellMetrics } from '../theme/cells';
import { Cockpit } from '../layout/cockpit';
import { SettingsStore } from '../settings';
import { OutputPane } from '../ui/output-pane';
import { AppStatus, type AppStatusView, formatStatus } from './status';

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

  /** The current (or last) connection is a replay. */
  private replaying = false;
  /** Enter on a closed connection does not connect live. */
  private offline: boolean;
  private replayLabel = '';
  private charName = '';
  private fileInput: HTMLInputElement | null = null;

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
    this.cockpit = new Cockpit({
      root: this.el,
      settings: opts.settings ?? new SettingsStore({ factory: null, storage: null, win: null }),
      cells: cells ?? new CellMetrics({ doc }),
      onFocusInput: () => this.input.focus(),
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
      ...(cells ? { cellWidth: () => cells.get().w } : {}),
    });
    cells?.subscribe(() => {
      this.output.remeasure();
      this.input.scheduleCaret();
    });
    const recOpts = opts.recorder ?? {};
    this.recorder = new Recorder(bus, {
      ...recOpts,
      onStatus: (s) => {
        this.statusImpl.set({ capture: s });
        recOpts.onStatus?.(s);
      },
    });

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
        break;
      case 'login':
        if (!this.replaying) this.sys('Connected.');
        break;
      case 'playing':
        this.sys(`${this.charName || 'Character'} logged in.`);
        break;
      case 'disconnected':
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

  // -------------------------------------------------------------- commands

  /** Input hook: returns true when `text` was handled and must not be sent. */
  onCommand(text: string): boolean {
    const t = text.trim();
    if (t.startsWith('#')) {
      this.runBuiltin(t);
      return true;
    }
    const s = this.session.state;
    if (s === 'disconnected' || s === 'idle') {
      if (this.offline) this.sys('Not connected. #connect plays live, #replay loads a log.');
      else this.connectLive();
      return true;
    }
    return false;
  }

  private runBuiltin(t: string): void {
    const parts = t.split(/\s+/);
    const word = parts[0]!.toLowerCase();
    const args = parts.slice(1);
    switch (word) {
      case '#connect':
        this.connectLive();
        return;
      case '#disconnect':
        if (!this.isConnected) this.sys('Not connected.');
        else this.session.disconnect();
        return;
      case '#reconnect':
        if (this.replaying && this.isConnected) this.session.disconnect(REASON_REPLAY_STOP);
        this.replaying = false;
        this.offline = false;
        this.statusImpl.set({ replay: false });
        this.session.reconnect();
        return;
      case '#runlog':
        void this.runlog();
        return;
      case '#replay': {
        const speed = args[0] === undefined ? 1 : Number(args[0]);
        if (!Number.isFinite(speed) || speed < 0) {
          this.sys('Usage: #replay [speed]   (1 = real time, 0 = max speed)');
          return;
        }
        this.pickReplayFile(speed);
        return;
      }
      case '#help':
        for (const l of HELP_LINES) this.sys(l);
        return;
      default:
        this.sys(`Unknown command: ${parts[0]}`);
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

  private sys(text: string): void {
    this.bus.emit('sys.message', { text });
  }
}
