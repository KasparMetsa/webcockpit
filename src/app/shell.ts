// Page flow (ADR 0010 "Page flow", ADR 0013): start page ↔ cockpit, the
// ESC menu and its auto-open on disconnect.
//
//   /                      start page; Enter MUME builds the cockpit (once)
//                          and connects
//   ?replay, ?fixture=,    straight to the cockpit, offline, as in stage 1
//   ?bench
//
// The App is built on the first Enter MUME and reused for every later
// session in the tab (Exit session hides it and shows the start page; the
// output keeps its scrollback). Switching views is synchronous, so there
// is never a blank frame between them.
//
// The chrome (Preact) is a separate chunk. On `/` it is loaded at once
// (the start page is chrome); in the offline modes it is prefetched after
// start-up (not in `?bench`, where it loads on the first ESC). The profile
// editor (CodeMirror) is a chunk of its own, imported by the chrome when it
// is opened and prefetched when idle once the start page is up.
//
// ESC menu auto-open (Inv §4.7): on a transition from login/playing to
// disconnected on a live connection, unless the user caused it (#reconnect,
// #disconnect, Exit session, a replay starting), unless the menu is
// already open, and never before the first connection reached login.
// Reconnect is pre-selected then.

import type { BenchProbe } from './bench-hook';
import type { ChromeServices, EscMenuHandle, StartPageHandle } from '../chrome';
import type { ApplyResult } from '../editor';
import type { ConnState } from '../core/types';
import { CLIENT_VERSION } from '../net/gmcp';
import { REASON_USER_DISCONNECT, REASON_USER_RECONNECT } from '../net/session';
import { DEFAULT_PROFILE, ProfileStore } from '../profiles';
import type { SettingsStore } from '../settings';
import type { CellMetrics } from '../theme/cells';
import { App, REASON_REPLAY_START } from './app';

type ChromeModule = typeof import('../chrome');

/**
 * The live profile apply the ESC menu's editor calls (ADR 0015, Inv §4.5).
 * Package P2 adds `App.applyProfile`; until it exists the adapter reports
 * none and the editor's Apply only saves.
 */
interface LiveProfileApp {
  applyProfile?: (text: string) => ApplyResult;
}

/** The app's live apply, bound, or null when it has none. */
export function liveApplyOf(app: object): ((text: string) => ApplyResult) | null {
  const a = app as LiveProfileApp;
  return typeof a.applyProfile === 'function' ? (text) => a.applyProfile!.call(app, text) : null;
}

/** Reasons that never auto-open the menu: the user asked for the disconnect. */
const QUIET_REASONS = new Set([REASON_USER_RECONNECT, REASON_USER_DISCONNECT, REASON_REPLAY_START]);

export interface ShellOptions {
  /** The page root (#app). */
  root: HTMLElement;
  settings: SettingsStore;
  cells: CellMetrics;
  /** Offline cockpit mode (`?replay`, `?fixture=`, `?bench`): no start page. */
  offline: boolean;
  /** `?bench`: the probe's frame scheduler, and no chrome prefetch. */
  probe?: BenchProbe | null;
  /** Profile store (tests inject one). */
  profiles?: ProfileStore;
}

export class Shell {
  private readonly opts: ShellOptions;
  readonly profiles: ProfileStore;
  private appRef: App | null = null;
  private chromeP: Promise<ChromeModule> | null = null;
  private startHost: HTMLDivElement;
  private menuHost: HTMLDivElement;
  private start: StartPageHandle | null = null;
  private menu: EscMenuHandle | null = null;
  /** The cockpit is the visible view. */
  private inCockpit = false;
  /** Some live connection has reached login (the bootstrap guard). */
  private everUp = false;
  private prevConn: ConnState = 'idle';
  /** The current connection is a replay. */
  private connIsReplay = false;

  constructor(opts: ShellOptions) {
    this.opts = opts;
    this.profiles = opts.profiles ?? new ProfileStore();
    const doc = opts.root.ownerDocument;
    this.startHost = doc.createElement('div');
    this.startHost.className = 'wc-start-host';
    this.startHost.style.cssText = 'position:relative;height:100%;display:none';
    this.menuHost = doc.createElement('div');
    this.menuHost.className = 'wc-menu-host';
    opts.root.append(this.startHost, this.menuHost);
  }

  /** The cockpit, once built. */
  get app(): App | null {
    return this.appRef;
  }

  /** Shows the first view: the start page, or the cockpit in the offline modes. */
  async boot(): Promise<void> {
    void this.initProfiles();
    if (this.opts.offline) {
      this.showCockpit(this.ensureApp());
      if (!this.opts.probe) this.prefetchChrome();
      return;
    }
    const chrome = await this.loadChrome();
    this.start = chrome.mountStartPage(this.startHost, this.services(), { onEnter: () => this.enter() });
    this.showStart();
    this.idle(() => void import('../editor').catch(() => undefined));
  }

