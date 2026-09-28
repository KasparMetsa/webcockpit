// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../../src/core/bus';
import type { Sender } from '../../src/core/types';
import {
  InputPane,
  type ScrollTarget,
  normalizePaste,
  spaceWordStartBefore,
  wordEndAfter,
  wordStartBefore,
} from '../../src/ui/input-pane';
import { AppStatus, formatLink, formatStatus } from '../../src/app/status';

function setup(onCommand?: (t: string) => boolean) {
  document.body.innerHTML = '';
  const bus = new Bus();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const sent: Array<{ text: string; opts?: { secret?: boolean; echo?: boolean } }> = [];
  const sender: Sender = {
    sendCommand: (text, opts) => sent.push(opts ? { text, opts } : { text }),
    sendGmcp: () => {},
  };
  let scrolled = false;
  const output: ScrollTarget & { calls: string[] } = {
    calls: [],
    pageUp() {
      this.calls.push('pageUp');
      scrolled = true;
    },
    pageDown() {
      this.calls.push('pageDown');
    },
    toTail() {
      this.calls.push('toTail');
      scrolled = false;
    },
    isScrolled: () => scrolled,
  };
  const onEscape = vi.fn();
  const pane = new InputPane(bus, root, { sender, output, onEscape, onCommand });
  pane.focus();
  const i = pane.input;
  const type = (s: string) => {
    i.value = s;
    i.setSelectionRange(s.length, s.length);
    i.dispatchEvent(new Event('input'));
  };
  const key = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    i.dispatchEvent(e);
    return e;
  };
  const selected = () => [i.selectionStart, i.selectionEnd];
  return { bus, pane, i, sent, output, onEscape, type, key, selected };
}

describe('InputPane Enter semantics', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('sends a non-empty buffer and refills it fully selected', () => {
    const t = setup();
    t.type('look');
    t.key('Enter');
    expect(t.sent).toEqual([{ text: 'look' }]);
    expect(t.i.value).toBe('look');
    expect(t.selected()).toEqual([0, 4]);
    expect(t.pane.isRecallState()).toBe(true);
  });

  it('Enter in recall state sends the same text again', () => {
    const t = setup();
    t.type('kill orc');
    t.key('Enter');
    t.key('Enter');
    expect(t.sent.map((s) => s.text)).toEqual(['kill orc', 'kill orc']);
    expect(t.pane.getHistory()).toEqual(['kill orc']);
  });

  it('empty Enter sends a bare newline and never repeats', () => {
    const t = setup();
    t.type('');
    t.key('Enter');
    expect(t.sent).toEqual([{ text: '' }]);
    expect(t.pane.getHistory()).toEqual([]);
  });

  it('snaps the output to the tail on every send', () => {
    const t = setup();
    t.key('PageUp');
    t.key('Enter');
    expect(t.output.calls).toEqual(['pageUp', 'toTail']);
  });

  it('routes handled built-in commands away from the sender', () => {
    const t = setup((s) => s.startsWith('#'));
    t.type('#connect');
    t.key('Enter');
    expect(t.sent).toEqual([]);
    expect(t.pane.getHistory()).toEqual(['#connect']);
  });
});

describe('InputPane history', () => {
  function sendAll(t: ReturnType<typeof setup>, cmds: string[]) {
    for (const c of cmds) {
      t.type(c);
      t.key('Enter');
    }
  }

  it('dedups only consecutive entries', () => {
    const t = setup();
    sendAll(t, ['look', 'look', 'look', 'north', 'look']);
    expect(t.pane.getHistory()).toEqual(['look', 'north', 'look']);
  });

  it('Up from recall state skips the entry already shown', () => {
    const t = setup();
    sendAll(t, ['a', 'b', 'c']);
    t.key('ArrowUp');
    expect(t.i.value).toBe('b');
    expect(t.selected()).toEqual([0, 1]);
  });

  it('Up from a draft saves it, shows newest, clamps at oldest', () => {
    const t = setup();
    sendAll(t, ['a', 'b']);
    t.type('dra');
    t.key('ArrowUp');
    expect(t.i.value).toBe('b');
    t.key('ArrowUp');
    expect(t.i.value).toBe('a');
    t.key('ArrowUp');
    expect(t.i.value).toBe('a');
    t.key('ArrowDown');
    expect(t.i.value).toBe('b');
    t.key('ArrowDown');
    expect(t.i.value).toBe('dra');
    expect(t.selected()).toEqual([3, 3]);
    t.key('ArrowDown');
    expect(t.i.value).toBe('');
  });

  it('Down when not browsing does nothing', () => {
    const t = setup();
    sendAll(t, ['a']);
    t.type('x');
    t.key('ArrowDown');
    expect(t.i.value).toBe('x');
  });

  it('any edit ends browsing', () => {
    const t = setup();
    sendAll(t, ['a', 'b', 'c']);
    t.type('');
    t.key('ArrowUp');
    t.key('ArrowUp');
    expect(t.i.value).toBe('b');
    t.type('bx');
    t.key('ArrowDown');
    expect(t.i.value).toBe('bx');
    t.key('ArrowUp');
    expect(t.i.value).toBe('c');
  });

  it('Shift+Up/Down select to start/end', () => {
    const t = setup();
    t.type('hello');
    t.i.setSelectionRange(2, 2);
    t.key('ArrowUp', { shiftKey: true });
    expect(t.selected()).toEqual([0, 2]);
    t.i.setSelectionRange(2, 2);
    t.key('ArrowDown', { shiftKey: true });
    expect(t.selected()).toEqual([2, 5]);
  });
});

