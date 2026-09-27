// The text export (ADR 0019, Inv §7.7): the kept game text of a session as
// a plain `.txt`. Pure.
//
//   - inbound lines without timestamps and ANSI;
//   - commands as the output echoes them: appended to an open prompt line
//     (one space between unless the prompt ends in whitespace), else on a
//     line of their own; empty Enters and the width commands sent on
//     entering the game are not echoed (src/ui/output-pane.ts);
//   - comments as their wrapped `## ` lines before their anchor;
//   - a blank line between the runs of the chain;
//   - excluded entries are not in it at all. GMCP and client records never
//     are.

import { isPromptLike } from '../net/replay-socket';
import { PLAYING_COMMANDS } from '../net/session';
import type { ChainRun } from '../player/timeline';
import { captureEntries, stripAnsi } from './capture';
import { type ExportDoc, commentLines, isExcluded } from './edits';

/** The text file of a session with its edits applied (lines end in `\n`). */
export function buildTextExport(chain: readonly ChainRun[], doc: ExportDoc): string {
  const out: string[] = [];
  const comments = doc.comments;
  let ci = 0;
  /** The last line is a prompt that has no echo yet. */
  let openPrompt = false;
  let runsWritten = 0;

  for (const run of chain) {
    let first = true;
    for (const e of captureEntries(run.text)) {
      if (e.kind !== 'in' && e.kind !== 'out') continue;
      if (isExcluded(doc, e.ts)) continue;
      if (e.kind === 'out' && (e.body === '' || PLAYING_COMMANDS.includes(e.body))) continue;
      if (first) {
        first = false;
        if (runsWritten++ > 0) {
          out.push('');
          openPrompt = false;
        }
      }
      while (ci < comments.length && comments[ci]!.beforeUs !== null && comments[ci]!.beforeUs! <= e.ts) {
        out.push(...commentLines(comments[ci++]!.text));
        openPrompt = false;
      }
      if (e.kind === 'in') {
        out.push(stripAnsi(e.body));
        openPrompt = isPromptLike(e.body);
      } else if (openPrompt) {
        const p = out[out.length - 1]!;
        out[out.length - 1] = p === '' || /\s$/.test(p) ? p + e.body : p + ' ' + e.body;
        openPrompt = false;
      } else {
        out.push(e.body);
      }
    }
  }
  while (ci < comments.length) out.push(...commentLines(comments[ci++]!.text));
  return out.length ? out.join('\n') + '\n' : '';
}
