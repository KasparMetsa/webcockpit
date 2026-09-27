import { describe, expect, it } from 'vitest';
import { LineRouter } from '../../src/timers/lines';

describe('LineRouter', () => {
  it('dispatches exact, prefix and suffix hits in registration order, watchers first', () => {
    const r = new LineRouter();
    const got: string[] = [];
    r.watch((t) => got.push(`w:${t}`));
    r.onLine('You feel better.', () => got.push('exact1'));
    r.onLine('You feel better.', () => got.push('exact2'));
    r.onLine('You feel worse.', () => got.push('other'));
    r.onPrefix('You ', () => got.push('prefix1'));
    r.onPrefix('You feel', () => got.push('prefix2'));
    r.onPrefix('Åh ', () => got.push('prefix-non-ascii'));
    r.onSuffix('better.', () => got.push('suffix'));
    r.onSuffix('…', () => got.push('suffix-non-ascii'));
    r.dispatch('You feel better.');
    expect(got).toEqual(['w:You feel better.', 'exact1', 'exact2', 'prefix1', 'prefix2', 'suffix']);
    got.length = 0;
    r.dispatch('Åh no…');
    expect(got).toEqual(['w:Åh no…', 'prefix-non-ascii', 'suffix-non-ascii']);
    got.length = 0;
    // Same length and first letter as an exact line, but a different text.
    r.dispatch('You feel bitter.');
    expect(got).toEqual(['w:You feel bitter.', 'prefix1', 'prefix2']);
    got.length = 0;
    r.dispatch('');
    expect(got).toEqual(['w:']);
    expect(r.size).toBe(2);
  });
});
