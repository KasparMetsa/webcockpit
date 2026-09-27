# 0019 — Stage 7: export editor, HTML replay, Spotlights and Credits

- Status: Accepted
- Date: 2026-09-28

## Context

Stage 7 (spec §2.8, §5 row 7) builds the sharing features on top of the
run library and the log player of ADR 0018: the export editor with a
text and a self-contained HTML export, the Spotlights reel and Credits.
Spec §2.8 requires that the log player and the HTML replay share one
renderer and show the whole screen (game text and every pane) in the
recorded layout. Four builders: P0 (foundation) first, then P1 (export
editor), P2 (HTML replay) and P3 (Spotlights, Credits) in parallel. This
ADR fixes the contracts between them. Builders add their details under
"Package notes".

## Decision

### Modules

| Module | Owner | Role |
|---|---|---|
| `src/runs/store.ts`, `src/core/db.ts` | P0 | DB v6: store `exports`. |
| `src/runs/library.ts` | P0 | `exportDoc` / `saveExportDoc`; delete, sweep and backup/restore include export docs. |
| `src/share/edits.ts` | P0 | `ExportDoc` model: exclusion ranges, comments, pure edit operations. |
| `src/share/text.ts` | P0 | Text export (pure). |
| `src/share/payload.ts` | P0 | `ReplayPayload`: a chain with its edits applied (excluded content removed), markers, header data. Pure. |
| `src/share/spotlights.ts` | P0 | Spotlight selection, windows, rotation, labels (pure). |
| `src/share/chronicle.ts` | P0 | Credits chronicle text (pure, deterministic). |
| `src/player/timeline.ts`, `engine.ts` | P0 | Timeline edits (cuts, comments + holds, windows, blanks); engine holds and target hooks. |
| `src/player/view.ts` | P0 | `PlayerViewOptions` hooks so P2 and P3 add modes in their own files. |
| `src/chrome/frames/export-*.tsx` | P1 | Export editor, its input frame; History EXPORT. |
| `src/replay/*`, `vite.config.ts` (replay build) | P2 | The HTML replay page runtime, its bundle, `buildReplayHtml`. |
| `src/chrome/frames/spotlights*.tsx`, `credits.tsx`, `options-spotlights.tsx`, `src/player/spotlight-*.ts` | P3 | Spotlights reel, Credits, Options → Spotlights, start page entries. |

No DOM outside `src/chrome`, `src/player` view files, `src/replay` page
files and `src/app`.

### Export doc (DB v6)

```ts
interface ExportDoc {
  sessionId: string;              // the chain's first run id (keyPath)
  schema: 1;
  title: string;                  // '' = default title
  format: 'html' | 'text';        // default 'html'
  /** Sorted, non-overlapping half-open ranges of entry log µs; to null = end of log. */
  excludes: Array<[fromUs: number, toUs: number | null]>;
  /** A comment shows before the entry with log µs beforeUs; null = after the last entry. */
  comments: Array<{ beforeUs: number | null; text: string }>;
}
```

- Anchors are entry log µs (Inv §7.7), so a chain that grows later does
  not shift them. Entry timestamps are unique within a run (the capture
  clock is monotonic, ADR 0007 amendment).
- Saved on every edit. No doc = defaults. `RunLibrary.remove(session)`
  and `sweep` delete the doc of a removed chain's first run; a doc whose
  run is gone is deleted by the sweep. Backup writes one `export` line per
  doc after the runs; restore adds a doc when none exists for that id.
- Default title `mume-<char>-<YYYY-MM-DDTHH-MM-SS>` (first run start,
  local time); unsafe filename characters → `-`. The file is a browser
  download `<title>.html` / `<title>.txt`.

### What an exclusion removes

The editor shows and excludes **visible entries**: inbound lines and
sent commands. An excluded range `[from, to)` covers every entry whose
log µs is in it:

- IN and OUT entries: removed (not played, not in any export file).
- GMCP `Comm.*` (channel text in the Comm pane): removed.
- Other GMCP, VIEW and SIZE: kept, but played in no time at the cut, so
  the panes are right when the log resumes (vitals, group, timers).
