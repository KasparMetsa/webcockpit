import { describe, expect, it } from 'vitest';
import { PROFILE_TEMPLATE } from '../../src/profiles';
import { listEntries, parseProfile } from '../../src/script/doc';
import {
  type KeyEventLike,
  bindability,
  compareKeys,
  displayKey,
  keyBindability,
  keyNameFromEvent,
  normalizeKey,
  shadowedInputKey,
} from '../../src/script/keys';

const ev = (code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code,
  key: '',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('keyNameFromEvent', () => {
  it('builds canonical names from code and modifiers', () => {
    expect(keyNameFromEvent(ev('F5'))).toBe('F5');
    expect(keyNameFromEvent(ev('Numpad0'))).toBe('Numpad0');
    expect(keyNameFromEvent(ev('NumpadAdd', { key: 'ArrowUp' }))).toBe('NumpadAdd');
    expect(keyNameFromEvent(ev('KeyA', { altKey: true }))).toBe('Alt+A');
    expect(keyNameFromEvent(ev('Digit1', { altKey: true }))).toBe('Alt+1');
    expect(keyNameFromEvent(ev('F1', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+F1');
    expect(keyNameFromEvent(ev('KeyX', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+Shift+Meta+X');
  });

  it('returns null for bare modifiers and unknown codes', () => {
    expect(keyNameFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull();
    expect(keyNameFromEvent(ev('NumLock'))).toBeNull();
    expect(keyNameFromEvent(ev(''))).toBeNull();
    expect(keyNameFromEvent(ev('Unidentified'))).toBeNull();
  });
});

describe('bindability', () => {
  it('accepts F-keys, numpad (any NumLock state), Alt/Ctrl combos and Tab', () => {
    for (const [code, mods] of [
      ['F5', {}],
      ['F1', { shiftKey: true }],
      ['Numpad8', {}],
      ['NumpadEnter', {}],
      ['KeyB', { altKey: true }],
      ['KeyG', { ctrlKey: true }],
      ['KeyA', { ctrlKey: true, shiftKey: true }],
      ['Tab', {}],
      ['ArrowUp', {}],
      ['Escape', { shiftKey: true }],
      ['Enter', { ctrlKey: true }],
    ] as const) {
      expect(bindability(ev(code, mods)).ok, code).toBe(true);
    }
  });

  it('rejects ESC, Enter, printable keys and browser keys, with a reason', () => {
    const no = (code: string, mods: Partial<KeyEventLike> = {}): string => {
      const b = bindability(ev(code, mods));
      expect(b.ok, code).toBe(false);
      return b.ok ? '' : b.reason;
    };
    expect(no('Escape')).toMatch(/menu/);
    expect(no('Enter')).toMatch(/sends/);
    expect(no('Enter', { shiftKey: true })).toMatch(/sends/);
    expect(no('KeyA')).toMatch(/Ctrl or Alt/);
    expect(no('KeyA', { shiftKey: true })).toMatch(/Ctrl or Alt/);
    expect(no('Digit5')).toMatch(/Ctrl or Alt/);
    expect(no('Space')).toMatch(/Ctrl or Alt/);
    expect(no('Minus', { shiftKey: true })).toMatch(/Ctrl or Alt/);
    for (const k of ['KeyW', 'KeyT', 'KeyN']) {
      expect(no(k, { ctrlKey: true })).toMatch(/browser/);
      expect(no(k, { ctrlKey: true, shiftKey: true })).toMatch(/browser/);
    }
    expect(no('Tab', { ctrlKey: true })).toMatch(/browser/);
    expect(no('Tab', { ctrlKey: true, shiftKey: true })).toMatch(/browser/);
    expect(no('ControlLeft', { ctrlKey: true })).toMatch(/modifier/);
  });

  it('checks names as written through keyBindability', () => {
    expect(keyBindability('Alt+A')).toEqual({ ok: true, name: 'Alt+A' });
    expect(keyBindability('bogus')).toMatchObject({ ok: false, name: null });
  });
});

describe('normalizeKey', () => {
  it('accepts canonical and display names in any case', () => {
    const cases: Record<string, string> = {
      F5: 'F5',
      f12: 'F12',
      Numpad0: 'Numpad0',
      'numpad 0': 'Numpad0',
      'Numpad +': 'NumpadAdd',
      'Numpad -': 'NumpadSubtract',
      'Numpad .': 'NumpadDecimal',
      'Numpad Enter': 'NumpadEnter',
      'Numpad *': 'NumpadMultiply',
      'Numpad /': 'NumpadDivide',
      numpadadd: 'NumpadAdd',
      'Alt+a': 'Alt+A',
      'alt+A': 'Alt+A',
      'Ctrl+g': 'Ctrl+G',
      'ctrl + shift + f1': 'Ctrl+Shift+F1',
      'Shift+Ctrl+F1': 'Ctrl+Shift+F1',
      'Ctrl+Shift+KeyA': 'Ctrl+Shift+A',
      'Control+Digit1': 'Ctrl+1',
      'Alt+Numpad +': 'Alt+NumpadAdd',
      'Ctrl+-': 'Ctrl+Minus',
      PgUp: 'PageUp',
      Up: 'ArrowUp',
      Del: 'Delete',
      'Meta+F1': 'Meta+F1',
    };
    for (const [t, c] of Object.entries(cases)) expect(normalizeKey(t), t).toBe(c);
  });

  it('accepts the tt++ escape forms', () => {
    const cases: Record<string, string> = {
      '\\eOp': 'Numpad0',
      '\\eOq': 'Numpad1',
      '\\eOy': 'Numpad9',
      '\\eOn': 'NumpadDecimal',
      '\\eOM': 'NumpadEnter',
      '\\eOj': 'NumpadMultiply',
      '\\eOk': 'NumpadAdd',
      '\\eOm': 'NumpadSubtract',
      '\\eOo': 'NumpadDivide',
      '\\eOP': 'F1',
      '\\eOQ': 'F2',
      '\\eOR': 'F3',
      '\\eOS': 'F4',
      '\\e[11~': 'F1',
      '\\e[15~': 'F5',
      '\\e[17~': 'F6',
      '\\e[18~': 'F7',
      '\\e[19~': 'F8',
      '\\e[20~': 'F9',
      '\\e[21~': 'F10',
      '\\e[23~': 'F11',
      '\\e[24~': 'F12',
      '\\e[15;2~': 'Shift+F5',
      '\\e[15;5~': 'Ctrl+F5',
      '\\e[1;2P': 'Shift+F1',
      '\\e[1;3A': 'Alt+ArrowUp',
      '\\e[A': 'ArrowUp',
      '\\eOD': 'ArrowLeft',
      '\\e[5~': 'PageUp',
      '\\e[3~': 'Delete',
      '\\e[Z': 'Shift+Tab',
      '\\ea': 'Alt+A',
      '\\ez': 'Alt+Z',
      '\\eA': 'Alt+Shift+A',
      '\\e1': 'Alt+1',
      '^G': 'Ctrl+G',
      '^l': 'Ctrl+L',
      '\\x1bOp': 'Numpad0',
      '\\x1BOk': 'NumpadAdd',
      '\\033[15~': 'F5',
      '\u001bOP': 'F1',
      '\u001bb': 'Alt+B',
    };
    for (const [t, c] of Object.entries(cases)) expect(normalizeKey(t), t).toBe(c);
  });

  it('returns null for text that is not a key', () => {
    for (const t of ['', 'xyz', '\\e', '\\e[99~', '\\eO?', '^', '^1', 'Ctrl+', 'Hyper+A', 'Numpad 10', '\\e[1;99A']) {
      expect(normalizeKey(t), t).toBeNull();
    }
  });

  it('keeps the shipped template valid and bindable', () => {
    const keys = listEntries(parseProfile(PROFILE_TEMPLATE), 'macro').map((e) => e.pattern);
    expect(keys).toHaveLength(10);
    for (const k of keys) {
      const c = normalizeKey(k);
      expect(c, k).not.toBeNull();
      expect(keyBindability(c!).ok, k).toBe(true);
    }
  });

  it('round-trips every display name', () => {
    const names = ['F1', 'Numpad0', 'NumpadAdd', 'NumpadEnter', 'Alt+A', 'Ctrl+Shift+A', 'Ctrl+Minus', 'Shift+ArrowUp', 'Meta+Backslash', 'Alt+1', 'ContextMenu'];
    for (const n of names) expect(normalizeKey(displayKey(n)), n).toBe(n);
  });
});

describe('displayKey', () => {
  it('uses the Inv §5.6 display names', () => {
    expect(displayKey('F1')).toBe('F1');
    expect(displayKey('Numpad0')).toBe('Numpad 0');
    expect(displayKey('NumpadAdd')).toBe('Numpad +');
    expect(displayKey('NumpadSubtract')).toBe('Numpad -');
    expect(displayKey('NumpadDecimal')).toBe('Numpad .');
    expect(displayKey('NumpadEnter')).toBe('Numpad Enter');
    expect(displayKey('Alt+A')).toBe('Alt+a');
    expect(displayKey('Ctrl+G')).toBe('Ctrl+g');
    expect(displayKey('Ctrl+Shift+A')).toBe('Ctrl+Shift+A');
    expect(displayKey('Ctrl+Shift+F1')).toBe('Ctrl+Shift+F1');
    expect(displayKey('PageDown')).toBe('PgDn');
    expect(displayKey('Shift+ArrowUp')).toBe('Shift+Up');
    expect(displayKey('\\eOp')).toBe('\\eOp'); // not canonical: returned as is
  });
});

describe('compareKeys', () => {
  it('sorts F-keys, then numpad, then modified keys, unknown last', () => {
    const keys = ['Alt+a', '\\eOk', 'weird', 'F10', '\\e[15~', 'Ctrl+g', 'Numpad0', 'F2', 'Tab', 'Shift+F1', 'Ctrl+Shift+A', 'Alt+b'];
    expect([...keys].sort(compareKeys)).toEqual([
      'F2',
      '\\e[15~',
      'F10',
      'Numpad0',
      '\\eOk',
      'Tab',
      'Shift+F1',
      'Alt+a',
      'Alt+b',
      'Ctrl+g',
      'Ctrl+Shift+A',
      'weird',
    ]);
  });
});

describe('input-line keys', () => {
  it('names the input keys a macro would shadow', () => {
    for (const k of ['Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+E', 'Alt+B', 'Alt+F', 'Alt+D', 'Alt+Backspace', 'Tab', 'ArrowUp', 'ArrowLeft', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete']) {
      expect(shadowedInputKey(k), k).toBeTruthy();
    }
    expect(shadowedInputKey('F5')).toBeNull();
    expect(shadowedInputKey('Alt+A')).toBeNull();
  });
});
