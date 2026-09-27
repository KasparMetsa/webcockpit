import { describe, expect, it } from 'vitest';
import { GA, feed, harness, lines, one } from './text-helpers';

describe('LineAssembler: line splitting', () => {
  it('splits on LF and strips CR in CRLF, LFCR and lone CR', () => {
    expect(lines('a\r\nb\n\rc\rd\n').map((l) => l.text)).toEqual(['a', 'b', 'cd']);
  });

  it('emits empty lines for blank lines', () => {
    expect(lines('a\r\n\r\nb\r\n').map((l) => l.text)).toEqual(['a', '', 'b']);
  });

  it('keeps tabs and drops other C0 controls and DEL', () => {
    const l = one('a\tb\x07c\x00d\x7fe\n');
    expect(l.text).toBe('a\tbcde');
    expect(l.raw).toBe('a\tbcde');
  });

  it('stamps a line with the ts of the chunk that completed it', () => {
    const h = harness();
    h.asm.text('hel', 10);
    h.asm.text('lo\nwor', 20);
    h.asm.text('ld\n', 30);
    expect(h.lines.map((l) => [l.text, l.ts])).toEqual([
      ['hello', 20],
      ['world', 30],
    ]);
  });

  it('marks ordinary lines as non-prompts', () => {
    expect(one('hello\n').prompt).toBe(false);
  });
});

describe('LineAssembler: prompts via GA', () => {
  it('turns the pending tail into a prompt line on GA', () => {
    const h = harness();
    h.asm.text('You see.\r\noO Mana:Hot>', 5);
    h.asm.ga(7);
    expect(h.lines.map((l) => [l.text, l.prompt, l.ts])).toEqual([
      ['You see.', false, 5],
      ['oO Mana:Hot>', true, 7],
    ]);
  });

  it('emits nothing for a GA with no pending text', () => {
    const h = harness();
    feed(h, 'a\r\n' + GA + GA);
    expect(h.lines.map((l) => l.text)).toEqual(['a']);
  });

  it('starts a fresh line after a prompt', () => {
    expect(lines('*>' + GA + '\r\nYou say hi\r\n').map((l) => [l.text, l.prompt])).toEqual([
      ['*>', true],
      ['', false],
      ['You say hi', false],
    ]);
  });

  it('flushes a split escape sequence at a GA instead of waiting', () => {
    const h = harness();
    h.asm.text('P>\x1b[3', 1);
    h.asm.ga(2);
    h.asm.text('1mred\n', 3);
    expect(h.lines.map((l) => l.text)).toEqual(['P>', '1mred']);
  });
});

describe('LineAssembler: partials', () => {
  it('emits the pending tail after each chunk, only when it changed', () => {
    const h = harness();
    h.asm.text('abc', 1);
    h.asm.text('\x1b[0m', 2); // no visible change
    h.asm.text('de', 3);
    expect(h.partials.map((p) => p.text)).toEqual(['abc', 'abcde']);
  });

  it('does not emit a partial when the chunk ends on a line boundary', () => {
    const h = harness();
    h.asm.text('abc\r\n', 1);
    expect(h.partials).toEqual([]);
    expect(h.lines.map((l) => l.text)).toEqual(['abc']);
  });

  it('emits a partial for the new tail after completing a line', () => {
    const h = harness();
    h.asm.text('ab', 1);
    h.asm.text('c\nxy', 2);
    expect(h.partials.map((p) => p.text)).toEqual(['ab', 'xy']);
    expect(h.lines.map((l) => l.text)).toEqual(['abc']);
  });

  it('shows a prompt as a partial before its GA', () => {
    const h = harness();
    h.asm.text('oO>', 1);
    expect(h.partials.map((p) => p.text)).toEqual(['oO>']);
    h.asm.ga(2);
    expect(h.lines.map((l) => [l.text, l.prompt])).toEqual([['oO>', true]]);
  });

  it('partials are snapshots and not changed by later input', () => {
    const h = harness();
    h.asm.text('\x1b[31mab', 1);
    const p = h.partials[0]!;
    h.asm.text('cd\n', 2);
    expect(p.text).toBe('ab');
    expect(p.runs).toEqual([{ start: 0, end: 2, fg: 1 }]);
  });

  it('reset clears a shown partial with an empty partial', () => {
    const h = harness();
    h.asm.text('abc', 1);
    h.asm.reset();
    expect(h.partials.map((p) => p.text)).toEqual(['abc', '']);
    h.asm.reset();
    expect(h.partials.length).toBe(2);
  });
});

describe('LineAssembler: reset', () => {
  it('drops the pending tail, carry and SGR state', () => {
    const h = harness();
    h.asm.text('\x1b[31mhalf\x1b[', 1);
    h.asm.reset();
    h.asm.text('new\n', 2);
    expect(h.lines).toEqual([{ text: 'new', runs: [], tags: [], prompt: false, raw: 'new', ts: 2 }]);
  });
});