- Markers (events) inside an excluded range are dropped.
- A cut (one excluded range between kept entries) plays in at most
  500 ms (Inv §7.7); a range at the start or end of the log plays in 0.

The HTML replay and the text export never contain removed content: P0's
payload builder writes new capture texts without it.

### Comments and holds

- A comment is shown in the game output as its wrapped `## ` lines
  (whitespace collapsed, ≤ 600 chars, wrapped at 80 columns, colour
  `#ffd75f`), before its anchor entry.
- In the HTML replay it **holds** playback for `clamp(2 + len/15, 5, 20)`
  seconds of real time, independent of speed (Inv §7.7); the log clock
  stands still during a hold. In the export editor it is text only.
- Timeline: a new entry kind `ENTRY_COMMENT` (body = the comment text)
  and a per-entry hold. The engine delivers a comment through
  `PlayerTarget.comment(text)`, then lets playback time pass at 1× wall
  rate for the hold, whatever the speed. Seeks treat holds as normal
  playback time (the strip and `MM:SS` include them).

### Timeline edits

`buildTimeline(chain, edits?)` gains an optional second argument:

```ts
interface TimelineEdits {
  comments?: Array<{ beforeUs: number | null; text: string; holdMs: number }>;
  cutsUs?: number[];               // log µs of each cut (where a range ended), ≤ 500 ms each
  /** Spotlight mode: per run, only entries in [fromUs, toUs] play; see below. */
  windows?: Array<{ fromUs: number; toUs: number }>;
  /** Blank lines before each window (spotlight transition, Inv §7.6). */
  blankLines?: number;
}
```

With no edits the timeline is exactly ADR 0018's (the in-app player is
unchanged). Removal of excluded content is not a timeline job: the
payload builder has already removed it.

**Spotlight windows.** In spotlight mode each spotlight is one `ChainRun`
(its run's capture, cut to the window plus a state prefix). For run `i`
with window `[from, to]`: entries before `from` are the **state
prefix**: IN and OUT are dropped, GMCP / VIEW / SIZE are kept and take
no playback time; entries in the window play normally (the pre-roll is
trimmed forward to the first visible entry, Inv §7.6 ADR 0079); the
post-roll after the last entry dwells until `to` (never clamped); entries
after `to` are dropped. Before each window the target gets
`PlayerTarget.blank(blankLines)` (100 blank rows: the scene scrolls
clear); blanks take no playback time and the pause cursor skips them.
The state prefix is read from at most 10 minutes before `from`
(`RunLibrary.chainLogRange(runId, fromUs, toUs)`, chunk-granular, P0).

### PlayerTarget additions

```ts
interface PlayerTarget {
  // … ADR 0018 …
  comment(text: string): void;   // shows the wrapped `## ` lines
  blank(lines: number): void;    // blank rows (spotlight transition)
}
```

`PlayerHost` implements both on the output pane (rows marked so the
cursor skips blanks and comments keep their colour).

### PlayerView options

P0 turns the in-app player chrome into a configurable view so P2 and P3
add their modes without editing it:

```ts
interface PlayerViewOptions {
  // … existing …
  header: () => { left: Array<{ text: string; cls?: string }>; hints: string[] };
  keys?: (e: KeyboardEvent) => boolean;   // extra keys first (true = handled)
  overlay?: HTMLElement;                   // an extra layer (info box) the view shows/hides with the chrome, or keeps visible
  startHidden?: boolean;                   // spotlight: chrome hidden on entry
  stripHoverTime?: boolean;                // replay: MM:SS tooltip on hover
  onEsc: () => void;
}
```

### Replay payload and the HTML replay

```ts
interface ReplayPayload {
  schema: 1;
  title: string;                   // '' = none
  character: string;
  level?: number;
  startUs: number;                 // first run start (header date)
  settings: Settings;              // the exporter's settings at export time (appearance, panes)
  runs: Array<{ meta: RunMeta; text: string }>;  // edited capture texts
  comments: Array<{ beforeUs: number | null; text: string; holdMs: number }>;
  cutsUs: number[];
  markers: Array<{ us: number; kind: 'A' | 'D' | 'K' | 'L' }>;
}
```

- `buildReplayPayload(chain, events, doc, settings)` (P0) applies the
  edits; `buildTextExport(chain, doc)` (P0) returns the text file.
- **One renderer:** the HTML replay runs the same code as the in-app
  player: `buildTimeline`, `PlayerEngine`, `PlayerHost` (with a player
  `App`), `PlayerView`. P2 builds `src/replay/main.ts` as a separate
  single-file bundle (one IIFE script with its CSS inlined), fixed name
  `replay/replay.js`, emitted by `vite build` and served by `npm run dev`
  (a small Vite plugin that bundles it on request). P2 checks that no
  storage, network or MUME code runs in it (a player App already has
  none; `IndexedDB`, `localStorage`, `fetch` and `WebSocket` must not be
  touched; a `file://` page may have no storage at all).
