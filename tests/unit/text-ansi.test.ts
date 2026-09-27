import { describe, expect, it } from 'vitest';
import { rgb } from '../../src/core/types';
import { ESC, harness, lines, one } from './text-helpers';

describe('LineAssembler: ANSI SGR', () => {
  it('parses a coloured line the way MUME sends it', () => {
    const l = one(`${ESC}[35mA blue wall appears.${ESC}[0m\r\n`);
    expect(l.text).toBe('A blue wall appears.');
    expect(l.runs).toEqual([{ start: 0, end: 20, fg: 5 }]);
    expect(l.raw).toBe(`${ESC}[35mA blue wall appears.${ESC}[0m`);
  });

  it('leaves unstyled gaps out of runs', () => {
    const l = one(`ab${ESC}[32mcd${ESC}[mef\n`);
    expect(l.runs).toEqual([{ start: 2, end: 4, fg: 2 }]);
  });

  it('maps bright and background colours', () => {
    const l = one(`${ESC}[91;104mX${ESC}[39mY${ESC}[49mZ\n`);
    expect(l.runs).toEqual([
      { start: 0, end: 1, fg: 9, bg: 12 },
      { start: 1, end: 2, bg: 12 },
    ]);
  });

  it('parses 256-colour and truecolor forms', () => {
    const l = one(`${ESC}[38;5;208mA${ESC}[48;2;1;2;3mB${ESC}[0m\n`);
    expect(l.runs).toEqual([
      { start: 0, end: 1, fg: 208 },
      { start: 1, end: 2, fg: 208, bg: rgb(1, 2, 3) },
    ]);
  });

  it('accepts colon separators', () => {
    expect(one(`${ESC}[38:5:21mA\n`).runs).toEqual([{ start: 0, end: 1, fg: 21 }]);
  });

  it('sets and clears attributes', () => {
    const l = one(
      `${ESC}[1;3;4;5;7mA${ESC}[22mB${ESC}[23mC${ESC}[24mD${ESC}[25mE${ESC}[27mF\n`,
    );
    expect(l.runs).toEqual([
      { start: 0, end: 1, bold: true, italic: true, underline: true, blink: true, inverse: true },
      { start: 1, end: 2, italic: true, underline: true, blink: true, inverse: true },
      { start: 2, end: 3, underline: true, blink: true, inverse: true },
      { start: 3, end: 4, blink: true, inverse: true },
      { start: 4, end: 5, inverse: true },
    ]);
  });

  it('keeps the colour index when bold (bold does not brighten)', () => {
    expect(one(`${ESC}[1;31mX\n`).runs).toEqual([{ start: 0, end: 1, fg: 1, bold: true }]);
  });

  it('handles MUME combined codes like 0;37;46', () => {
    expect(one(`${ESC}[0;37;46m foo ${ESC}[0m\n`).runs).toEqual([
      { start: 0, end: 5, fg: 7, bg: 6 },
    ]);
  });

  it('merges adjacent runs with identical style', () => {
    const l = one(`${ESC}[32mab${ESC}[0m${ESC}[32mcd${ESC}[32mef\n`);
    expect(l.runs).toEqual([{ start: 0, end: 6, fg: 2 }]);
  });

  it('keeps SGR state across lines', () => {
    const ls = lines(`${ESC}[33mone\r\ntwo${ESC}[0m\r\nthree\r\n`);
    expect(ls.map((l) => l.runs)).toEqual([
      [{ start: 0, end: 3, fg: 3 }],
      [{ start: 0, end: 3, fg: 3 }],
      [],
    ]);
    expect(ls[1]!.raw).toBe(`two${ESC}[0m`);
  });

  it('strips non-SGR CSI and other escape sequences from text and raw', () => {
    const l = one(`a${ESC}[2Jb${ESC}[?25lc${ESC}(Bd${ESC}]0;title\x07e${ESC}7f\n`);
    expect(l.text).toBe('abcdef');
    expect(l.raw).toBe('abcdef');
    expect(l.runs).toEqual([]);
  });

  it('handles escape sequences split across chunks', () => {
    const src = `x${ESC}[1;38;5;196my${ESC}[0mz\n`;
    for (let cut = 1; cut < src.length; cut++) {
      const h = harness();
      h.asm.text(src.slice(0, cut), 1);
      h.asm.text(src.slice(cut), 1);
      expect(h.lines).toEqual(lines(src));
    }
    expect(one(src).runs).toEqual([{ start: 1, end: 2, fg: 196, bold: true }]);
  });

  it('survives a lone ESC before a newline', () => {
    expect(lines(`a${ESC}\nb\n`).map((l) => l.text)).toEqual(['a', 'b']);
  });

  it('ignores a malformed extended colour', () => {
    expect(one(`${ESC}[38;9;1mA\n`).runs).toEqual([]);
  });
});
