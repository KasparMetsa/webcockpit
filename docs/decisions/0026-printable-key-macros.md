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

## Rationale

- The owner's request; tt++ allows any key as a macro.
- Physical names keep shared profiles portable and make the stored text
  independent of the machine; a layout-dependent parser would silently
  rebind keys when a profile moves between keyboards.
- The Keyboard Map API is Chromium-only, so learning from keydowns gives
  Firefox users the right labels after they have used the key once.