- `buildReplayHtml(payload): Promise<Blob>` (P2, `src/replay/export.ts`,
  used by P1) fetches the bundle and the exporter's current font family
  (regular and bold woff2) from the app's own origin and writes one HTML
  file: the fonts as `data:` URIs in `@font-face`, the payload as gzip +
  base64 JSON in a `<script type="application/json">`, and the bundle.
  The page decodes it with `DecompressionStream`. A 5 h run is about
  1–1.5 MB of HTML.
- **Replay page differences** from the in-app player (Inv §7.7): header
  `<title> · <char> (L<lvl>) · YYYY-MM-DD` and hints `Space Play · ↑↓
  Scroll · 1–6 Speed · F Fullscreen` (hidden when narrow); no ESC Back
  (ESC leaves fullscreen); `F` and a `Fullscreen` / `Exit fullscreen`
  control; the strip's hover time; comment holds; the speeds of the
  in-app player (0.25×–8×, one set for both).

### Spotlights

- `selectSpotlights(runs, events, filters) → Spotlight[]` (P0): events
  `char_death`, `level_up`, `pkill`, `achievement` from all characters'
  sealed runs with a log; one spotlight per event; window `[at − 10 s,
  at + 5 s]` with `at = logUs ?? us`; windows with no visible entry are
  dropped (P3 checks after loading); rotation per Inv §7.6 (per-character
  queues newest first, most recent head, not the same character twice in
  a row while another remains). Labels per Inv §7.6.
- The reel plays in the in-app player (`PlayerHost` + `PlayerView`
  spotlight mode, P3): one timeline over all spotlights (windows +
  blanks), header `<CHAR> (L<lvl>) · SPOTLIGHT N / TOTAL · YYYY-MM-DD`,
  hints `ESC Back · ←→ Prev/next`, chrome hidden on entry, info box
  (30 × 7 + countdown row) as an overlay, `←`/`→`, park at the end, empty
  states `no_data` / `filtered`.
- Loading: spotlights' windows are read lazily with `chainLogRange`; the
  reel starts when the first few are loaded.

### Credits

- `buildChronicle(characters, filters, opts) → string[]` (P0): all
  events of the four kinds from all characters (no log needed), one
  chapter per character (oldest first), a sentence per event from
  per-kind templates picked by a stable hash of (character, run, us,
  kind), an opening line and `The End.` The wording is our own (Cockpit
  is a reference for the shape only).
- The frame (P3) scrolls 1 row/s bottom to top in a centred column
  `min(60, max(40, cols − 8))`, fades the top and bottom 35 %, shows
  `Escape to exit`, and returns to the menu when `The End.` has left the
  top. Only ESC is bound.

### Settings

`settings.spotlights: { achievements, deaths, levelUps, pvp }` (booleans,
default true), global, saved as they change (Options → Spotlights, P3).
Settings migration adds the defaults (P0).

## Rationale

- Removing excluded content in the payload builder (not at play time)
  keeps the shared file free of anything the owner cut.
- Keeping state GMCP across a cut keeps the panes right, which a
  line-only cut (Cockpit) did not need.
- Bundling the player App into the HTML file is the only way to show the
  panes exactly as the player did (spec §2.8, one renderer). It costs
  about 250 KB of script and 150–300 KB of font per file.
- The state prefix bound (10 minutes) keeps Spotlights from reading whole
  multi-hour runs for a 15 s window; the panes update within seconds of
  play anyway.

