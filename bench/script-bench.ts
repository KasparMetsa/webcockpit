// Script engine benchmark (spec §1.3 "500 user rules < 0.2 ms per line").
//
//   node bench/script-bench.ts
//
// Replays the inbound lines of the biggest Cockpit raw log through the
// LineAssembler once to get real Line objects, then runs every line
// through ScriptEngine.processLine (actions, substitutes, gags,
// highlights → text.display) with no rules and with the 500-rule profile
// from bench/rules.ts. Prints µs per line. Also times the key → send
// script path (a macro that runs an alias that sends). The browser numbers
// that go into bench/results/latest.md come from bench/browser-bench.ts.

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        try {
          return next(specifier + '.ts', context);
        } catch {
          return next(specifier + '/index.ts', context);
        }
      }
      throw err;
    }
  },
});

const { Bus } = await import('../src/core/bus');
const { LineAssembler } = await import('../src/text/assembler');
const { ScriptEngine } = await import('../src/script/engine');
const { makeRuleProfile, RULE_COUNT } = await import('./rules');
const { GameState } = await import('../src/gmcp/state');
const { RunEventDeriver } = await import('../src/runs/events');
const { FakeScheduler } = await import('../src/script/engine/timers');
const { biggestFixture, FIXTURES_ROOT } = await import('../tests/e2e/fixtures');
type Line = import('../src/core/types').Line;

const fixture = biggestFixture();
if (!fixture) {
  console.log(`script-bench: no .log under ${FIXTURES_ROOT}, skipped`);
  process.exit(0);
}

const lines: Line[] = [];
{
  const bus = new Bus();
  bus.on('text.line', (l) => lines.push(l));
  const asm = new LineAssembler(bus);
  for (const raw of readFileSync(fixture.path, 'utf8').split('\n')) {
    const sp = raw.indexOf(' ');
    if (sp < 0) continue;
    const rest = raw.slice(sp + 1);
    if (rest.startsWith('> ') || rest === '>') continue;
    asm.text(rest + '\r\n', 0);
  }
}

function perLine(profile: string | null, system = false): { us: number; shown: number; sent: number } {
  const bus = new Bus();
  let shown = 0;
  let sent = 0;
  bus.on('text.display', () => shown++);
  const e = new ScriptEngine({ send: () => sent++, message: () => {} });
  e.attach(bus);
  // The app's system rules: game state (clock, wimpy) and the timers
  // trackers (ADR 0017), as App installs them. The hub is not attached, so
  // its UI lines go nowhere.
  const game = system ? new GameState() : null;
  // The run events' death-line rule (ADR 0018), with a run started so every
  // line is looked at; folds wait on a scheduler that never runs.
  const runs = system ? new RunEventDeriver({ scheduler: new FakeScheduler() }).attach(bus) : null;
  if (game && runs) {
    game.installRules(e.system);
    game.timers.installRules(e.system);
    runs.installRules(e.system);
    bus.emit('conn.state', { state: 'playing', prev: 'login' });
    runs.onGmcp('Char.Vitals', { xp: 1 }, 0);
  }
  if (profile) {
    const r = e.loadProfile(profile);
    if (!r.ok) throw new Error(r.reason);
  }
  const once = (): number => {
    const t0 = performance.now();
    for (let i = 0; i < lines.length; i++) e.processLine(lines[i]!);
    return performance.now() - t0;
  };
  once(); // warm up
  const times: number[] = [];
  for (let i = 0; i < 5; i++) times.push(once());
  times.sort((a, b) => a - b);
  e.dispose();
  game?.dispose();
  runs?.dispose();
  return { us: (times[2]! / lines.length) * 1000, shown: shown / 6, sent: sent / 6 };
}

function keyPath(profile: string): { macroUs: number; aliasUs: number } {
  let n = 0;
  const e = new ScriptEngine({ send: () => n++, message: () => {} });
  e.loadProfile(profile);
  const time = (fn: () => void): number => {
    for (let i = 0; i < 2000; i++) fn();
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) fn();
    return ((performance.now() - t0) / 20000) * 1000;
  };
  const macroUs = time(() => e.runMacro('F5'));
  const aliasUs = time(() => e.input('bb'));
  e.dispose();
  return { macroUs, aliasUs };
}

const profile = makeRuleProfile(lines.map((l) => l.text));
console.log(`script-bench: ${fixture.rel}, ${lines.length} lines`);
const base = perLine(null);
console.log(`  no rules:  ${base.us.toFixed(2)} µs per line`);
const full = perLine(profile);
console.log(
  `  ${RULE_COUNT} rules: ${full.us.toFixed(2)} µs per line (budget 200 µs) ${full.us < 200 ? 'PASS' : 'FAIL'}; ` +
    `${full.shown} lines shown`,
);
const sys = perLine(null, true);
console.log(`  system rules (game + timers + runs): ${sys.us.toFixed(2)} µs per line (+${(sys.us - base.us).toFixed(2)})`);
const both = perLine(profile, true);
console.log(
  `  ${RULE_COUNT} rules + system: ${both.us.toFixed(2)} µs per line (budget 200 µs) ${both.us < 200 ? 'PASS' : 'FAIL'}`,
);
const key = keyPath(profile);
console.log(`  key path:  macro → alias → send ${key.macroUs.toFixed(2)} µs, typed alias ${key.aliasUs.toFixed(2)} µs (budget 1000 µs)`);
