// About (Inv §3.11): our own text, word-wrapped, scrollable. The version
// is right-aligned on the title row. Colour rule per line: an ALL-CAPS
// line is a heading (C_TITLE); an indented line is `  key  description`
// (key in C_ACCENT, description in C_BODY); other text is C_BODY.

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useGrid, useServices } from '../kit/hooks';
import { centreLeft, scrollbar, wrapText } from '../kit/nav';
import { useKeys } from '../kit/stack';
import { Line, Page, useBodyRows } from '../kit/widgets';

export const ABOUT_TEXT = `WebCockpit is a MUD client for MUME that runs in your browser. It connects straight to MUME, keeps nothing on a server, and aims to look and feel like Cockpit, the terminal client it is modelled on.

GETTING STARTED
Choose Enter MUME on the start page. Profile picks the set of aliases, actions and macros you play with. Options sets up the panes and the look; every change applies at once.

KEYS
  ESC             open the menu (first leaves scrollback)
  PageUp/Down     scroll the game output
  Up/Down         command history
  Enter           send; when disconnected, reconnect
  Ctrl+W          delete the word before the cursor

COMMANDS
  #help           list the built-in commands
  #connect        connect to MUME
  #disconnect     close the connection
  #reconnect      close and connect again
  #runlog         download the current run as a .log
  #replay         replay a Cockpit .log file

SETTINGS
Settings and profiles are kept in this browser only. Use Profile → EXPORT to keep a copy of a profile. If a setting makes the page unusable, open the link with ?safe added to start with the default look.

LICENCE
WebCockpit is free software under the GNU General Public License, version 3 or later. MUME is run by its own team; WebCockpit is an independent client.`;

interface Styled {
  key?: string;
  text: string;
  cls: string;
}

/** The About text as styled, wrapped lines for a width. */
export function aboutLines(width: number): Styled[] {
  const out: Styled[] = [];
  for (const raw of ABOUT_TEXT.split('\n')) {
    if (raw === '') out.push({ text: '', cls: '' });
    else if (/^[A-Z][A-Z ]+$/.test(raw)) out.push({ text: raw, cls: 'wc-c-title' });
    else if (raw.startsWith('  ')) {
      const m = /^ {2}(\S+(?: \S+)*?) {2,}(.*)$/.exec(raw);
      if (!m) out.push({ text: raw, cls: 'wc-c-body' });
      else {
        const keyW = raw.length - m[2]!.length;
        const desc = wrapText(m[2]!, Math.max(10, width - keyW));
        desc.forEach((d, i) =>
          out.push({ key: i === 0 ? raw.slice(0, keyW) : ' '.repeat(keyW), text: d, cls: 'wc-c-body' }),
        );
      }
    } else for (const l of wrapText(raw, width)) out.push({ text: l, cls: 'wc-c-body' });
  }
  return out;
}

export function AboutFrame(): VNode {
  const { version } = useServices();
  const { cols } = useGrid();
  const visible = useBodyRows();
  const width = Math.max(20, Math.min(cols - 4, 76));
  const lines = aboutLines(width);
  const [top, setTop] = useState(0);
  const max = Math.max(0, lines.length - visible);
  const t = Math.min(top, max);
  const scroll = (d: number): void => setTop(Math.max(0, Math.min(max, t + d)));
  useKeys((_e, nk) => {
    switch (nk) {
      case 'up':
        scroll(-1);
        return true;
      case 'down':
        scroll(1);
        return true;
      case 'pgup':
        scroll(-(visible - 1));
        return true;
      case 'pgdn':
      case 'activate':
        scroll(visible - 1);
        return true;
      case 'home':
        setTop(0);
        return true;
      case 'end':
        setTop(max);
        return true;
    }
    return false;
  });
  const bar = scrollbar(lines.length, visible, t);
  const at = centreLeft(cols, width + 2);
  return (
    <Page title="About" titleRight={version} footer={['↑↓ Scroll', 'PgUp/PgDn Page', 'ESC Back']}>
      <div
        class="wc-about"
        onWheel={(e) => {
          e.preventDefault();
          scroll(e.deltaY > 0 ? 3 : -3);
        }}
      >
        {lines.slice(t, t + visible).map((l, i) => (
          <Line at={at}>
            {l.key !== undefined && <span class="wc-c-accent">{l.key}</span>}
            <span class={l.cls}>{l.text.padEnd(width - (l.key?.length ?? 0))}</span>
            {bar.length > 0 && <span class={bar[i] ? 'wc-scroll-thumb' : 'wc-scroll-track'}>{' ' + (bar[i] ? '█' : '░')}</span>}
          </Line>
        ))}
      </div>
    </Page>
  );
}