## Consequences

- Stage 7 adds DB v6. Backups gain `export` lines (additive, schema 1).
- `buildTimeline` and `PlayerEngine` gain optional edits; the in-app
  player's behaviour is unchanged when none are given.
- The HTML replay file carries a copy of the client's player code. It is
  GPL like the rest (ADR 0001); the file says so in a comment.

## Package notes

(Builders append here.)

### P0 — foundation (2026-09-28)

**Files.** New: `src/share/edits.ts` (ExportDoc model, names, comment
wrap/hold, edit ops), `src/share/capture.ts` (capture line reader for the
exports: `captureEntries`, `stripAnsi`, `isVisible`, `isCommText`),
`src/share/text.ts`, `src/share/payload.ts`, `src/share/spotlights.ts`,
`src/share/chronicle.ts`. Changed: `src/core/db.ts` (v6 `exports`),
`src/runs/store.ts` (export CRUD, `getChunk`, `chunksFrom`),
`src/runs/library.ts`, `src/player/timeline.ts`, `engine.ts`, `clock.ts`
(`rebase`), `strip.ts` (`HeaderHint`, `fitHints(cols, hints?)`), `view.ts`,
`player.css`, `src/app/player-host.ts`, `src/ui/output-pane.ts`
(`pushRows`), `src/ui/ui.css` (`.wc-comment`), `src/settings` (spotlights).
Tests: `tests/unit/share-{library,edits,export,spotlights}.test.ts`,
`player-edits.test.ts`, `player-modes.test.ts`; `player-helpers.ts`'s
RecordingTarget records `comment` / `blank`.

**Public API.**

