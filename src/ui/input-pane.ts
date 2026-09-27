// Input pane: the one-row command line (Inv §1.2, §1.3, spec §2.2).
//
// Decisions (see the report for the stage file):
// - Native <input type="text">; the browser supplies caret, selection,
//   printable-key-replaces-selection, Backspace/Delete-clears-selection and
//   arrows-deselect. We add Enter, history, word keys and focus handling.
// - Password mode keeps type="text" (a type="password" field makes Firefox
//   and Chrome offer to save the password) and masks by making the text
//   transparent and drawing one bullet per character over it. Copy and cut
//   are blocked while masked.
// - Paste: CRLF/CR become LF, trailing newlines are dropped, and remaining
//   newlines become single spaces. Nothing is ever sent by a paste.
// - Ctrl+W: handled (delete word back) where the browser lets the page see
//   it. Chrome and Firefox close the tab on Ctrl+W before the page gets the
//   key in a normal tab; it only works in an installed-app/popup window.
//   Alt+Backspace does the same and always works.

import type { Bus } from '../core/bus';
import type { Sender } from '../core/types';

/** What the input pane needs from the output pane. */
export interface ScrollTarget {
  pageUp(): void;
  pageDown(): void;
  toTail(): void;
  isScrolled(): boolean;
}

export interface InputPaneOptions {
  sender: Sender;
  /** Output pane for PageUp/PageDown/ESC and snap-to-tail on send. */
  output?: ScrollTarget;
  /** Built-in command hook; return true when the text was handled. */
  onCommand?: (text: string) => boolean;
  /** ESC when the output is not scrolled (the menu, stage 2). */
  onEscape?: () => void;
}

const BULLET = '•';

/** Start of the alphanumeric word before `pos` (readline backward-word). */
export function wordStartBefore(s: string, pos: number): number {
  let i = pos;
  while (i > 0 && !isWordChar(s.charCodeAt(i - 1))) i--;
  while (i > 0 && isWordChar(s.charCodeAt(i - 1))) i--;
  return i;
}

/** End of the alphanumeric word after `pos` (readline forward-word). */
export function wordEndAfter(s: string, pos: number): number {
  let i = pos;
  while (i < s.length && !isWordChar(s.charCodeAt(i))) i++;
  while (i < s.length && isWordChar(s.charCodeAt(i))) i++;
  return i;
}

/** Start of the whitespace-delimited word before `pos` (unix-word-rubout). */
export function spaceWordStartBefore(s: string, pos: number): number {
  let i = pos;
  while (i > 0 && isSpace(s.charCodeAt(i - 1))) i--;
  while (i > 0 && !isSpace(s.charCodeAt(i - 1))) i--;
  return i;
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9;
}

function isWordChar(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c > 127
  );
}

/** Paste normalisation: one line, newlines become spaces. */
export function normalizePaste(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .replace(/\n+/g, ' ');
}

export class InputPane {
  readonly el: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly mask: HTMLSpanElement;
  private readonly doc: Document;
  private readonly opts: InputPaneOptions;

  /** History, oldest first. In memory only (Inv §1.2). */
  private readonly history: string[] = [];
  /** Index into history while browsing, or -1. */
  private browseIndex = -1;
  /** Draft saved when browsing started. */
  private draft = '';
  /** True right after Down restored the draft: one more Down clears. */
  private draftRestored = false;

  private password = false;
  private leaveGuard = false;
  private readonly unsubs: Array<() => void> = [];

  constructor(bus: Bus, root: HTMLElement, opts: InputPaneOptions) {
    this.opts = opts;
    this.doc = root.ownerDocument;
    const doc = this.doc;

    this.el = doc.createElement('div');
    this.el.className = 'wc-input';
    const prompt = doc.createElement('span');
    prompt.className = 'wc-input-prompt';
    prompt.textContent = '> ';
    const wrap = doc.createElement('span');
    wrap.className = 'wc-input-wrap';
    this.input = doc.createElement('input');
    this.input.type = 'text';
    this.input.className = 'wc-input-field';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('autocapitalize', 'off');
    this.input.setAttribute('autocorrect', 'off');
    this.input.setAttribute('aria-label', 'Command');
    // A random name keeps form-history/autofill heuristics from matching.
    this.input.name = 'wc-cmd-' + Math.random().toString(36).slice(2);
    this.mask = doc.createElement('span');
    this.mask.className = 'wc-input-mask';
    this.mask.hidden = true;
    wrap.append(this.input, this.mask);
    const clock = doc.createElement('span');
    clock.className = 'wc-input-clock';
    this.el.append(prompt, wrap, clock);
    root.appendChild(this.el);

    this.input.addEventListener('input', this.onInput);
    this.input.addEventListener('paste', this.onPaste);
    this.input.addEventListener('copy', this.onCopyCut);
    this.input.addEventListener('cut', this.onCopyCut);
    doc.addEventListener('keydown', this.onKeyDown, true);
    doc.addEventListener('mouseup', this.onDocMouseUp);
    doc.defaultView?.addEventListener('focus', this.onWindowFocus);

    this.unsubs.push(bus.on('telnet.echo', (e) => this.setPasswordMode(e.serverEchoes)));
  }

