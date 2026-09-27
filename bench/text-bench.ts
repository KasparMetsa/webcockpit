// Line layer throughput benchmark.
//
//   node bench/text-bench.ts
//
// Feeds the inbound lines of the biggest Cockpit raw log (Inv §7.1) found
// under $WEBCOCKPIT_FIXTURES (default /home/ole/MUME/data/runs) through the
// LineAssembler, once as plain ANSI text and once rewritten into MUME XML
// mode (escaped `<>&`, prompts wrapped in `<prompt>`), and prints MB/s.
// Skips gracefully when no log is available.
//
// Node runs the TypeScript directly (type stripping). src/ uses
// extensionless imports, so a small resolve hook adds `.ts`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
        return next(specifier + '.ts', context);
      }
      throw err;
    }
  },
});

const { Bus } = await import('../src/core/bus');
const { LineAssembler } = await import('../src/text/assembler');

function biggestLog(root: string): string | null {
  if (!existsSync(root)) return null;
  let best: string | null = null;
  let bestSize = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.log') && st.size > bestSize) {
        best = p;
        bestSize = st.size;
      }
    }
  };
  walk(root);
  return best;
}

type Op = { text: string; ga: boolean };

/** Groups inbound lines into frames ending at a prompt (as MUME sends them). */
function buildOps(lines: string[], xml: boolean): { ops: Op[]; bytes: number } {
  const ops: Op[] = [];
  let buf = xml ? '<xml>' : '';
  let bytes = 0;
  const esc = (s: string): string =>
    xml ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : s;
  for (const l of lines) {
    if (l.endsWith('>') && l.length < 80) {
      buf += xml ? `<prompt>${esc(l)}</prompt>` : l;
      ops.push({ text: buf, ga: true });
      bytes += buf.length;
      buf = '\r\n';
    } else {
      buf += esc(l) + '\r\n';
      if (buf.length > 4096) {
        ops.push({ text: buf, ga: false });
        bytes += buf.length;
        buf = '';
      }
    }
  }
  if (buf) {
    ops.push({ text: buf, ga: false });
    bytes += buf.length;
  }
  return { ops, bytes };
}

function run(label: string, ops: Op[], bytes: number): void {
  const bus = new Bus();
  let lines = 0;
  bus.on('text.line', () => lines++);
  bus.on('text.partial', () => {});
  const asm = new LineAssembler(bus);
  const once = (): number => {
    asm.reset();
    lines = 0;
    const t0 = performance.now();
    for (const op of ops) {
      asm.text(op.text, 0);
      if (op.ga) asm.ga(0);
    }
    return performance.now() - t0;
  };
  for (let i = 0; i < 3; i++) once(); // warm up
  const times: number[] = [];
  for (let i = 0; i < 7; i++) times.push(once());
  times.sort((a, b) => a - b);
  const ms = times[3]!;
  const mb = bytes / 1e6;
  console.log(
    `${label}: ${mb.toFixed(2)} MB, ${lines} lines, median ${ms.toFixed(1)} ms` +
      ` → ${(mb / (ms / 1000)).toFixed(0)} MB/s, ${((ms / mb) * 1).toFixed(1)} ms per MB`,
  );
}

const root = process.env.WEBCOCKPIT_FIXTURES ?? '/home/ole/MUME/data/runs';
const log = biggestLog(root);
if (!log) {
  console.log(`text-bench: no .log under ${root}, skipped`);
} else {
  console.log(`text-bench: ${log}`);
  const inbound: string[] = [];
  for (const raw of readFileSync(log, 'utf8').split('\n')) {
    const sp = raw.indexOf(' ');
    if (sp < 0) continue;
    const rest = raw.slice(sp + 1);
    if (rest.startsWith('> ') || rest === '>') continue;
    inbound.push(rest);
  }
  const plain = buildOps(inbound, false);
  run('ansi', plain.ops, plain.bytes);
  const xml = buildOps(inbound, true);
  run('xml ', xml.ops, xml.bytes);
}
