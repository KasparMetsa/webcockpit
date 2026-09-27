// The system lines a player App prints into the game text while it replays
// a chain (ADR 0019 amendment "System lines"). Pure.
//
// A player App (src/app/app.ts `player: true`) prints no connect, replay or
// disconnect lines; the one `[SYSTEM]` line it does print is the login
// line, `<name> logged in.`, when a run's connection goes from `login` to
// `playing`. Session (src/net/session.ts) does that on the run's first
// GMCP `Char.Name` while in `login`; the App has already taken the name
// from that message (its bus listener runs first), so the line carries the
// latest `Char.Name` name, else an earlier run's, else `Character`. A
// `Core.Goodbye` ends the connection, so a later `Char.Name` in the same
// run prints nothing. Each run connects anew, so a run prints at most one
// login line.
//
// The export editor shows these lines as rows (anchored on the `Char.Name`
// entry's log µs, so a comment placed before the row plays before it), the
// text export writes the ones that are not excluded, and the replay payload
// lists the excluded ones (`hiddenSys`) so the player does not print them.
//
// Not derived: `GMCP <pkg>: bad JSON (…)` (the error text is the browser's
// JSON.parse message; the recorder stores what MUME sent, so it does not
// occur in practice).

import { type CaptureEntry, captureEntries } from './capture';

/** The prefix the output pane gives a system line (src/ui/output-pane.ts). */
export const SYS_PREFIX = '[SYSTEM] ';

/** A system line the player prints. */
export interface SystemLine {
  kind: 'sys';
  /** Index of the run in the chain. */
  run: number;
  /** Log µs of the entry that makes the player print it (the anchor). */
  ts: number;
  /** The message as printed after `[SYSTEM] `, e.g. `Rasta logged in.` */
  body: string;
}

/** A capture entry with its run index. */
export type RunEntry = CaptureEntry & { run: number };

function gmcpName(e: CaptureEntry): string | null {
  const sp = e.body.indexOf(' ');
  if (sp < 0) return null;
  try {
    const d = JSON.parse(e.body.slice(sp + 1)) as { name?: unknown } | null;
    return d && typeof d.name === 'string' && d.name ? d.name : null;
  } catch {
    return null;
  }
}

/**
 * Every capture entry of a chain (oldest run first) in play order, with
 * the player's system lines in the place they print: right after the
 * entry that causes them.
 */
export function* playerEntries(chain: ReadonlyArray<{ text: string }>): Generator<RunEntry | SystemLine> {
  let name = '';
  for (let run = 0; run < chain.length; run++) {
    let state: 'login' | 'playing' | 'down' = 'login';
    for (const e of captureEntries(chain[run]!.text)) {
      yield Object.assign(e, { run });
      if (e.kind !== 'gmcp') continue;
      const pkg = e.pkg!.toLowerCase();
      if (pkg === 'char.name') {
        name = gmcpName(e) ?? name;
        if (state === 'login') {
          state = 'playing';
          yield { kind: 'sys', run, ts: e.ts, body: `${name || 'Character'} logged in.` };
        }
      } else if (pkg === 'core.goodbye') {
        state = 'down';
      }
    }
  }
}

/** The system lines of a chain, in play order. */
export function systemLines(chain: ReadonlyArray<{ text: string }>): SystemLine[] {
  const out: SystemLine[] = [];
  for (const e of playerEntries(chain)) if (e.kind === 'sys') out.push(e);
  return out;
}
