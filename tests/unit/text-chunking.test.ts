// Chunking fuzz: however the input is cut into chunks, the lines are the same.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Line } from '../../src/core/types';
import { ESC, GA, harness } from './text-helpers';

/** Feeds `src` cut at `cuts` (sorted offsets); `\u0001` is a GA. */
function run(src: string, cuts: number[]): Line[] {
  const h = harness();
  let prev = 0;
  for (const c of [...cuts, src.length]) {
    const piece = src.slice(prev, c);
    prev = c;
    const parts = piece.split(GA);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) h.asm.text(parts[i]!, 1);
      if (i < parts.length - 1) h.asm.ga(1);
    }
  }
  return h.lines;
}

/** Deterministic PRNG so failures are reproducible. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomCuts(len: number, rnd: () => number, max: number): number[] {
  const n = 1 + Math.floor(rnd() * max);
  const set = new Set<number>();
  for (let i = 0; i < n; i++) set.add(1 + Math.floor(rnd() * (len - 1)));
  return [...set].sort((a, b) => a - b);
}

const PRE_XML =
  `Welcome! <wielded> a sword &amp; stuff\r\n  <WE> Tindomiel\r\n*<* R>${GA}\r\n` +
  `${ESC}[1;37;46mBanner${ESC}[0m\n\r`;

const XML =
  `<xml><movement dir=north/><room terrain="field" area='The Shire'><name>${ESC}[36mThe Road${ESC}[0m</name>\r\n` +
  `<description>A road &amp; a &lt;sign&gt;.\r\nMore &#39;text&#x27;.\r\n</description>` +
  `<exits>Exits: north, south.</exits>\r\n</room>` +
  `<prompt>${ESC}[32m*${ESC}[0m R Mana:Hot&gt;</prompt>${GA}` +
  `\r\n<narrate>${ESC}[38;5;208mX narrates 'a &lt; b'${ESC}[0m</narrate>\r\n` +
  `${ESC}[2K${ESC}]0;t\x07<tell>${ESC}[48;2;10;20;30mY tells you 'hi'</tell>${ESC}[m\r\n` +
  `a < b <3\r\n<prompt>*&gt;</prompt>${GA}</xml><worn on belt> x &amp;\r\n`;

describe('LineAssembler: chunking fuzz', () => {
  for (const [name, src] of [
    ['pre-XML input', PRE_XML],
    ['XML input', XML],
  ] as const) {
    it(`gives identical lines for every single split point (${name})`, () => {
      const whole = run(src, []);
      expect(whole.length).toBeGreaterThan(3);
      for (let cut = 1; cut < src.length; cut++) {
        expect(run(src, [cut]), `cut at ${cut}`).toEqual(whole);
      }
    });

    it(`gives identical lines for random multi-splits (${name})`, () => {
      const whole = run(src, []);
      const rnd = prng(42);
      for (let k = 0; k < 300; k++) {
        const cuts = randomCuts(src.length, rnd, 40);
        expect(run(src, cuts), `cuts ${cuts.join(',')}`).toEqual(whole);
      }
    });
  }

  it('gives identical lines for one-character chunks', () => {
    const src = PRE_XML + XML;
    const all = Array.from({ length: src.length - 1 }, (_, i) => i + 1);
    expect(run(src, all)).toEqual(run(src, []));
  });

  const root = process.env.WEBCOCKPIT_FIXTURES ?? '/home/ole/MUME/data/runs';
  const log = (() => {
    if (!existsSync(root)) return null;
    for (const dir of readdirSync(root)) {
      const d = join(root, dir);
      if (!statSync(d).isDirectory()) continue;
      const f = readdirSync(d).find((n) => n.endsWith('.log'));
      if (f) return join(d, f);
    }
    return null;
  })();

  it.skipIf(!log)('gives identical lines for a real log cut at random points', () => {
    const inbound = readFileSync(log!, 'utf8')
      .split('\n')
      .slice(0, 3000)
      .map((l) => l.slice(l.indexOf(' ') + 1))
      .filter((l) => !l.startsWith('> '));
    const src = inbound.map((l) => (l.endsWith('>') ? l + GA : l + '\r\n')).join('');
    const whole = run(src, []);
    const rnd = prng(7);
    for (let k = 0; k < 20; k++) {
      expect(run(src, randomCuts(src.length, rnd, 2000))).toEqual(whole);
    }
  });
});
