import { describe, expect, it } from 'vitest';
import { rgb } from '../../src/core/types';
import { parseColored, parseHighlight } from '../../src/script/engine/color';
import { overlay, splice, styleAt } from '../../src/script/engine/runs';

describe('colour codes', () => {
  it('parses 24-bit and 12-bit truecolour codes', () => {
    const c = parseColored('<F9AA8B7>## TARGET: <FFFFFFF>orc<099>!');
    expect(c.text).toBe('## TARGET: orc!');
    expect(c.runs).toEqual([
      { start: 0, end: 11, fg: rgb(0x9a, 0xa8, 0xb7) },
      { start: 11, end: 14, fg: rgb(0xff, 0xff, 0xff) },
    ]);
    expect(parseColored('<Ff00>x').runs).toEqual([{ start: 0, end: 1, fg: rgb(255, 0, 0) }]);
    expect(parseColored('<B00ff00>x').runs).toEqual([{ start: 0, end: 1, bg: rgb(0, 255, 0) }]);
    expect(parseColored('<B0f0>x').runs).toEqual([{ start: 0, end: 1, bg: rgb(0, 255, 0) }]);
  });

  it('parses <abc> attribute/fg/bg digits', () => {
    expect(parseColored('<131>x').runs).toEqual([{ start: 0, end: 1, bold: true, fg: 3, bg: 1 }]);
    expect(parseColored('<488>x').runs).toEqual([{ start: 0, end: 1, underline: true }]);
    expect(parseColored('<fg><021>x<099>y').text).toBe('<fg>xy');
    expect(parseColored('<021>x<099>y').runs).toEqual([{ start: 0, end: 1, fg: 2, bg: 1 }]);
    expect(parseColored('<571>x').runs).toEqual([{ start: 0, end: 1, blink: true, fg: 7, bg: 1 }]);
    expect(parseColored('<700>x').runs).toEqual([{ start: 0, end: 1, inverse: true, fg: 0, bg: 0 }]);
  });

  it('parses 256-colour and grey codes', () => {
    expect(parseColored('<fff>x').runs).toEqual([{ start: 0, end: 1, fg: 231 }]);
    expect(parseColored('<AAB>x').runs).toEqual([{ start: 0, end: 1, bg: 17 }]);
    expect(parseColored('<g23>x<G00>y').runs).toEqual([
      { start: 0, end: 1, fg: 255 },
      { start: 1, end: 2, fg: 255, bg: 232 },
    ]);
  });

  it('drops invalid code-shaped tags silently and keeps other <text>', () => {
    const c = parseColored('<Fff0000>-light wound<900>');
    expect(c.text).toBe('-light wound');
    expect(c.runs).toEqual([{ start: 0, end: 12, fg: rgb(255, 0, 0) }]);
    expect(parseColored('<g99>x').text).toBe('x');
    expect(parseColored('a <b> <hello> <x').text).toBe('a <b> <hello> <x');
  });

  it('starts from a base style', () => {
    expect(parseColored('ab<099>c', { fg: 2 }).runs).toEqual([{ start: 0, end: 2, fg: 2 }]);
    expect(parseColored('plain', { fg: 2 }).runs).toEqual([{ start: 0, end: 5, fg: 2 }]);
  });
});

describe('highlight colour names', () => {
  it('capitalised or light = bright, lower case = normal', () => {
    expect(parseHighlight('red')).toEqual({ fg: 1 });
    expect(parseHighlight('Red')).toEqual({ fg: 9 });
    expect(parseHighlight('light red')).toEqual({ fg: 9 });
    expect(parseHighlight('Cyan')).toEqual({ fg: 14 });
    expect(parseHighlight('Magenta')).toEqual({ fg: 13 });
    expect(parseHighlight('green')).toEqual({ fg: 2 });
    expect(parseHighlight('dark Green')).toEqual({ fg: 2 });
  });

  it('takes b <colour> as background, and style words', () => {
    expect(parseHighlight('underscore blink reverse yellow b blue')).toEqual({ underline: true, blink: true, inverse: true, fg: 3, bg: 4 });
    expect(parseHighlight('b White')).toEqual({ bg: 15 });
    expect(parseHighlight('bold, white')).toEqual({ bold: true, fg: 7 });
  });

  it('accepts colour codes, rejects nonsense', () => {
    expect(parseHighlight('<Fff8800>')).toEqual({ fg: rgb(255, 136, 0) });
    expect(parseHighlight('<fff><AAA>')).toEqual({ fg: 231, bg: 16 });
    expect(parseHighlight('sparkly')).toBeNull();
    expect(parseHighlight('')).toBeNull();
  });
});

describe('style run edits', () => {
  it('overlays a style on a range, splitting and merging runs', () => {
    const runs = [{ start: 0, end: 4, fg: 1 }];
    expect(overlay(runs, 10, 2, 6, { fg: 3 })).toEqual([
      { start: 0, end: 2, fg: 1 },
      { start: 2, end: 6, fg: 3 },
    ]);
    expect(overlay([], 5, 1, 3, { underline: true })).toEqual([{ start: 1, end: 3, underline: true }]);
    expect(overlay([{ start: 0, end: 5, bold: true }], 5, 1, 3, { fg: 2 })).toEqual([
      { start: 0, end: 1, bold: true },
      { start: 1, end: 3, bold: true, fg: 2 },
      { start: 3, end: 5, bold: true },
    ]);
  });

  it('splices text and shifts later runs', () => {
    const out = splice('aaXXbb', [{ start: 0, end: 2, fg: 1 }, { start: 4, end: 6, fg: 2 }], 2, 4, 'yyy', [{ start: 0, end: 3, fg: 5 }]);
    expect(out.text).toBe('aayyybb');
    expect(out.runs).toEqual([
      { start: 0, end: 2, fg: 1 },
      { start: 2, end: 5, fg: 5 },
      { start: 5, end: 7, fg: 2 },
    ]);
  });

  it('reads the style at a position', () => {
    expect(styleAt([{ start: 2, end: 4, fg: 1 }], 3)).toEqual({ fg: 1 });
    expect(styleAt([{ start: 2, end: 4, fg: 1 }], 4)).toEqual({});
  });
});
