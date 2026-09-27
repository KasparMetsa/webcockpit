// Options → Panes → Communication (Inv §2.7.6, Cockpit ADR 0129): the ten
// fixed channels as `[X]███ Narrates` rows (checkbox, a swatch in the
// channel colour, grey when off, the label), then `[X] Show channel header`
// and Back. Every change goes to the settings store at once, so the Comm
// pane follows live (ADR 0010); a filter change here cancels the pane's solo.

import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { COMM_CHANNEL_ORDER, DEFAULT_CAPTIONS, channelColor, channelEnabled, channelLabel } from '../../gmcp/comm';
import { useGrid, useServices, useSettings } from '../kit/hooks';
import { centreLeft } from '../kit/nav';
import { useKeys, useNav } from '../kit/stack';
import { Blank, CheckCell, Line, type MenuItem, MenuRows, Page } from '../kit/widgets';

const LABEL_W = 10;
/** `[X]███ ` + label. */
const ROW_W = 7 + LABEL_W;

export function CommOptionsFrame(): VNode {
  const { settings } = useServices();
  const s = useSettings();
  const nav = useNav();
  const { cols } = useGrid();
  const n = COMM_CHANNEL_ORDER.length;
  // Rows 0..n-1: channels; n: show header; n+1: Back.
  const ROWS = n + 2;
  const [row, setRow] = useState(0);
  const filters = s.comm.filters;

  const toggleChannel = (name: string): void => {
    const on = channelEnabled(settings.get().comm.filters, name);
    settings.update((d) => {
      if (on) d.comm.filters[name] = false;
      else delete d.comm.filters[name];
    });
  };
  const toggleHeader = (): void => settings.update((d) => void (d.comm.showHeader = !d.comm.showHeader));
  const back: MenuItem[] = [{ key: 'back', label: 'Back', activate: () => nav.pop() }];

  const activate = (r: number): void => {
    if (r < n) toggleChannel(COMM_CHANNEL_ORDER[r]!);
    else if (r === n) toggleHeader();
    else nav.pop();
  };

  useKeys((_e, nk) => {
    switch (nk) {
      case 'up':
      case 'backtab':
        setRow((row + ROWS - 1) % ROWS);
        return true;
      case 'down':
      case 'tab':
        setRow((row + 1) % ROWS);
        return true;
      case 'home':
        setRow(0);
        return true;
      case 'end':
        setRow(ROWS - 1);
        return true;
      case 'activate':
        activate(row);
        return true;
    }
    return false;
  });

  const at = centreLeft(cols, Math.max(ROW_W, '[X] Show channel header'.length));
  return (
    <Page title="Communication" footer={['↑↓ Navigate', 'Enter Toggle', 'ESC Back']}>
      {COMM_CHANNEL_ORDER.map((name, r) => {
        const on = channelEnabled(filters, name);
        const label = channelLabel({ name, caption: DEFAULT_CAPTIONS[name] ?? '' });
        return (
          <Line at={at} class="wc-grid-row">
            <CheckCell
              checked={on}
              cursor={row === r}
              swatch={on ? channelColor(name) : 'var(--c-off)'}
              title={`${label}: ${on ? 'on' : 'off'}`}
              onHover={() => setRow(r)}
              onClick={() => {
                setRow(r);
                toggleChannel(name);
              }}
            />{' '}
            <span
              class={row === r ? 'wc-c-active' : on ? 'wc-c-item' : 'wc-c-off'}
              data-channel={name}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setRow(r)}
              onClick={() => {
                setRow(r);
                toggleChannel(name);
              }}
            >
              {label}
            </span>
          </Line>
        );
      })}
      <Blank />
      <Line at={at} class="wc-grid-row">
        <CheckCell
          checked={s.comm.showHeader}
          cursor={row === n}
          title="Show channel header"
          onHover={() => setRow(n)}
          onClick={() => {
            setRow(n);
            toggleHeader();
          }}
        />{' '}
        <span
          class={row === n ? 'wc-c-active' : 'wc-c-item'}
          data-key="show-header"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setRow(n)}
          onClick={() => {
            setRow(n);
            toggleHeader();
          }}
        >
          Show channel header
        </span>
      </Line>
      <Blank />
      <MenuRows items={back} cursor={row === n + 1 ? 0 : -1} setCursor={() => setRow(n + 1)} hoverMoves />
    </Page>
  );
}