  /** Enter MUME: shows the cockpit and connects. */
  enter(): void {
    const app = this.ensureApp();
    this.showCockpit(app);
    app.connectLive();
  }

  /** Exit session: closes the connection and returns to the start page. */
  async exitSession(): Promise<void> {
    const app = this.appRef;
    if (app && app.status.get().conn !== 'disconnected' && app.status.get().conn !== 'idle') {
      app.session.disconnect(REASON_USER_DISCONNECT);
    }
    if (!this.start) {
      const chrome = await this.loadChrome();
      this.start = chrome.mountStartPage(this.startHost, this.services(), { onEnter: () => this.enter() });
    }
    this.menu?.close();
    this.showStart();
  }

  /** Opens the ESC menu over the cockpit (no-op elsewhere or when open). */
  async openMenu(preselect?: 'continue' | 'reconnect'): Promise<void> {
    if (!this.inCockpit || !this.appRef) return;
    const menu = await this.ensureMenu(this.appRef);
    if (!this.inCockpit) return;
    menu.open(preselect ? { preselect } : {});
  }

  /** Closes the ESC menu and gives the input its focus back. */
  closeMenu(): void {
    this.menu?.close();
    if (this.inCockpit) this.appRef?.input.focus();
  }

  get menuOpen(): boolean {
    return this.menu?.isOpen ?? false;
  }

  // ------------------------------------------------------------------ views

  private showStart(): void {
    this.inCockpit = false;
    if (this.appRef) this.appRef.el.style.display = 'none';
    this.startHost.style.display = '';
    this.start?.show();
  }

  private showCockpit(app: App): void {
    this.start?.hide();
    this.startHost.style.display = 'none';
    app.el.style.display = '';
    this.inCockpit = true;
    app.input.focus();
  }

  private ensureApp(): App {
    if (this.appRef) return this.appRef;
    const { root, cells, offline, probe, settings } = this.opts;
    const app = new App({
      root,
      offline,
      cells,
      settings,
      onEscape: () => void this.openMenu(),
      ...(probe ? { requestFrame: probe.requestFrame } : {}),
    });
    // Keep the menu host last, so the overlay is above the cockpit in DOM order too.
    root.appendChild(this.menuHost);
    app.bus.on('conn.state', (s) => this.onConn(s.state, s.reason ?? ''));
    this.appRef = app;
    return app;
  }

  private onConn(state: ConnState, reason: string): void {
    const app = this.appRef!;
    const prev = this.prevConn;
    this.prevConn = state;
    if (state === 'connecting') this.connIsReplay = app.status.get().replay;
    if ((state === 'login' || state === 'playing') && !this.connIsReplay) this.everUp = true;
    if (state !== 'disconnected') return;
    const wasUp = prev === 'login' || prev === 'playing';
    if (!wasUp || !this.everUp || this.connIsReplay || QUIET_REASONS.has(reason)) return;
    if (!this.inCockpit || this.menuOpen) return;
    void this.openMenu('reconnect');
  }

  // ----------------------------------------------------------------- chrome

  private services(): ChromeServices {
    return {
      settings: this.opts.settings,
      cells: this.opts.cells,
      profiles: this.profiles,
      version: CLIENT_VERSION,
    };
  }

  private loadChrome(): Promise<ChromeModule> {
    this.chromeP ??= import('../chrome');
    return this.chromeP;
  }

  private prefetchChrome(): void {
    this.idle(() => void this.loadChrome().catch(() => (this.chromeP = null)));
  }

  /** Runs `go` when the page is idle (at most ~2 s later). */
  private idle(go: () => void): void {
    const win = this.opts.root.ownerDocument.defaultView;
    if (win?.requestIdleCallback) win.requestIdleCallback(go, { timeout: 2000 });
    else setTimeout(go, 500);
  }

  private async ensureMenu(app: App): Promise<EscMenuHandle> {
    if (this.menu) return this.menu;
    const chrome = await this.loadChrome();
    this.menu ??= chrome.mountEscMenu(this.menuHost, this.services(), {
      status: app.status,
      close: () => this.closeMenu(),
      reconnect: () => {
        this.closeMenu();
        app.onCommand('#reconnect');
      },
      exit: () => void this.exitSession(),
      liveApply: () => liveApplyOf(app),
    });
    return this.menu;
  }

  /** Seeds `default` and makes sure the selected profile exists. */
  private async initProfiles(): Promise<void> {
    try {
      await this.profiles.init();
      const sel = this.opts.settings.get().profile;
      if (!(await this.profiles.get(sel))) this.opts.settings.update({ profile: DEFAULT_PROFILE });
    } catch {
      /* the profile frame reports storage errors */
    }
  }
}