```ts
// src/runs/library.ts (RunLibrary)
exportDoc(sessionId): Promise<ExportDoc>          // defaults when none; normalised
saveExportDoc(doc): Promise<void>                 // every edit
chainLogRange(runId, fromUs, toUs): Promise<{ meta, text } | null>
  // whole chunks overlapping [fromUs, toUs] (binary search on seq, then a
  // cursor; a seq hole falls back to reading all); text '' when none
// remove(session) also deletes the doc of session.id; sweep deletes every doc
// whose sessionId run is gone; backup writes {"type":"export","doc":…} after
// the runs (sealed runs' docs only); restore adds a doc when none is stored.

// src/share/edits.ts
interface ExportDoc { sessionId; schema: 1; title; format: 'html'|'text';
                      excludes: ExcludeRange[]; comments: ExportComment[] }
type ExcludeRange = [fromUs: number, toUs: number | null];
COMMENT_MAX 600, COMMENT_COLS 80, COMMENT_PREFIX '## ', COMMENT_COLOR '#ffd75f'
defaultExportDoc(id); normalizeExportDoc(raw) → ExportDoc | null; mergeRanges(r)
defaultTitle(char, startUs)  // mume-<char>-<YYYY-MM-DDTHH-MM-SS>; pass Session.startUs
exportTitle(doc, char, startUs); exportFileName(doc, char, startUs) → '<title>.html|.txt'
sanitizeFileName(s); collapseComment(t); commentLines(t, cols=80) → ['## …'];
commentHoldMs(t) → ms
rangeAt(doc, us); isExcluded(doc, us); excludedCount(doc, keysAscending)
excludeFrom(doc, us); stopExcluding(doc, us, keys?)          // Inv §7.7 semantics
addComment(doc, beforeUs|null, text, slot = Infinity)        // slot among same-anchor comments
editComment(doc, index, text) (empty = delete); deleteComment(doc, index)
setTitle(doc, t); toggleFormat(doc)                          // ops return new docs (no-op = same object)

// src/share/text.ts, payload.ts
buildTextExport(chain, doc) → string
buildReplayPayload(chain, events, doc, settings) → ReplayPayload
editRunText(text, doc) → string; payloadEdits(payload) → TimelineEdits
interface ReplayPayload { schema: 1; title; character; level?; startUs; settings;
  runs: { meta, text }[]; comments: { beforeUs, text, holdMs }[];
  cuts: ExcludeRange[]; markers: { us, kind: 'A'|'D'|'K'|'L' }[] }

// src/player/timeline.ts
buildTimeline(chain, edits?: TimelineEdits)
interface TimelineEdits { comments?: {beforeUs, text, holdMs}[];
  cuts?: [from, to|null][]; windows?: ({fromUs, toUs} | null)[]; blankLines?: number (100) }
ENTRY_COMMENT = 5, ENTRY_BLANK = 6, CUT_MAX_MS = 500, BLANK_LINES = 100
Timeline gains hold: Float64Array (empty without comments), holds: {at, ms}[],
  comments: string[], blankLines; durationMs includes a trailing hold / dwell
advancePlay(tl, p0, wallMs, speed); wallBetween(tl, p0, p1, speed)
playAtLogUs(tl, us, run?)       // with run: search that run only (spotlight reels)

// src/player/engine.ts — PlayerTarget gains optional comment?(text), blank?(lines)
// src/player/clock.ts — ReplayClock.rebase(us)

// src/player/view.ts
interface PlayerViewOptions { root; engine; marks; output; cells; hideMs?;
  header: (run) => PlayerHeaderModel;           // { left: {text, cls?}[]; hints: HeaderHint[] }
  onEsc: () => void;
  keys?: (e) => boolean;                        // first, before modifiers; true = handled
  overlay?: { el: HTMLElement; keepVisible?: boolean };
  startHidden?: boolean; stripHoverTime?: boolean;
  boxButtons?: { label: () => string; onClick: () => void }[] }  // extra box row above the clock
runHeader(h: PlayerHeader, onEsc) → PlayerHeaderModel   // the in-app header
PlayerView.refresh()
// src/player/strip.ts
interface HeaderHint { text; drop; onClick?; cls? }; fitHints(cols, hints = HINTS)

// src/app/player-host.ts
openChain(chain, events, info, opts?: PlayerOpenOptions)
interface PlayerOpenOptions { edits?: TimelineEdits;
  marks?: (tl) => { letter, offset }[];         // default markersOf(events) on playAtLogUs
  view?: Partial<Pick<PlayerViewOptions, 'header'|'keys'|'overlay'|'startHidden'|
                      'stripHoverTime'|'boxButtons'|'onEsc'>>;
  autoplay?: boolean }                          // default true
host.engine, host.app, host.playerView

// src/share/spotlights.ts
selectSpotlights(runs: { meta, events }[], filters) → Spotlight[]   // reel order
interface Spotlight { id: '<runId>#<i>'; runId; character; level?; kind:
  'pkill'|'death'|'level'|'achievement'; atUs; fromUs; toUs; prefixFromUs;
  label; runStartUs; event }
KIND_LABEL (info box type line), spotlightLabel(e, level?), eventAt(e),
kindShown(kind, filters), hasVisibleEntry(text, fromUs, toUs),
emptyState(filters) → 'no_data'|'filtered', WINDOW_BEFORE_US, WINDOW_AFTER_US,
STATE_PREFIX_US

// src/share/chronicle.ts
buildChronicle(runs: { meta, events }[], filters, { width? = 60 }) → string[]  // '' = blank row; [] = empty
CHRONICLE_OPENING, CHRONICLE_END ('The End.'), CHAPTER_HEADERS, TEMPLATES,
eventSentence, datePhrase, stableHash (FNV-1a), wrapText

// src/settings — settings.spotlights { achievements, deaths, levelUps, pvp }, migrateSpotlights
```

**How the pieces fit.** P1: `lib.exportDoc(session.id)`, apply ops, `lib.
saveExportDoc(doc)` on each edit; the editor's lines and anchors come from
`captureEntries` (visible = `isVisible`); counts with `excludedCount`; text
download = `buildTextExport(chain, doc)`; HTML = `buildReplayHtml(
buildReplayPayload(chain, events, doc, settings.get()))`. P2: a
`PlayerHost` over an in-memory `SettingsStore` holding `payload.settings`,
`openChain(payload.runs, [], { character, level }, { edits:
payloadEdits(payload), marks: (tl) => payload.markers.map((m) => ({ letter:
m.kind, offset: playAtLogUs(tl, m.us) })), view: { header, onEsc,
keys (F), stripHoverTime: true, boxButtons: [Fullscreen] } })`. P3:
`selectSpotlights` over `listRuns` + `events`, load each with
`chainLogRange(s.runId, s.prefixFromUs, s.toUs)`, drop those without
`hasVisibleEntry(text, s.fromUs, s.toUs)`, then `openChain(runs, [], info,
{ edits: { windows, blankLines: 100 }, marks: (tl) => … playAtLogUs(tl,
s.atUs, i) …, view: { header, keys (←/→ seek to tl.runs[i] start),
overlay: { el: infoBox, keepVisible: true }, startHidden: true } })`.

