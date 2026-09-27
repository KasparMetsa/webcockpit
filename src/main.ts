// Entry point. URL parameters:
//
//   (none)                  connect to MUME at once (as Cockpit does)
//   ?replay                 offline: no connection; use #replay to load a log
//   ?fixture=<rel>&speed=n  dev server only: replay a fixture log from
//                           $WEBCOCKPIT_FIXTURES (see vite.config.ts)
//   ?bench                  offline, exposes window.__wcBench (bench/)
//   ?safe                   default appearance, not saved until changed
//                           (a way back from a setting that breaks the page)
//
// Start-up order: settings from the localStorage mirror → theme and font
// preload → settings from IndexedDB (≤ 1 s) → theme again → App. The cell
// metrics are re-measured once the web font has loaded.

import './theme/fonts.css';
import './ui/ui.css';
import { App } from './app/app';
import type { BenchProbe } from './app/bench-hook';
import { SettingsStore } from './settings';
import { appearanceChanged, applyTheme } from './theme/apply';
import { CellMetrics } from './theme/cells';
import { preloadFont } from './theme/fonts';

const params = new URLSearchParams(location.search);

const settings = new SettingsStore({ safe: params.has('safe') });
preloadFont(settings.get().appearance.font);
applyTheme(settings.get());
const cells = new CellMetrics();
void cells.update(settings.get().appearance);
await Promise.race([settings.load(), new Promise((r) => setTimeout(r, 1000))]);
settings.subscribe((next, prev) => {
  if (!appearanceChanged(next.appearance, prev.appearance)) return;
  applyTheme(next);
  if (next.appearance.font !== prev.appearance.font) preloadFont(next.appearance.font);
  void cells.update(next.appearance);
});
applyTheme(settings.get());
void cells.update(settings.get().appearance);

const fixture = import.meta.env.DEV ? params.get('fixture') : null;
const benchMode = params.has('bench');
const offline = benchMode || params.has('replay') || fixture !== null;

let probe: BenchProbe | null = null;
if (benchMode) {
  const { installBenchProbe } = await import('./app/bench-hook');
  probe = installBenchProbe();
}

const root = document.getElementById('app') ?? document.body;
root.textContent = '';
const app = new App({
  root,
  offline,
  cells,
  settings,
  ...(probe ? { requestFrame: probe.requestFrame } : {}),
});
if (import.meta.env.DEV) window.__wc = { app, settings, cells };
probe?.attach(app);
app.input.focus();

if (fixture !== null) {
  const speed = Number(params.get('speed') ?? '1');
  void loadFixture(fixture, Number.isFinite(speed) && speed >= 0 ? speed : 1);
} else if (!offline) {
  app.connectLive();
} else if (!benchMode) {
  app.bus.emit('sys.message', { text: 'Offline replay mode. Type #replay to load a Cockpit .log.' });
}

async function loadFixture(rel: string, speed: number): Promise<void> {
  const path = rel.split('/').map(encodeURIComponent).join('/');
  try {
    const res = await fetch(`/__fixtures/${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    app.startReplay(await res.text(), rel, speed);
  } catch (err) {
    app.bus.emit('sys.message', {
      text: `Fixture ${rel} could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

declare global {
  interface Window {
    /** Dev server only: handles for the browser tests and the console. */
    __wc?: { app: App; settings: SettingsStore; cells: CellMetrics };
  }
}
