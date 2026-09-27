// Entry point. URL parameters:
//
//   (none)                  connect to MUME at once (as Cockpit does)
//   ?replay                 offline: no connection; use #replay to load a log
//   ?fixture=<rel>&speed=n  dev server only: replay a fixture log from
//                           $WEBCOCKPIT_FIXTURES (see vite.config.ts)
//   ?bench                  offline, exposes window.__wcBench (bench/)

import './ui/ui.css';
import { App } from './app/app';
import type { BenchProbe } from './app/bench-hook';

const params = new URLSearchParams(location.search);
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
  ...(probe ? { requestFrame: probe.requestFrame } : {}),
});
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