**Decisions and deviations.**
- *Cuts are ranges, not `cutsUs`.* A cut needs its start too: the kept state
  entries inside it must take no time and the stretch is measured from the
  last entry before the range. `TimelineEdits.cuts` and `ReplayPayload.cuts`
  are the excluded ranges (`[from, to|null]`); every range is passed (one at
  either end plays in 0 anyway: the lead-in rule at the start, entries
  inside at the end). A cut plays in `min(500 ms, real)`, 0 when the real
  stretch is over 10 s (like a gap). A range with nothing removed still
  shortens the stretch over it.
- *Comm text:* an exclusion removes `Comm.*` GMCP except
  `Comm.Channel.List`, which is state (the Comm header's channels).
- *Comments on removed entries* move to the next kept visible entry in the
  payload (or to the end). The timeline puts a comment before the first
  entry with `ts ≥ beforeUs`, on that entry's log time, after the gap before
  it; several on one anchor keep their order. The comment row is stamped
  with the anchor's time (a cursor there resumes at the anchor, after the
  hold). The trailing (null) comment belongs to the last run and its hold
  extends `durationMs`; `logUsAt` stands still in every hold.
- *Holds in the engine:* `livePos` and the driver's sleep go through
  `advancePlay` / `wallBetween`, which are exactly the old formulas when
  there are no holds (the existing tests pass unchanged).
- *Spotlight runs in any order:* runs of a reel are ordered by the rotation,
  not by time. `logUsAt` clamps to the next entry's time only within a run
  (a normal chain never had a cross-run clamp that mattered: run 2's first
  entry is in its lead-in, so it has the previous entry's `play`), the engine
  `rebase`s the replay clock when a run starts before it (pending timers keep
  their distance), and markers map per run (`playAtLogUs(tl, us, run)`).
  The blank entry is the run's first entry (after the connect, before the
  state prefix) and the post-roll dwells from `max(last entry, from)` to
  `to`.
- *`PlayerTarget.comment` / `blank` are optional* so older targets (tests)
  still type-check; `PlayerHost` implements both through
  `OutputPane.pushRows('comment' | 'blank', …)` (`.wc-comment` `#ffd75f`,
  `.wc-blank`). The pause cursor skips `.wc-blank` rows (↑↓, PgUp/PgDn,
  Home, clicks).
- *PlayerView options:* `header` returns parts + hints (the ADR's `{ left,
  hints: string[] }` became `HeaderHint[]` so each mode keeps its drop order
  and clickable hints); `overlay` is `{ el, keepVisible? }` (appended to the
  player element, `data-hidden` toggled with the chrome unless
  `keepVisible`; P3 styles it); `boxButtons` added for the replay's
  `Fullscreen` control; `keys` runs before the modifier check; with
  `startHidden` the chrome stays hidden when play starts until a key or
  pointer move. `fitHints` now lets a list without an `Infinity` hint drop
  every hint (the replay's hints hide when narrow). The in-app header's DOM
  is unchanged (`runHeader`).
- *Chronicle input* is the runs (`{ meta, events }[]`), grouped by
  character; chapters are ordered by each character's oldest shown deed.
  The level of a death comes from the event, else the run's last
  `run_start` / `level_up`, else the summary. Achievement names lose a
  trailing `.`/`!`.
- *Spotlight level:* the level at the event (baseline, level-ups and a
  death's level so far), else the run summary's.
- *Titles:* `setTitle` collapses whitespace, max 200 chars; the file name
  sanitises `\ / : * ? " < > |`, control characters and a leading dot.
