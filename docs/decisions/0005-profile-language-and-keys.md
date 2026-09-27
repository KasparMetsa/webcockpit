# 0005 — Profile language and macro key names

- Status: Accepted
- Date: 2026-09-27

## Decision

- **Language.** Profiles are tt++ syntax text. The supported command
  subset is spec §3.
- **Source of truth.** The profile text is the source of truth; the lite
  view edits entries inside it.
- **Lossless save.** Comments, blank lines, order and unknown commands
  survive byte for byte.
- **Macro keys:**
  - Written as readable names built from `KeyboardEvent.code` plus
    modifiers, such as `F5`, `Numpad0` and `Ctrl+Shift+KeyA` shown as
    `Ctrl+Shift+A`.
  - The common tt++ escape forms (`\eOp`…`\eOy`, `\eOP`…`\eOS`,
    `\e[15~`…) are also accepted on read and kept as written.
- **Separate rule stores.** System rules (trackers, run capture) live in
  a separate store and are never serialised into a profile.

## Rationale

Veterans can paste tt++ text directly. Cockpit lost data on save
(research inventory §5.9) and leaked a core ticker into a profile (§6.1);
both are designed out.