describe('InputPane password mode', () => {
  it('sends secret, keeps it out of history and clears the buffer', () => {
    const t = setup();
    t.bus.emit('telnet.echo', { serverEchoes: true });
    expect(t.pane.isPasswordMode()).toBe(true);
    t.type('hunter2');
    const mask = t.pane.el.querySelector('.wc-input-mask')!;
    expect(mask.textContent).toBe('•••••••');
    expect(t.i.classList.contains('wc-masked')).toBe(true);
    t.key('Enter');
    expect(t.sent).toEqual([{ text: 'hunter2', opts: { secret: true } }]);
    expect(t.pane.getHistory()).toEqual([]);
    expect(t.i.value).toBe('');
    t.key('ArrowUp');
    expect(t.i.value).toBe('');
    t.bus.emit('telnet.echo', { serverEchoes: false });
    expect(t.pane.isPasswordMode()).toBe(false);
    expect(t.i.classList.contains('wc-masked')).toBe(false);
  });

  it('entering password mode clears a recalled command', () => {
    const t = setup();
    t.type('Ole');
    t.key('Enter');
    t.bus.emit('telnet.echo', { serverEchoes: true });
    expect(t.i.value).toBe('');
  });
});

describe('InputPane keys', () => {
  it('ESC leaves scroll mode first, then calls onEscape', () => {
    const t = setup();
    t.key('PageUp');
    t.key('Escape');
    expect(t.output.calls).toEqual(['pageUp', 'toTail']);
    expect(t.onEscape).not.toHaveBeenCalled();
    t.key('Escape');
    expect(t.onEscape).toHaveBeenCalledTimes(1);
  });

  it('PageDown goes to the output', () => {
    const t = setup();
    const e = t.key('PageDown');
    expect(t.output.calls).toEqual(['pageDown']);
    expect(e.defaultPrevented).toBe(true);
  });

  it('Ctrl+A selects all, Ctrl+E goes to end, Ctrl+D is a no-op', () => {
    const t = setup();
    t.type('abc def');
    t.key('a', { code: 'KeyA', ctrlKey: true });
    expect(t.selected()).toEqual([0, 7]);
    t.key('e', { code: 'KeyE', ctrlKey: true });
    expect(t.selected()).toEqual([7, 7]);
    const e = t.key('d', { code: 'KeyD', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(t.i.value).toBe('abc def');
  });

  it('Ctrl+W and Alt+Backspace delete a word back', () => {
    const t = setup();
    t.type('cast foo.bar ');
    t.key('w', { code: 'KeyW', ctrlKey: true });
    expect(t.i.value).toBe('cast ');
    t.type('cast foo.bar');
    t.key('Backspace', { code: 'Backspace', altKey: true });
    expect(t.i.value).toBe('cast foo.');
  });

  it('Alt+B/F move by word, Alt+D deletes forward', () => {
    const t = setup();
    t.type('kill orc now');
    t.key('b', { code: 'KeyB', altKey: true });
    expect(t.selected()).toEqual([9, 9]);
    t.key('b', { code: 'KeyB', altKey: true });
    expect(t.selected()).toEqual([5, 5]);
    t.key('f', { code: 'KeyF', altKey: true });
    expect(t.selected()).toEqual([8, 8]);
    t.i.setSelectionRange(4, 4);
    t.key('d', { code: 'KeyD', altKey: true });
    expect(t.i.value).toBe('kill now');
  });

  it('keys typed while focus is elsewhere land in the input', () => {
    const t = setup();
    t.i.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.activeElement).toBe(t.i);
    expect(t.sent.length).toBe(1);
  });

  it('word helpers', () => {
    expect(wordStartBefore('ab cd', 5)).toBe(3);
    expect(wordStartBefore('ab cd  ', 7)).toBe(3);
    expect(wordEndAfter('ab cd', 0)).toBe(2);
    expect(wordEndAfter('ab cd', 2)).toBe(5);
    expect(spaceWordStartBefore('a b.c', 5)).toBe(2);
  });

  it('paste normalisation', () => {
    expect(normalizePaste('a\r\nb\r\n')).toBe('a b');
    expect(normalizePaste('one\n\ntwo\rthree')).toBe('one two three');
    expect(normalizePaste('plain')).toBe('plain');
  });

  it('leave guard toggles a beforeunload handler', () => {
    const t = setup();
    t.pane.setLeaveGuard(true);
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    t.pane.setLeaveGuard(false);
    const e2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });
});

describe('AppStatus', () => {
  it('tracks state, name, link, xml and capture', () => {
    const bus = new Bus();
    const s = new AppStatus(bus);
    const seen: string[] = [];
    s.subscribe((st) => seen.push(st.conn));
    expect(formatStatus(s.get())).toBe('idle · Link: — · XML: off');
    bus.emit('conn.state', { state: 'playing', prev: 'login' });
    bus.emit('gmcp', { pkg: 'Char.Name', data: { name: 'Rasta', fullname: 'Rasta Fari' } });
    bus.emit('link.rtt', { ms: 38.4, last: 38.4, suspect: false });
    bus.emit('xml.seen', undefined);
    bus.emit('xml.seen', undefined);
    s.set({ capture: 'capture: recording' });
    expect(s.get()).toMatchObject({ conn: 'playing', character: 'Rasta', linkMs: 38.4, xml: true });
    expect(formatStatus(s.get())).toBe('playing · Rasta · Link: 38ms · XML: on · capture: recording');
    expect(seen).toHaveLength(5);
    bus.emit('conn.state', { state: 'connecting', prev: 'disconnected' });
    expect(s.get()).toMatchObject({ xml: false, linkMs: null });
    s.set({ replay: true });
    expect(formatStatus(s.get()).startsWith('replay ·')).toBe(true);
    expect(Object.isFrozen(s.get())).toBe(true);
    expect(formatLink(40, true)).toBe('Link: 40ms?');
    expect(formatLink(null, true)).toBe('Link: —');
  });
});

describe('InputPane custom caret', () => {
  function caretSetup() {
    document.body.innerHTML = '';
    const bus = new Bus();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const sent: string[] = [];
    const frames: Array<() => void> = [];
    const sender: Sender = { sendCommand: (text) => sent.push(text), sendGmcp: () => {} };
    const pane = new InputPane(bus, root, {
      sender,
      cellWidth: () => 10,
      requestFrame: (cb) => frames.push(cb),
    });
    pane.focus();
    const i = pane.input;
    const c = pane.caretEl;
    const run = () => {
      while (frames.length) frames.shift()!();
    };
    const type = (s: string) => {
      i.value = s;
      i.setSelectionRange(s.length, s.length);
      i.dispatchEvent(new Event('input'));
    };
    return { bus, pane, i, c, frames, run, type, sent };
  }

  it('sits at column × cell width and shows the character under it', () => {
    const t = caretSetup();
    t.type('look');
    t.run();
    expect(t.c.hidden).toBe(false);
    expect(t.c.style.transform).toBe('translateX(40px)');
    expect(t.c.textContent).toBe(' ');
    t.i.setSelectionRange(1, 1);
    t.pane.scheduleCaret();
    t.run();
    expect(t.c.style.transform).toBe('translateX(10px)');
    expect(t.c.textContent).toBe('o');
  });

  it('follows horizontal scroll and counts a surrogate pair as one cell', () => {
    const t = caretSetup();
    t.type('a😀b');
    Object.defineProperty(t.i, 'scrollLeft', { configurable: true, get: () => 5 });
    t.pane.updateCaret();
    expect(t.c.style.transform).toBe('translateX(25px)');
  });

  it('hides for a selection, is hollow when blurred', () => {
    const t = caretSetup();
    t.type('look');
    t.i.setSelectionRange(0, 4);
    t.pane.updateCaret();
    expect(t.c.hidden).toBe(true);
    t.i.setSelectionRange(4, 4);
    t.pane.updateCaret();
    expect(t.c.hidden).toBe(false);
    expect(t.c.classList.contains('wc-blurred')).toBe(false);
    t.i.blur();
    t.run();
    expect(t.c.classList.contains('wc-blurred')).toBe(true);
    t.pane.focus();
    t.run();
    expect(t.c.classList.contains('wc-blurred')).toBe(false);
  });

  it('shows a bullet under the caret while masked', () => {
    const t = caretSetup();
    t.pane.setPasswordMode(true);
    t.type('secret');
    t.i.setSelectionRange(2, 2);
    t.pane.updateCaret();
    expect(t.c.textContent).toBe('•');
    expect(t.c.style.transform).toBe('translateX(20px)');
  });

  it('restarts the blink when it moves', () => {
    const t = caretSetup();
    t.type('a');
    t.run();
    const phase = t.c.classList.contains('wc-caret-b');
    t.type('ab');
    t.run();
    expect(t.c.classList.contains('wc-caret-b')).toBe(!phase);
  });

  it('does no caret work on the Enter → send path', () => {
    const t = caretSetup();
    t.type('look');
    t.run();
    const before = t.c.style.transform;
    const spy = vi.spyOn(t.pane, 'updateCaret');
    t.i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(t.sent).toEqual(['look']);
    expect(spy).not.toHaveBeenCalled();
    expect(t.c.style.transform).toBe(before);
    expect(t.frames.length).toBe(1);
    t.run();
    expect(spy).toHaveBeenCalledTimes(1);
    // Recall state: the whole line is selected, so the caret hides.
    expect(t.c.hidden).toBe(true);
  });
});

describe('InputPane macros on printable keys (ADR 0026)', () => {
  function macroSetup(bound: string[]) {
    document.body.innerHTML = '';
    const bus = new Bus();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const sender: Sender = { sendCommand: () => {}, sendGmcp: () => {} };
    const fired: string[] = [];
    const pane = new InputPane(bus, root, {
      sender,
      onMacroKey: (k) => {
        if (!bound.includes(k)) return false;
        fired.push(k);
        return true;
      },
    });
    pane.focus();
    const key = (code: string, k: string, init: KeyboardEventInit = {}, target: EventTarget = pane.input) => {
      const e = new KeyboardEvent('keydown', { code, key: k, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };
    return { bus, pane, fired, key };
  }

  it('a bound bare key fires and is consumed; an unbound one types', () => {
    const t = macroSetup(['A', 'Backquote', 'Shift+2']);
    expect(t.key('KeyA', 'a').defaultPrevented).toBe(true);
    expect(t.key('Backquote', '§').defaultPrevented).toBe(true);
    expect(t.key('Digit2', '"', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(t.key('KeyB', 'b').defaultPrevented).toBe(false);
    expect(t.key('Digit2', '2').defaultPrevented).toBe(false);
    expect(t.fired).toEqual(['A', 'Backquote', 'Shift+2']);
  });

  it('Shift+letter fires while the bare letter still types', () => {
    const t = macroSetup(['Shift+A']);
    expect(t.key('KeyA', 'a').defaultPrevented).toBe(false);
    expect(t.key('KeyA', 'A', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(t.fired).toEqual(['Shift+A']);
  });

  it('nothing fires in password mode, with AltGr, or in other fields', () => {
    const t = macroSetup(['A', 'Minus']);
    t.bus.emit('telnet.echo', { serverEchoes: true });
    expect(t.key('KeyA', 'a').defaultPrevented).toBe(false);
    t.bus.emit('telnet.echo', { serverEchoes: false });

    const altGr = new KeyboardEvent('keydown', { code: 'Minus', key: '\\', bubbles: true, cancelable: true });
    Object.defineProperty(altGr, 'getModifierState', { value: (k: string) => k === 'AltGraph' });
    t.pane.input.dispatchEvent(altGr);
    expect(altGr.defaultPrevented).toBe(false);

    for (const tag of ['textarea', 'input']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(t.key('KeyA', 'a', {}, el).defaultPrevented, tag).toBe(false);
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.appendChild(editable);
    t.key('KeyA', 'a', {}, editable);
    expect(t.fired).toEqual([]);
    expect(t.key('KeyA', 'a').defaultPrevented).toBe(true);
    expect(t.fired).toEqual(['A']);
  });
});