  // ----------------------------------------------------------------- public

  /** Focuses the input (call after overlays close). */
  focus(): void {
    if (this.doc.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  /** Current buffer text. */
  get value(): string {
    return this.input.value;
  }

  /** A copy of the history, oldest first. */
  getHistory(): string[] {
    return this.history.slice();
  }

  /** True while the whole non-empty buffer is selected (recall state). */
  isRecallState(): boolean {
    const i = this.input;
    return i.value.length > 0 && i.selectionStart === 0 && i.selectionEnd === i.value.length;
  }

  /** Masks the input and sends without history (server echo = password). */
  setPasswordMode(on: boolean): void {
    if (on === this.password) return;
    this.password = on;
    this.input.classList.toggle('wc-masked', on);
    this.mask.hidden = !on;
    if (on) {
      // Never let a recalled command sit in a password field.
      this.input.value = '';
      this.endBrowsing();
    }
    this.updateMask();
  }

  isPasswordMode(): boolean {
    return this.password;
  }

  /** Asks "Leave page?" on unload while `on` (i.e. while connected). */
  setLeaveGuard(on: boolean): void {
    if (on === this.leaveGuard) return;
    this.leaveGuard = on;
    const win = this.doc.defaultView;
    if (!win) return;
    if (on) win.addEventListener('beforeunload', this.onBeforeUnload);
    else win.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.setLeaveGuard(false);
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.doc.removeEventListener('mouseup', this.onDocMouseUp);
    this.doc.defaultView?.removeEventListener('focus', this.onWindowFocus);
    this.el.remove();
  }

  // ------------------------------------------------------------------ enter

  /** Enter: sends the buffer (Inv §1.2 Enter semantics). */
  submit(): void {
    const text = this.input.value;
    this.opts.output?.toTail();

    if (this.password) {
      this.opts.sender.sendCommand(text, { secret: true });
      this.input.value = '';
      this.updateMask();
      this.endBrowsing();
      return;
    }

    const handled = this.opts.onCommand?.(text) ?? false;
    if (!handled) this.opts.sender.sendCommand(text);
    if (text !== '') {
      if (this.history[this.history.length - 1] !== text) this.history.push(text);
      this.input.value = text;
      this.input.setSelectionRange(0, text.length);
    }
    this.endBrowsing();
  }

  // ---------------------------------------------------------------- history

  private endBrowsing(): void {
    this.browseIndex = -1;
    this.draft = '';
    this.draftRestored = false;
  }

  private show(text: string): void {
    this.input.value = text;
    this.input.setSelectionRange(0, text.length);
  }

  /** Up: one older history entry (Inv §1.2). */
  historyUp(): void {
    const h = this.history;
    if (h.length === 0 || this.password) return;
    if (this.browseIndex >= 0) {
      this.browseIndex = Math.max(0, this.browseIndex - 1);
      this.show(h[this.browseIndex]!);
      return;
    }
    const newest = h.length - 1;
    this.draftRestored = false;
    if (this.isRecallState() && this.input.value === h[newest]) {
      // Just sent: the newest entry is already on screen, go one further.
      this.draft = '';
      this.browseIndex = Math.max(0, newest - 1);
    } else {
      this.draft = this.input.value;
      this.browseIndex = newest;
    }
    this.show(h[this.browseIndex]!);
  }

  /** Down: one newer entry, then the draft, then an empty line. */
  historyDown(): void {
    if (this.password) return;
    if (this.draftRestored) {
      this.input.value = '';
      this.endBrowsing();
      return;
    }
    if (this.browseIndex < 0) return;
    if (this.browseIndex < this.history.length - 1) {
      this.browseIndex++;
      this.show(this.history[this.browseIndex]!);
      return;
    }
    const draft = this.draft;
    this.endBrowsing();
    this.input.value = draft;
    this.input.setSelectionRange(draft.length, draft.length);
    this.draftRestored = true;
  }

  // ------------------------------------------------------------------- keys

  private isOtherInteractive(t: EventTarget | null): boolean {
    if (t === this.input || !t || !(t as Element).tagName) return false;
    const el = t as HTMLElement;
    const tag = el.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON' ||
      el.isContentEditable === true
    );
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    if (this.isOtherInteractive(e.target)) return;
    if (this.doc.activeElement !== this.input) {
      // Keystrokes typed while focus is elsewhere land in the input: moving
      // focus during keydown redirects the resulting character.
      this.input.focus({ preventScroll: true });
    }
    if (this.handleKey(e)) e.preventDefault();
  };

  /** Handles a key; returns true when it consumed it. */
  handleKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    const out = this.opts.output;

    switch (e.key) {
      case 'Enter':
        if (plain && !e.shiftKey) {
          this.submit();
          return true;
        }
        return false;
      case 'Escape':
        if (!plain) return false;
        if (out?.isScrolled()) out.toTail();
        else this.opts.onEscape?.();
        return true;
      case 'PageUp':
        if (!plain) return false;
        out?.pageUp();
        return true;
      case 'PageDown':
        if (!plain) return false;
        out?.pageDown();
        return true;
      case 'ArrowUp':
        if (!plain) return false;
        if (e.shiftKey) this.selectToStart();
        else this.historyUp();
        return true;
      case 'ArrowDown':
        if (!plain) return false;
        if (e.shiftKey) this.selectToEnd();
        else this.historyDown();
        return true;
      case 'Backspace':
        if (alt) {
          this.deleteBack(wordStartBefore);
          return true;
        }
        return false;
    }

    if (ctrl && !e.shiftKey) {
      switch (e.code) {
        case 'KeyA':
          this.input.setSelectionRange(0, this.input.value.length);
          return true;
        case 'KeyE': {
          const n = this.input.value.length;
          this.input.setSelectionRange(n, n);
          return true;
        }
        case 'KeyW':
          this.deleteBack(spaceWordStartBefore);
          return true;
        case 'KeyD':
          return true; // no-op, and keeps the bookmark dialog away
      }
      return false;
    }

    if (alt && !e.shiftKey) {
      const v = this.input.value;
      const caret = this.caret();
      switch (e.code) {
        case 'KeyB': {
          const p = wordStartBefore(v, caret);
          this.input.setSelectionRange(p, p);
          return true;
        }
        case 'KeyF': {
          const p = wordEndAfter(v, caret);
          this.input.setSelectionRange(p, p);
          return true;
        }
        case 'KeyD': {
          const p = wordEndAfter(v, caret);
          if (p > caret) this.edit(caret, p, '');
          return true;
        }
      }
    }
    return false;
  }

