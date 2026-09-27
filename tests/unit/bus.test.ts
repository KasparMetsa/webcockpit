import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../../src/core/bus';
import { TRUECOLOR, isTrueColor, nowUs, rgb } from '../../src/core/types';

describe('Bus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('delivers to handlers in subscription order', () => {
    const bus = new Bus();
    const seen: string[] = [];
    bus.on('sys.message', (p) => seen.push('a:' + p.text));
    bus.on('sys.message', (p) => seen.push('b:' + p.text));
    bus.emit('sys.message', { text: 'x' });
    expect(seen).toEqual(['a:x', 'b:x']);
  });

  it('only delivers to handlers of the emitted type', () => {
    const bus = new Bus();
    const fn = vi.fn();
    bus.on('telnet.echo', fn);
    bus.emit('sys.message', { text: 'x' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('supports void events', () => {
    const bus = new Bus();
    const fn = vi.fn();
    bus.on('xml.seen', fn);
    bus.emit('xml.seen', undefined);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isolates exceptions and keeps delivering', () => {
    const bus = new Bus();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    bus.on('sys.message', () => {
      throw new Error('boom');
    });
    bus.on('sys.message', after);
    bus.emit('sys.message', { text: 'x' });
    expect(after).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes idempotently', () => {
    const bus = new Bus();
    const fn = vi.fn();
    const off = bus.on('sys.message', fn);
    off();
    off();
    bus.emit('sys.message', { text: 'x' });
    expect(fn).not.toHaveBeenCalled();
    expect(bus.count('sys.message')).toBe(0);
  });

  it('does not call a handler added during emit until the next emit', () => {
    const bus = new Bus();
    const late = vi.fn();
    let added = false;
    bus.on('sys.message', () => {
      if (!added) {
        added = true;
        bus.on('sys.message', late);
      }
    });
    bus.emit('sys.message', { text: '1' });
    expect(late).not.toHaveBeenCalled();
    bus.emit('sys.message', { text: '2' });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('skips a handler removed during emit', () => {
    const bus = new Bus();
    const second = vi.fn();
    let off = () => {};
    bus.on('sys.message', () => off());
    off = bus.on('sys.message', second);
    const third = vi.fn();
    bus.on('sys.message', third);
    bus.emit('sys.message', { text: 'x' });
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it('lets a handler unsubscribe itself without disturbing others', () => {
    const bus = new Bus();
    const seen: string[] = [];
    const off = bus.on('sys.message', () => {
      seen.push('once');
      off();
    });
    bus.on('sys.message', () => seen.push('always'));
    bus.emit('sys.message', { text: '1' });
    bus.emit('sys.message', { text: '2' });
    expect(seen).toEqual(['once', 'always', 'always']);
  });

  it('delivers the same payload object to every handler', () => {
    const bus = new Bus();
    const got: unknown[] = [];
    bus.on('net.bytesIn', (b) => got.push(b));
    bus.on('net.bytesIn', (b) => got.push(b));
    const bytes = new Uint8Array([1, 2, 3]);
    bus.emit('net.bytesIn', bytes);
    expect(got[0]).toBe(bytes);
    expect(got[1]).toBe(bytes);
  });
});

describe('core helpers', () => {
  it('packs truecolor', () => {
    expect(rgb(0x12, 0x34, 0x56)).toBe(TRUECOLOR | 0x123456);
    expect(isTrueColor(rgb(0, 0, 0))).toBe(true);
    expect(isTrueColor(255)).toBe(false);
  });

  it('gives integer µs since epoch', () => {
    const t = nowUs();
    expect(Number.isInteger(t)).toBe(true);
    expect(Math.abs(t / 1000 - Date.now())).toBeLessThan(1000);
  });
});
