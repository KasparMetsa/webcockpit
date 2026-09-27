import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bus } from '../../src/core/bus';
import type { BusEvents } from '../../src/core/types';
import { ReplaySocket, isPromptLike, logToFrames } from '../../src/net/replay-socket';
import { Session } from '../../src/net/session';
import { Telnet } from '../../src/net/telnet';
import { RecSink } from './net-helpers';

const E = '\x1b';
const LOG = [
  '1790449245424814 > who',
  '1790449245596613 Allies',
  '1790449245597195       Rasta Fari',
  '1790449245599624 7 allies on.',
  '1790449245600201 oO>',
  '1790449246198284 > arm',
  '1790449246341032 [cast n \'armour\']',
  `1790449247842113 ${E}[35mA blue transparent wall slowly appears around you.${E}[0m`,
  '1790449247842391 oO Mana:Hot>',
  '1790449249592919 Xaark narrates \'åäö\'',
  '1790449259592919 ',
  '1790449259592920 > ',
  '',
].join('\n');

function decode(frames: { bytes: Uint8Array }[]): string {
  const sink = new RecSink();
  const t = new Telnet({ sink, write: () => {} });
  t.forceUtf8();
  for (const f of frames) t.receive(f.bytes, 0);
  return sink.out;
}

describe('isPromptLike', () => {
  it('detects prompts', () => {
    expect(isPromptLike('oO Mana:Hot>')).toBe(true);
    expect(isPromptLike('>')).toBe(true);
    expect(isPromptLike(`${E}[31m![ HP:Fine>${E}[0m`)).toBe(true);
    expect(isPromptLike('<worn on head>       a twisted crown')).toBe(false);
    expect(isPromptLike('x'.repeat(90) + '>')).toBe(false);
    expect(isPromptLike('')).toBe(false);
  });
});

describe('logToFrames', () => {
  it('skips outbound lines and marks prompts with GA', () => {
    const frames = [...logToFrames(LOG, { speed: 0 })];
    expect(frames.length).toBe(1);
    expect(decode(frames)).toBe(
      'Allies\r\n      Rasta Fari\r\n7 allies on.\r\noO>⟨GA⟩[cast n \'armour\']\r\n' +
        `${E}[35mA blue transparent wall slowly appears around you.${E}[0m\r\noO Mana:Hot>⟨GA⟩` +
        'Xaark narrates \'åäö\'\r\n\r\n',
    );
  });

  it('groups lines by time and caps long gaps at real speed', () => {
    const frames = [...logToFrames(LOG, { speed: 1 })];
    // Allies..oO> are within 1 ms of each other except the first gap.
    expect(frames[0]!.atMs).toBe(0);
    const times = frames.map((f) => f.atMs);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
    // The 10 s gap before the last line is capped at 2 s.
    const total = times.at(-1)!;
    const uncapped = (1790449259592919 - 1790449245596613) / 1000;
    expect(total).toBeLessThan(uncapped - 7000);
    expect(decode(frames)).toBe(decode([...logToFrames(LOG, { speed: 0 })]));
  });

  it('scales time by speed', () => {
    const a = [...logToFrames(LOG, { speed: 1 })].at(-1)!.atMs;
    const b = [...logToFrames(LOG, { speed: 4 })].at(-1)!.atMs;
    expect(b).toBeCloseTo(a / 4, 5);
  });

  it('splits into chunks of about chunkBytes at speed 0', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `17904492456${String(i).padStart(5, '0')} line ${i} ${'x'.repeat(40)}`).join('\n');
    const frames = [...logToFrames(big, { speed: 0, chunkBytes: 16384 })];
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames.slice(0, -1)) expect(f.bytes.length).toBeLessThan(16384 + 200);
    expect(decode(frames).split('\r\n').length).toBe(5001);
  });

  it('ignores malformed lines and CRLF line endings', () => {
    const frames = [...logToFrames('garbage\r\n1790449245596613 ok\r\n12 short\n', { speed: 0 })];
    expect(decode(frames)).toBe('ok\r\n');
  });
});

describe('ReplaySocket through Session', () => {
  it('replays to the sink, reaches playing with charName, and finishes', async () => {
    const bus = new Bus();
    const sink = new RecSink();
    const states: BusEvents['conn.state'][] = [];
    bus.on('conn.state', (p) => states.push(p));
    const s = new Session({ bus, sink });
    const done = new Promise<void>((res) => bus.on('conn.state', (p) => p.state === 'disconnected' && res()));
    s.connect(new ReplaySocket(LOG, { speed: 0, charName: 'Rasta' }));
    await done;
    expect(states.map((x) => x.state)).toEqual(['connecting', 'login', 'playing', 'disconnected']);
    expect(states.at(-1)!.reason).toBe('replay finished');
    expect(sink.out).toContain('Xaark narrates \'åäö\'');
    expect(sink.gas).toBe(2);
  });

  it('stops on close()', async () => {
    const bus = new Bus();
    const s = new Session({ bus, sink: new RecSink() });
    const sock = new ReplaySocket(LOG, { speed: 1 });
    const reasons: string[] = [];
    bus.on('conn.state', (p) => p.reason && reasons.push(p.reason));
    s.connect(sock);
    await new Promise((r) => setTimeout(r, 5));
    s.disconnect();
    expect(s.state).toBe('disconnected');
    expect(reasons).toEqual(['disconnected by user']);
  });
});

// Real Cockpit logs (ADR 0007): skipped when the fixtures are missing.
const FIXTURES = process.env.WEBCOCKPIT_FIXTURES ?? '/home/ole/MUME/data/runs';
function findLog(): string | null {
  if (!existsSync(FIXTURES)) return null;
  for (const d of readdirSync(FIXTURES)) {
    const dir = join(FIXTURES, d);
    if (!statSync(dir).isDirectory()) continue;
    const f = readdirSync(dir).find((x) => x.endsWith('.log'));
    if (f) return join(dir, f);
  }
  return null;
}
const realLog = findLog();

describe.skipIf(!realLog)('real Cockpit log', () => {
  it('round-trips every inbound line through the telnet layer', () => {
    const text = readFileSync(realLog!, 'utf8');
    const out = decode([...logToFrames(text, { speed: 0 })]);
    const inbound = text
      .split('\n')
      .filter((l) => /^\d{16} /.test(l) && !l.slice(17).startsWith('> '))
      .map((l) => l.slice(17));
    const got = out.replace(/⟨GA⟩/g, '\r\n').split('\r\n');
    expect(got.slice(0, inbound.length)).toEqual(inbound);
  });
});
