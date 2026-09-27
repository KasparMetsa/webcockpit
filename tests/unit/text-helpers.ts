import { Bus } from '../../src/core/bus';
import type { Line } from '../../src/core/types';
import { LineAssembler } from '../../src/text/assembler';

export interface Harness {
  asm: LineAssembler;
  lines: Line[];
  partials: Line[];
  xmlSeen: number;
}

export function harness(): Harness {
  const bus = new Bus();
  const h: Harness = { asm: new LineAssembler(bus), lines: [], partials: [], xmlSeen: 0 };
  bus.on('text.line', (l) => h.lines.push(l));
  bus.on('text.partial', (l) => h.partials.push(l));
  bus.on('xml.seen', () => h.xmlSeen++);
  return h;
}

/** Feeds `s` as one chunk; `\u0001` in `s` stands for a GA. */
export function feed(h: Harness, s: string, ts = 1): void {
  const parts = s.split('\u0001');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) h.asm.text(parts[i]!, ts);
    if (i < parts.length - 1) h.asm.ga(ts);
  }
}

/** Runs `s` through a fresh assembler in one chunk and returns the lines. */
export function lines(s: string): Line[] {
  const h = harness();
  feed(h, s);
  return h.lines;
}

export function one(s: string): Line {
  const ls = lines(s);
  if (ls.length !== 1) throw new Error(`expected 1 line, got ${ls.length}`);
  return ls[0]!;
}

export const ESC = '\x1b';
export const GA = '\u0001';
