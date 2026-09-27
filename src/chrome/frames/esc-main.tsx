// ESC menu main frame (Inv §4.2, §4.3) and Exit confirm (§4.6, no rating
// until stage 6).
//
//   Profile: default  ·  Link: 38ms  ·  capture: recording     (C_HINT)
//   banner (6 Hz, dropped when short)
//   Continue (connected) · Reconnect · Profile · Options · Exit session
//   flash row
//   ↑↓ Navigate · Enter Select · ESC Close

import type { VNode } from 'preact';
import { type AppStatusState, type AppStatusView, formatLink, isLive } from '../../app/status';
import { Banner } from '../banner';
import { BANNER_H, bannerFits } from '../banner-data';
import { useGrid, useServices, useSettings, useStatus } from '../kit/hooks';
import { cellLen, centreLeft } from '../kit/nav';
import { useIsTop, useKeys, useNav } from '../kit/stack';
import { Blank, Centered, FlashRow, Footer, type MenuItem, MenuRows, Page, indent, menuKey, useMenuCursor } from '../kit/widgets';
import { OptionsHub } from './options';
import { type ApplyResult, editProfile } from './profile-edit';

export interface EscActions {
  status: AppStatusView;
  /** Close the menu (Continue, ESC). */
  close: () => void;
  /** Reconnect and close. */
  reconnect: () => void;
  /** End the session and return to the start page. */
  exit: () => void;
  /**
   * The live profile apply (Inv §4.5), when the running app offers one.
   * Null: Apply in the editor only saves; the profile loads on the next
   * connect.
   */
  liveApply?: () => ((text: string) => ApplyResult) | null;
}

export interface EscMainProps extends EscActions {
  /** Row the cursor starts on. */
  preselect: 'continue' | 'reconnect';
}

/** Link colour (Inv §4.3): unknown → C_ERR, suspect → C_YELLOW, else C_HINT. */
export function linkClass(s: Readonly<AppStatusState>): string {
  if (s.linkMs === null) return 'wc-c-err';
  return s.linkSuspect ? 'wc-c-yellow' : 'wc-c-hint';
}

/** The status header parts: `Profile: x`, `Link: 38ms`, capture text. */
export function headerParts(profile: string, s: Readonly<AppStatusState>): { text: string; cls: string }[] {
  const parts = [
    { text: `Profile: ${profile}`, cls: 'wc-c-hint' },
    { text: formatLink(s.linkMs, s.linkSuspect), cls: linkClass(s) },
  ];
  if (s.capture) parts.push({ text: s.capture, cls: 'wc-c-hint' });
  return parts;
}

export function EscMain(p: EscMainProps): VNode {
  const nav = useNav();
  const isTop = useIsTop();
  const { cols, rows } = useGrid();
  const st = useStatus(p.status);
  const settings = useSettings();
  const { profiles } = useServices();
  const connected = isLive(st);

  const items: MenuItem[] = [
    ...(connected ? [{ key: 'continue', label: 'Continue', activate: p.close }] : []),
    { key: 'reconnect', label: 'Reconnect', activate: p.reconnect },
    {
      key: 'profile',
      label: 'Profile',
      activate: () =>
        void editProfile(nav, profiles, settings.profile, {
          isLive: () => isLive(p.status.get()),
          apply: p.liveApply?.() ?? undefined,
        }),
    },
    { key: 'options', label: 'Options', activate: () => nav.push(<OptionsHub />) },
    { key: 'exit', label: 'Exit session', activate: () => nav.push(<ExitConfirm exit={p.exit} />) },
  ];
  const [cursor, setCursor] = useMenuCursor(items, p.preselect);
  useKeys((_e, nk) => menuKey(items, cursor, setCursor, nk));

  const parts = headerParts(settings.profile, st);
  const sep = '  ·  ';
  const headerW = cellLen(parts.map((x) => x.text).join(sep));
  // header, blank, menu, flash, footer.
  const reserved = 2 + items.length + 1 + 1;
  const showBanner = bannerFits(rows, reserved);
  const used = 1 + (showBanner ? BANNER_H + 2 : 1) + items.length + 1;

  return (
    <div class="wc-page wc-esc-main">
      <div class="wc-line wc-esc-header" style={indent(centreLeft(cols, headerW))}>
        {parts.map((x, i) => (
          <>
            {i > 0 && <span class="wc-c-hint">{sep}</span>}
            <span class={x.cls}>{x.text}</span>
          </>
        ))}
      </div>
      {showBanner ? (
        <>
          <Blank />
          <Banner hz={6} run={isTop} />
          <Blank />
        </>
      ) : (
        <Blank />
      )}
      <MenuRows items={items} cursor={cursor} setCursor={setCursor} />
      <FlashRow />
      <Blank n={Math.max(0, rows - used - 1)} />
      <Footer tokens={['↑↓ Navigate', 'Enter Select', 'ESC Close']} />
    </div>
  );
}

function ExitConfirm(p: { exit: () => void }): VNode {
  const nav = useNav();
  useKeys((e) => {
    if ((e.key === 'y' || e.key === 'Y') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      p.exit();
      return true;
    }
    return false;
  });
  return (
    <Page
      title="Exit session"
      footer={[
        { text: 'Y Exit', onClick: p.exit },
        { text: 'ESC Cancel', onClick: () => nav.pop() },
      ]}
    >
      <Blank />
      <Centered text="Attention! This terminates the current session." class="wc-c-err" />
    </Page>
  );
}
