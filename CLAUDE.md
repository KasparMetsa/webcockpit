# WebCockpit — Notes for Claude

A MUD client for MUME that runs entirely in the user's browser. Loaded from
a link, no application server. Target: hundreds of users, tt++-level
feature parity, minimal latency, TUI look and feel.

## Project phase

**Current phase: Intent (grilling).** No code yet.

1. `intent.md` — what and why. Written through a grilling session with the
   owner. Nothing else starts until it is approved.
2. `spec.md` — how. Derived from `intent.md`. Approved by the owner.
3. Build in stages (etapper). Each stage ends with something the owner can
   test in the browser and give direction on.

## Authoritative documents

- `intent.md` — goals, non-goals, users, success criteria. Wins over
  everything else.
- `spec.md` — architecture and requirements (once it exists).
- `docs/decisions/` — Architecture Decision Records, append-only,
  numbered `NNNN-title.md`.
- `notes/grilling.md` — raw Q&A log from the intent sessions. Source
  material, not authoritative.

## Reference project (read-only)

`/home/ole/MUME` is Cockpit, the owner's terminal client (TinTin++ + Lua +
tmux). Use it as a **knowledge reference**: how MUME's GMCP works
(`docs/gmcp.md`), how panes look and behave (`docs/*-pane.md`), lessons
learned (`docs/decisions/`), and real session logs as test material.

- Never copy or port code from it. WebCockpit is a new codebase.
- Never modify anything under `/home/ole/MUME`.
- The visual target is "very close to Cockpit", not pixel-identical.

## Working mode

- The owner wants minimal involvement: ask only for decisions that are
  genuinely theirs (direction, scope, UX taste, trade-offs with user
  impact). Decide technical details yourself and record them as ADRs.
- Subagents do the building. The main session plans, delegates, verifies.
- Every stage ends with a short test guide for the owner: what to open,
  what to try, what feedback is wanted.

## Language

- Conversation with the owner: Swedish.
- Code, comments, commit messages, docs: English.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
