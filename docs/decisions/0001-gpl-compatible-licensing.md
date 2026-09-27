# 0001 — GPL-compatible licensing

- Status: Accepted
- Date: 2026-09-27

## Context

WebCockpit leans heavily on TinTin++ (GPL-3.0) as a behavioural reference
and will add a map based on MMapper (GPL-2.0-or-later). One integration
option is to embed MMapper's code (e.g. its WebAssembly build) in
WebCockpit. Serving that to other players is distribution, which would
require the combined work to be released under the GPL.

The repository is private until the owner judges it mature (intent.md).

## Decision

The owner accepts that WebCockpit is released as open source under the
GPL when it is shared with others. The exact version (GPL-3.0-or-later is
the default choice, compatible with MMapper's GPL-2.0-or-later) is fixed
at first public release.

## Consequences

- All MMapper integration options remain open, including embedding
  MMapper code.
- Third-party dependencies must be GPL-compatible licences (MIT, BSD,
  Apache-2.0, LGPL, GPL).
- Cockpit code is still not copied (CLAUDE.md), for codebase reasons,
  not licensing ones.
- Map data licensing is assessed separately from code licensing.
