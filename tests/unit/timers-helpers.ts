// A test bench for the timers trackers: the real trackers behind a fake
// host (a settable clock, recorded UI lines) and a ScriptEngine whose system
// store holds their rules, so lines go the same way as in the app.

import type { Line, UiMessage } from '../../src/core/types';
import { ScriptEngine } from '../../src/script/engine';
import type { TimerCell, TimerGroup } from '../../src/timers/entry';
import type { StateTag, TrackerHost } from '../../src/timers/tracker';
import { buildTrackers } from '../../src/timers/trackers';

export const T0 = 1_790_000_000_000;

export function plain(m: UiMessage): string {
  const text = m.parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');
  if (m.kind === 'state') return `◆ ${m.tag}: ${text}`;
  if (m.kind === 'event') return `▶ ${m.name}: ${text}`;
  if (m.kind === 'warn') return `⚠ WARN: ${text}`;
  return text;
}

export function mkLine(text: string): Line {
  return { text, runs: [], tags: [], prompt: false, raw: text, ts: 0 };
}

export function bench() {
  let t = T0;
  const msgs: string[] = [];
  const errors: string[] = [];
  let changes = 0;
  const host: TrackerHost = {
    now: () => t,
    changed: () => void changes++,
    announce: (tag: StateTag, name: string, verb: string, detail?: string) =>
      msgs.push(`◆ ${tag}: ${name} ${verb}${detail ? ` (${detail})` : ''}.`),
    message: (m) => msgs.push(plain(m)),
  };
  const tr = buildTrackers(host);
  const engine = new ScriptEngine({ send: () => {}, message: (s) => errors.push(s) });
  for (const x of tr.list) x.installRules?.(engine.system);
  const line = (...texts: string[]): void => {
    for (const s of texts) engine.processLine(mkLine(s));
  };
  const send = (text: string): void => {
    for (const x of tr.list) x.onSent?.(text, t);
  };
  /** Advances the clock `secs` seconds, ticking every second as the hub does. */
  const advance = (secs: number): void => {
    const end = t + secs * 1000;
    while (t < end) {
      t = Math.min(end, t + 1000);
      for (const x of tr.list) x.tick?.(t);
    }
  };
  const cells = (group?: TimerGroup): TimerCell[] => {
    const all = tr.list.flatMap((x) => x.cells(t));
    return group ? all.filter((c) => c.group === group) : all;
  };
  const names = (group?: TimerGroup): string[] => cells(group).map((c) => c.name);
  const cell = (name: string): TimerCell | undefined => cells().find((c) => c.name === name);
  const take = (): string[] => msgs.splice(0);
  return {
    tr,
    engine,
    host,
    msgs,
    errors,
    line,
    send,
    advance,
    cells,
    names,
    cell,
    take,
    now: () => t,
    setNow: (v: number) => void (t = v),
    changes: () => changes,
  };
}
