# 0026 — Macros on printable keys

- Status: Accepted
- Date: 2026-09-28
- Amends: ADR 0015 "Key names" (the "Not bindable" rule for printable keys)

## Context

ADR 0015 refused printable keys without Ctrl or Alt ("That key types
text; add Ctrl or Alt."). The owner wants to bind bare letters,
Shift+letters and, on a Swedish keyboard, `§ 1234567890 + ´ ' -` with and
without Shift, and accepts that a bound key no longer types its
character in the input line.

## Decision

- **Bindable.** Printable keys (letters, digits, punctuation, Space,
  `Intl*`) are bindable bare and with Shift, in `#macro`, in the
  editor's key capture and in the input line. Still not bindable: bare
  ESC, Enter without Ctrl/Alt/Meta, the browser's keys (ADR 0015).
  AltGr combinations are still refused by the capture and ignored by the
  input line (they type characters such as `@` and `\`).
- **A bound key wins and is consumed.** The input line runs the macro
  before its own handling and calls `preventDefault`, so the character is
  not typed. Unbound keys type as before; binding `Shift+A` leaves `a`
  typing. Not in password mode, not in other fields, not while the chrome
  (menus, editor) is up — unchanged.
- **Warning, not refusal.** `shadowedInputKey` returns `types text` for a
  printable key without Ctrl/Alt/Meta; the editor shows
  "`a` overrides the input line (types text)." in the hint area.
- **Canonical names stay physical** (`KeyboardEvent.code`: `A`, `Shift+2`,
  `Backquote`, `Minus`). `normalizeKey` does not depend on the layout, so
  a profile means the same physical keys on every keyboard and the text
  `{-}` is always the key right of `0` (`Minus`), even where that key
  prints `+`. Keys are best bound with the capture, which writes the
  canonical name.
- **Layout-aware labels.** Only the displayed label follows the user's
  keyboard, for punctuation keys: `keys.ts` keeps a label map filled from
  `navigator.keyboard.getLayoutMap()` at start (Chromium; failures
  ignored) and learned from plain keydowns (no Ctrl/Alt/Meta/Shift/AltGr,
  `key` one printable character; dead keys teach nothing) in the input
  line and the key capture. A Swedish user sees `§`, `Shift+§`, `+`, `-`,
  `å` instead of `` ` ``, `-`, `/`, `[`. Letters and digits keep their
  names. With nothing learned (Firefox before the key has been pressed)
  the US labels are shown. A label learned while a view is open shows on
  its next render.
- **Dead keys.** A dead key (`key` = `Dead`, such as `´` = `Equal` and
  `¨` = `BracketRight` on a Swedish keyboard) is bindable like any other
  printable key, and preventDefault does not stop the composition it
  opens. The input line therefore:
  - sends a dead keydown to the macro lookup even while a composition is
    open (`isComposing`), so `´` then `¨` both fire; other keys during a
    composition still belong to the IME;
  - drops Firefox's second keydown for a consumed dead key (it fires one
    before and one after compositionstart) until that key's keyup, so one
    press runs the macro once; auto-repeat (`repeat`) still repeats;
  - snapshots the line (value and selection) when a macro consumes a dead
    key, and on the compositionstart/compositionupdate/`input` that
    follow ends the composition by blurring and refocusing the field
    (Firefox and Chrome end a composition on blur) and restores the
    snapshot; compositionend and a trailing non-composing `input` restore
    it too;
  - ends that guard at the next non-dead keydown outside a composition,
    or a task after a compositionend once the key is released. An unbound
    dead key composes as before (`´` + `e` → `é`).
  Checked with synthetic replays of the owner's Firefox/Linux event log
  (unit and e2e, both browsers) and a real Chromium composition over the
  DevTools protocol; a real keyboard is the owner's test.

## Rationale

- The owner's request; tt++ allows any key as a macro.
- Physical names keep shared profiles portable and make the stored text
  independent of the machine; a layout-dependent parser would silently
  rebind keys when a profile moves between keyboards.
- The Keyboard Map API is Chromium-only, so learning from keydowns gives
  Firefox users the right labels after they have used the key once.
