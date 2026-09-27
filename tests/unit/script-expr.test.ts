import { describe, expect, it } from 'vitest';
import { ExprError, evalCondition as c, evalMath } from '../../src/script/engine/expr';
import { formatString } from '../../src/script/engine/format';

describe('#if expressions', () => {
  it('compares quoted strings, with * as a glob on the right', () => {
    expect(c('"abc" == "abc"')).toBe(true);
    expect(c('"abc" != "abc"')).toBe(false);
    expect(c('"*orc*" == "*orc*"')).toBe(true);
    expect(c('"a big orc" == "*orc*"')).toBe(true);
    expect(c('"a big elf" == "*orc*"')).toBe(false);
    expect(c('"Orc" == "orc"')).toBe(false);
    expect(c('"" != ""')).toBe(false);
    expect(c('"x" != ""')).toBe(true);
  });

  it('compares numbers numerically and strings lexically', () => {
    expect(c('10 > 9')).toBe(true);
    expect(c('"10" > "9"')).toBe(false);
    expect(c('2.5 <= 2.5')).toBe(true);
    expect(c('3 >= 4')).toBe(false);
    expect(c('5 == 5.0')).toBe(true);
  });

  it('has ||, && , ^^, ! and parentheses with the usual precedence', () => {
    expect(c('"a" == "b" || "c" == "c"')).toBe(true);
    expect(c('"a" == "a" && "c" == "d"')).toBe(false);
    expect(c('1 || 0 && 0')).toBe(true);
    expect(c('(1 || 0) && 0')).toBe(false);
    expect(c('!0')).toBe(true);
    expect(c('!("a" == "a")')).toBe(false);
    expect(c('1 ^^ 1')).toBe(false);
  });

  it('reads barewords, &name leftovers and truthiness', () => {
    expect(c('caster == caster')).toBe(true);
    expect(c('&nope')).toBe(false);
    expect(c('1')).toBe(true);
    expect(c('0')).toBe(false);
    expect(c('"0"')).toBe(false);
    expect(c('"yes"')).toBe(true);
    expect(c('')).toBe(false);
    expect(c('{a b} == {a b}')).toBe(true);
  });

  it('throws on syntax errors', () => {
    expect(() => c('(1')).toThrow(ExprError);
    expect(() => c('1 ==')).toThrow(ExprError);
  });
});

describe('#math', () => {
  it('does arithmetic with tt++ precision', () => {
    expect(evalMath('1 + 2 * 3')).toBe('7');
    expect(evalMath('(1 + 2) * 3')).toBe('9');
    expect(evalMath('7 / 2')).toBe('3');
    expect(evalMath('7.0 / 2')).toBe('3.5');
    expect(evalMath('10 % 3')).toBe('1');
    expect(evalMath('-2 ** 2')).toBe('4');
    expect(evalMath('2 > 1')).toBe('1');
  });
  it('rejects division by zero', () => {
    expect(() => evalMath('1/0')).toThrow(ExprError);
  });
});

describe('#format', () => {
  const now = new Date(2026, 8, 27, 13, 4, 5).getTime();
  it('formats the basic codes', () => {
    expect(formatString('%s-%s', ['a', 'b'], now)).toBe('a-b');
    expect(formatString('[%5s][%-5s][%.2s]', ['ab', 'cd', 'xyz'], now)).toBe('[   ab][cd   ][xy]');
    expect(formatString('%d %03d %f %.1f', ['3.9', '7', '2', '2.25'], now)).toBe('3 007 2.00 2.3');
    expect(formatString('%x %X %c', ['255', '255', '65'], now)).toBe('ff FF A');
    expect(formatString('%u %l %n %r %L', ['ab', 'CD', 'bob', 'abc', 'héj'], now)).toBe('AB cd Bob cba 3');
    expect(formatString('%t', [], now)).toBe('13:04:05');
    expect(formatString('%T', [], now)).toBe(String(Math.floor(now / 1000)));
    expect(formatString('%U', [], now)).toBe(String(now * 1000));
    expect(formatString('100%% %q %s', [], now)).toBe('100% %q ');
  });
});