- *Backup:* only docs of sealed runs are written; export lines come after
  all runs (a stage 6 reader would reject them as unknown, schema stays 1 as
  decided).

**Open issues.**
- `npm run bench` was not re-run for P0 (the output pane's hot path only
  gained an optional op field); the merge task runs it.
- Comments in a run's lead-in hold at playback 0 before any text: fine for
  the replay, but P1/P2 may want to anchor such comments visibly.

### P1 — export editor (2026-09-28)

**Files.** New: `src/chrome/frames/export-editor.tsx` (the frame),
`export-input.tsx` (comment / title entry), `export-model.ts` (pure: log
arrays, items and row offsets, map, SGR colouring, cursor and comment-slot
arithmetic), `export.css`, `src/chrome/kit/download.ts` (`downloadBlob`,
History's backup download moved there), `src/replay/export.ts` (**stub**
with P2's signature, throws `HTML replay not built yet`; keep P2's file at
merge). Changed: `history.tsx` (EXPORT active with a log, not dimmed;
pushes the editor on the History stack, so BACK / ESC return with its
state intact). Tests: `tests/unit/chrome-export-model.test.ts`,
`chrome-export.test.tsx`, `chrome-history.test.tsx` (EXPORT expectations),
`tests/e2e/export.spec.ts`.

**Choices.**
- *Items, not lines, are cursor stops:* an entry (wrapped to several rows
  when longer than the log width), a comment (all its `## ` rows) or the end
  row. ↑↓ move one item, PgUp/PgDn one viewport of rows, the wheel 3 items.
  The cursor is kept as `{entry}` / `{comment}` / `{end}` so it survives an
  item rebuild; a new comment takes the cursor, a deleted one hands it to
  what followed.
- *Commands on rows of their own* as `> cmd` (`>` grey), not appended to the
  prompt as the output pane echoes them: one row per entry keeps the
  exclusion anchors exact. Empty Enters and the two width commands are not
  shown (as in the output pane and the text export); the `N lines` count is
  these visible entries.
- *Hard wrap* at the log width (LOG width = cols − 29, 20…100 cells), so row
  counts are arithmetic on the stored lengths; comments wrap at
  `min(80, width)`.
- *Speed:* the chain is read once into flat arrays (`ts`, `kind`, `raw`,
  `len`); items + row offsets are rebuilt in one pass when the comments or
  the width change; the excluded count and the map when the ranges change;
  SGR is parsed only for the rows on screen. Measured in Chromium on a
  100 000-line run: open ≈ 170 ms, a key ≈ 6–9 ms, a comment save ≈ 60 ms.
- *Map:* 2 columns over the log height: content (`K/D/A/L` gold > `■`
  comment > `█` excluded `#6f3030` > `│` track) and a thumb column. A
  click puts the cursor on the item at that fraction, centred.
- *Buttons:* EXCLUDE / STOP need an entry under the cursor; EDIT / DELETE a
  comment; the rest are always enabled. Letter keys work in both zones.
  Enter / Space act only in the button zone.
- *Input frame* reads keys itself (no `<input>`, whose value sanitising
  would drop pasted newlines instead of turning them into spaces); paste is
  taken from the document `paste` event. The comment preview shows the
  wrapped `## ` lines, `n / 600` and `Holds the replay for N s.`. The title
  starts as the effective title; saving the default (or an empty field)
  stores `''`.
- *Feedback:* `Exported <file>` (gold) / `Export failed: …` (grey) on the
  editor's flash row, which History shows too when BACK follows within 3 s.
  HTML shows `Building the replay…` while `buildReplayHtml` runs. Save
  errors flash `Could not save the edit: …`.

**Deviations.** Info row file part is `→ <title>.<ext>` (no `~/`, it is a
browser download). No `-2` suffix handling (the browser's job, Inv §7.7).

**Open issues.**
- The HTML path is only exercised against the stub (the e2e accepts either
  `Exported …html` or `Export failed: …`); re-run `tests/e2e/export.spec.ts`
  after merging P2.
- Comments anchored inside an excluded range show where they were placed;
  the payload moves them to the next kept entry (P0), so the replay can
  show them a little later than the editor suggests.
