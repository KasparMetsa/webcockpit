// Export editor input (Inv §7.7 `export_input`): the comment and title
// entry, a frame of its own on top of the editor.
//
//                        ─── Add comment ───
//          > This log happened in DT yesterday. Me and my group_
//                                                         52 / 600
//
//          ## This log happened in DT yesterday. Me and my group     (preview)
//          Holds the replay for 5 s.
//
// Keys are read directly (no text field, so a paste keeps its words apart):
// printable characters and a paste append (newlines become spaces),
// Backspace deletes one, Ctrl+U clears, Enter saves (the editor decides what
// an empty text means: an edited comment is deleted, a title goes back to
// the default), ESC cancels.

import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { COMMENT_MAX, collapseComment, commentHoldMs, commentLines } from '../../share/edits';
import { useGrid } from '../kit/hooks';
import { centreLeft, wrapText } from '../kit/nav';
import { useIsTop, useKeys, useNav } from '../kit/stack';
import { Blank, Line, Page } from '../kit/widgets';
import { holdText } from './export-model';

/** Longest title, characters. */
export const TITLE_MAX = 200;

export interface ExportInputProps {
  mode: 'comment' | 'title';
  /** The page title (`Add comment`, `Edit comment`, `Export title`). */
  title: string;
  initial: string;
  /** Title mode: the file extension for the preview. */
  ext?: string;
  onSave: (text: string) => void;
}

/** Newlines (and tabs) of pasted text as spaces. */
export const pasteText = (s: string): string => s.replace(/\r\n|[\r\n\t]/g, ' ');

export function ExportInputFrame(p: ExportInputProps): VNode {
  const nav = useNav();
  const isTop = useIsTop();
  const { cols } = useGrid();
  const [text, setText] = useState(p.initial);
  const max = p.mode === 'comment' ? COMMENT_MAX : TITLE_MAX;
  const append = (s: string): void => setText((cur) => (cur + s).slice(0, max));

  const commit = (): void => {
    nav.pop();
    p.onSave(text);
  };

  useKeys((e, nk) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      commit();
      return true;
    }
    if (e.key === 'Backspace') {
      setText((cur) => [...cur].slice(0, -1).join(''));
      return true;
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'u') {
      setText('');
      return true;
    }
    if (!e.ctrlKey && !e.altKey && !e.metaKey && [...e.key].length === 1) {
      append(e.key);
      return true;
    }
    // Everything else but ESC (cancel, the stack pops) and the paste shortcut is swallowed.
    return nk !== null && nk !== 'back';
  });

  // A paste lands on the focused stack host; take its text.
  useEffect(() => {
    if (!isTop) return;
    const onPaste = (e: ClipboardEvent): void => {
      const s = e.clipboardData?.getData('text/plain') ?? '';
      if (!s) return;
      e.preventDefault();
      append(pasteText(s));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isTop]);

  const width = Math.max(20, Math.min(80, cols - 4));
  const at = centreLeft(cols, width);
  const field = wrapField(text, width - 2);
  const footer = [
    { text: 'Enter Save', onClick: commit },
    'Ctrl+U Clear',
    { text: 'ESC Cancel', onClick: () => nav.pop() },
  ];

  return (
    <Page title={p.title} footer={footer}>
      {field.map((l, i) => (
        <Line at={at} class="wc-exp-field">
          <span class="wc-c-accent">{i === 0 ? '> ' : '  '}</span>
          <span class="wc-c-active">{l}</span>
          {i === field.length - 1 && <span class="wc-exp-caret">_</span>}
        </Line>
      ))}
      {p.mode === 'comment' ? (
        <>
          <Line at={at + width - 12}>
            <span class="wc-c-hint">{`${collapseComment(text).length} / ${COMMENT_MAX}`.padStart(12)}</span>
          </Line>
          <Blank />
          {collapseComment(text) ? (
            <>
              {commentLines(text).map((l) => (
                <Line at={at} class="wc-exp-preview">
                  <span class="wc-exp-comment">{l}</span>
                </Line>
              ))}
              <Line at={at} class="wc-exp-hold">
                <span class="wc-c-hint">{holdText(commentHoldMs(text))}</span>
              </Line>
            </>
          ) : (
            <Line at={at}>
              <span class="wc-c-hint">
                {p.title.startsWith('Edit') ? 'An empty comment is deleted.' : 'Type the comment.'}
              </span>
            </Line>
          )}
        </>
      ) : (
        <>
          <Blank />
          <Line at={at} class="wc-exp-file">
            <span class="wc-c-hint">{text.trim() ? 'File: ' : 'Empty: the default title.'}</span>
            {text.trim() && <span class="wc-c-body">{`${text.replace(/\s+/g, ' ').trim()}.${p.ext ?? 'html'}`}</span>}
          </Line>
        </>
      )}
    </Page>
  );
}

/** The field's text wrapped at `width` cells, keeping spaces (the caret follows the last row). */
function wrapField(text: string, width: number): string[] {
  if (text === '') return [''];
  const w = Math.max(1, width - 1);
  const rows = wrapText(text, w);
  if (/\s$/.test(text) && rows.length > 0) rows[rows.length - 1] += ' ';
  return rows.length ? rows : [''];
}