  private caret(): number {
    const i = this.input;
    return (i.selectionDirection === 'backward' ? i.selectionStart : i.selectionEnd) ?? 0;
  }

  private selectToStart(): void {
    this.input.setSelectionRange(0, this.caret(), 'backward');
  }

  private selectToEnd(): void {
    this.input.setSelectionRange(this.caret(), this.input.value.length, 'forward');
  }

  private deleteBack(find: (s: string, pos: number) => number): void {
    const i = this.input;
    const s = i.selectionStart ?? 0;
    const en = i.selectionEnd ?? 0;
    if (s !== en) {
      this.edit(s, en, '');
      return;
    }
    const p = find(i.value, s);
    if (p < s) this.edit(p, s, '');
  }

  /** Replaces [start, end) with `text`, caret after it; counts as an edit. */
  private edit(start: number, end: number, text: string): void {
    this.input.setRangeText(text, start, end, 'end');
    this.afterEdit();
  }

  private afterEdit(): void {
    this.endBrowsing();
    this.updateMask();
  }

  private readonly onInput = (): void => {
    this.afterEdit();
  };

  private readonly onPaste = (e: ClipboardEvent): void => {
    const data = e.clipboardData?.getData('text/plain');
    if (data === undefined) return;
    e.preventDefault();
    const i = this.input;
    this.edit(i.selectionStart ?? 0, i.selectionEnd ?? 0, normalizePaste(data));
  };

  private readonly onCopyCut = (e: ClipboardEvent): void => {
    if (this.password) e.preventDefault();
  };

  private updateMask(): void {
    if (!this.password) return;
    this.mask.textContent = BULLET.repeat(this.input.value.length);
  }

  // ------------------------------------------------------------------ focus

  private readonly onDocMouseUp = (e: MouseEvent): void => {
    if (this.isOtherInteractive(e.target)) return;
    const sel = this.doc.getSelection();
    // A selection elsewhere is being copied; leave it until the pane that
    // owns it hands focus back.
    if (sel && !sel.isCollapsed && !this.el.contains(sel.anchorNode)) return;
    this.focus();
  };

  private readonly onWindowFocus = (): void => {
    this.focus();
  };

  private readonly onBeforeUnload = (e: BeforeUnloadEvent): void => {
    e.preventDefault();
    // Older Chrome needs returnValue set.
    e.returnValue = '';
  };
}
