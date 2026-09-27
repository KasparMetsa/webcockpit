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
