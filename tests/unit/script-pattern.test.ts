import { describe, expect, it } from 'vitest';
import { PatternError, compilePattern, matchPattern } from '../../src/script/engine/pattern';

const m = (pattern: string, text: string) => matchPattern(compilePattern(pattern), text)?.args ?? null;

describe('tt++ patterns', () => {
  it('plain text is literal and unanchored', () => {
    expect(m('WARNING', 'A WARNING!')).toEqual(['WARNING']);
    expect(m('a.b (c)', 'x a.b (c) y')).toEqual(['a.b (c)']);
    expect(m('a.b', 'axb')).toBeNull();
    expect(compilePattern('WARNING').plain).toBe(true);
  });

  it('^ and $ anchor only at the ends', () => {
    expect(m('^You', 'You see')).not.toBeNull();
    expect(m('^You', 'See You')).toBeNull();
    expect(m('end$', 'the end')).not.toBeNull();
    expect(m('end$', 'end it')).toBeNull();
    expect(m('a^b$c', 'a^b$c')).toEqual(['a^b$c']);
  });

  it('%1-%99 capture, lazy in the middle and greedy at the end', () => {
    expect(m('^%1 waves at you.$', 'Bob waves at you.')).toEqual(['Bob waves at you.', 'Bob']);
    expect(m('^%1key: \'%2\'$', "Bob the key: 'x y'")).toEqual(["Bob the key: 'x y'", 'Bob the ', 'x y']);
    expect(m('^-%1wound%2', '-light wound on leg')).toEqual(['-light wound on leg', 'light ', ' on leg']);
    expect(m('%2 then %1', 'b then a')).toEqual(['b then a', 'a', 'b']);
  });

  it('%* %+ %? %. and the classes', () => {
    expect(m('^a%*z$', 'abcz')).toEqual(['abcz', 'bc']);
    expect(m('^a%+z$', 'az')).toBeNull();
    expect(m('^a%?z$', 'abz')).toEqual(['abz', 'b']);
    expect(m('^a%.z$', 'abz')).toEqual(['abz', 'b']);
    expect(m('^%d apples$', '12 apples')).toEqual(['12 apples', '12']);
    expect(m('^%D$', 'abc')).toEqual(['abc', 'abc']);
    expect(m('^%w %W$', 'héllo ,.')).toEqual(['héllo ,.', 'héllo', ',.']);
    expect(m('^%s%S$', '  xy')).toEqual(['  xy', '  ', 'xy']);
    expect(m('^%a$', 'x\ny')).toEqual(['x\ny', 'x\ny']);
  });

  it('wildcards fill the argument after the highest used', () => {
    expect(m('^%1 has %d coins$', 'Bob has 5 coins')).toEqual(['Bob has 5 coins', 'Bob', '5']);
    expect(m('^%3 %d$', 'x 7')).toEqual(['x 7', '', '', 'x', '7']);
  });

  it('%+n..mX ranges', () => {
    expect(m('^b%+1..d$', 'b12')).toEqual(['b12', '12']);
    expect(m('^b%+1..d$', 'b')).toBeNull();
    expect(m('^b%+1..d$', 'bx')).toBeNull();
    expect(m('^%+2..3d$', '1234')).toBeNull();
    expect(m('^%+2..3d$', '123')).toEqual(['123', '123']);
    expect(m('^%+3w$', 'abc')).toEqual(['abc', 'abc']);
    expect(m('^%+3w$', 'abcd')).toBeNull();
  });

  it('%! does not store', () => {
    expect(m('^%!* says %1$', 'Bob says hi')).toEqual(['Bob says hi', 'hi']);
    expect(m('^%!{\\d+} %1$', '42 x')).toEqual(['42 x', 'x']);
  });

  it('%i makes the pattern case-insensitive', () => {
    expect(m('%ihello', 'HeLLo there')).toEqual(['HeLLo']);
    expect(m('hello', 'HeLLo')).toBeNull();
    expect(compilePattern('%ihello').literal).toBe('');
  });

  it('embeds {regex} as a stored group', () => {
    expect(m('^{\\d+} (gold|silver)$', '12 (gold|silver)')).toEqual(['12 (gold|silver)', '12']);
    expect(m('^You {hit|miss} %2$', 'You miss Bob')).toEqual(['You miss Bob', 'miss', 'Bob']);
    expect(m('^{(a)(b)} %2$', 'ab c')).toEqual(['ab c', 'ab', 'c']);
    expect(() => compilePattern('^{(}$')).toThrow(PatternError);
  });

  it('\\ makes the next character literal', () => {
    expect(m('100\\%', 'is 100%')).toEqual(['100%']);
    expect(m('cost\\$', 'cost$ here')).toEqual(['cost$']);
  });

  it('matches non-ASCII text', () => {
    expect(m('é', 'é')).toEqual(['é']);
    expect(m('^ẃ$', 'ẃ')).toEqual(['ẃ']);
    expect(m('^%1 säger$', 'Åsa säger')).toEqual(['Åsa säger', 'Åsa']);
  });

  it('keeps a literal for the indexOf pre-check', () => {
    expect(compilePattern('^%1 seems to be blinded!').literal).toBe(' seems to be blinded!');
    expect(compilePattern('^%1$').literal).toBe('');
  });
});

describe('match pre-checks (whole, lead, tail)', () => {
  // The fast paths must give exactly what the regex gives.
  const viaRegex = (p: string, text: string) => {
    const c = compilePattern(p);
    const m = c.re.exec(text);
    if (!m) return null;
    const args: string[] = new Array<string>(c.maxArg + 1).fill('');
    args[0] = m[0];
    for (let g = 1; g < m.length; g++) if (c.groupArg[g]) args[c.groupArg[g]!] = m[g] ?? '';
    return { args, index: m.index, end: m.index + m[0].length };
  };
  const patterns = ['%*', '%0', '%1', '%3', '^Wimpy set to: %1$', '^Wimpy removed.$', '^%1 of the Third Age.$',
    '^a%1b%2c$', 'abc', '^abc', 'abc$', '^{a|b}c$', '^%iAbc$', '^\\%x%1', '^%d%1$'];
  const texts = ['', 'abc', 'xabc', 'abcx', 'aXbYc', 'ABC', 'bc', 'Wimpy set to: 40', 'Wimpy removed.',
    'Wimpy removed. ', 'Afteryule of the Third Age.', '%xyz', '12 z', 'two\nlines', 'cr\rhere', 'ls sep'];
  it('agree with the plain regex on every pattern and text', () => {
    for (const p of patterns) for (const t of texts) expect(matchPattern(compilePattern(p), t), `${p} on ${JSON.stringify(t)}`).toEqual(viaRegex(p, t));
  });
  it('marks lone wildcards whole and anchored literals as lead / tail', () => {
    expect(compilePattern('%*').whole).toBe(true);
    expect(compilePattern('%!*').whole).toBe(false);
    expect(compilePattern('^%*').whole).toBe(false);
    expect(compilePattern('^Wimpy set to: %1$')).toMatchObject({ lead: 'Wimpy set to: ', tail: '' });
    expect(compilePattern('^%1 of the Third Age.$')).toMatchObject({ lead: '', tail: ' of the Third Age.' });
    expect(compilePattern('abc')).toMatchObject({ lead: '', tail: '' });
    expect(compilePattern('^%iAbc$')).toMatchObject({ lead: '', tail: '' });
  });
});
