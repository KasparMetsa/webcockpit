import { describe, expect, it } from 'vitest';
import { attachUiMessages, uiMsg, uiParts, uiValue } from '../../src/app/ui-messages';
import { Bus } from '../../src/core/bus';
import type { ConnState, UiMessage } from '../../src/core/types';
import { REASON_USER_RECONNECT } from '../../src/net/session';
import { uiPlain } from '../../src/panes/ui';

function env() {
  const bus = new Bus();
  const got: UiMessage[] = [];
  bus.on('ui.message', (m) => got.push(m));
  attachUiMessages(bus);
  let prev: ConnState = 'idle';
  const state = (s: ConnState, extra: { reason?: string; replay?: true } = {}) => {
    bus.emit('conn.state', { state: s, prev, ...extra });
    prev = s;
  };
  return { bus, got, state, lines: () => got.map(uiPlain) };
}

describe('uiMsg', () => {
  it('turns {x} into value parts', () => {
    expect(uiParts('{Rasta} logged in.')).toEqual([{ value: 'Rasta' }, ' logged in.']);
    expect(uiParts('a {1} b {2}.')).toEqual(['a ', { value: '1' }, ' b ', { value: '2' }, '.']);
    expect(uiMsg('event', 'Unlocked.', 'ACHIEVEMENT')).toEqual({ kind: 'event', name: 'ACHIEVEMENT', parts: ['Unlocked.'] });
    expect(uiValue('a{b}')).toBe('ab');
  });
});

describe('attachUiMessages', () => {
  it('connect, login, logout, close', () => {
    const e = env();
    e.state('connecting');
    e.state('login');
    e.bus.emit('gmcp', { pkg: 'Char.Name', data: { name: 'Rasta' } });
    e.state('playing');
    e.state('disconnected', { reason: 'Core.Goodbye' });
    expect(e.lines()).toEqual([
      '● SYSTEM: Connecting to MUME...',
      '● SYSTEM: Rasta logged in.',
      '● SYSTEM: Rasta logged out.',
      '● SYSTEM: Connection to MUME closed.',
    ]);
    expect(e.got[1]!.parts).toEqual([{ value: 'Rasta' }, ' logged in.']);
  });

  it('reconnect, connect failure, replay, achievement', () => {
    const e = env();
    e.state('connecting');
    e.state('login');
    e.state('disconnected', { reason: REASON_USER_RECONNECT });
    e.state('connecting');
    e.state('disconnected', { reason: 'socket error' });
    e.state('connecting', { replay: true });
    e.state('login', { replay: true });
    e.bus.emit('gmcp', { pkg: 'Char.Name', data: { name: 'Rasta' } });
    e.state('playing', { replay: true });
    e.bus.emit('gmcp', { pkg: 'Event.Achieved', data: { what: 'x' } });
    e.state('disconnected', { reason: 'replay finished', replay: true });
    expect(e.lines()).toEqual([
      '● SYSTEM: Connecting to MUME...',
      '● SYSTEM: Connection to MUME closed.',
      '● SYSTEM: Reconnecting to MUME...',
      '✖ ERROR: Could not connect to MUME.',
      '● SYSTEM: Replay started.',
      '● SYSTEM: Rasta logged in.',
      '▶ ACHIEVEMENT: Unlocked.',
      '● SYSTEM: Rasta logged out.',
      '● SYSTEM: Replay finished.',
    ]);
    for (const l of e.lines()) expect(l.endsWith('.')).toBe(true);
  });
});
