// Blinds tracker (Inv §2.6.8): who we (or anyone) blinded, 90 s each.
//
//   `<name> seems to be blinded!`  always a bar; a leading `A `/`An ` is
//                                   stripped (`Anaru` stays). A blindness
//                                   cast at the queue front gives its typed
//                                   numeric prefix: `2.orc`.
//   `Your victim is already blind.` drops the queue front
//   expiry                          fixed 90 s, no drop line, `down` when
//                                   pruned (checked every 2 s)
//
// Saved: every bar (survives a reload minus the time passed).

import type { CastQueue } from './castq';
import type { TimerCell } from './entry';
import type { LineRouter } from './lines';
import type { Tracker, TrackerHost } from './tracker';

export const BLIND_MS = 90_000;
export const BLINDS_PRUNE_MS = 2_000;
export const BLIND_SUFFIX = ' seems to be blinded!';
export const BLIND_ALREADY = 'Your victim is already blind.';

interface Blind {
  id: number;
  name: string;
  startedAt: number;
  expiresAt: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `A orc` / `An orc` → `orc`; `Anaru` stays. */
export function stripBlindArticle(name: string): string {
  return name.replace(/^An?\s+/, '');
}

export class BlindsTracker implements Tracker {
  readonly key = 'blinds';
  private readonly host: TrackerHost;
  private readonly casts: CastQueue;
  private list: Blind[] = [];
  private nextId = 1;
  private lastPrune = -Infinity;

  constructor(host: TrackerHost, casts: CastQueue) {
    this.host = host;
    this.casts = casts;
  }

  route(router: LineRouter): void {
    router.onSuffix(BLIND_SUFFIX, (text) => this.blinded(text.slice(0, -BLIND_SUFFIX.length), this.host.now()));
    router.onLine(BLIND_ALREADY, () => this.casts.failFront(this.host.now()));
  }

  private blinded(raw: string, now: number): void {
    const bare = stripBlindArticle(raw.trim());
    if (!bare) return;
    const q = this.casts.popIfFrontKind('blindness', now);
    const name = (q?.prefix ?? '') + bare;
    this.list.push({ id: this.nextId++, name, startedAt: now, expiresAt: now + BLIND_MS });
    this.host.changed();
    this.host.announce('BLIND', name, 'up');
  }

  tick(now: number): void {
    if (now - this.lastPrune < BLINDS_PRUNE_MS) return;
    this.lastPrune = now;
    const gone = this.list.filter((b) => b.expiresAt <= now);
    if (gone.length === 0) return;
    this.list = this.list.filter((b) => b.expiresAt > now);
    this.host.changed();
    for (const b of gone) this.host.announce('BLIND', b.name, 'down');
  }

  cells(): TimerCell[] {
    return this.list.map((b) => ({
      id: `blind:${b.id}`,
      name: b.name,
      group: 'blind' as const,
      startedAt: b.startedAt,
      expiresAt: b.expiresAt,
      expected: BLIND_MS,
      tracked: true,
    }));
  }

  serialize(): unknown {
    return this.list.map((b) => ({ name: b.name, startedAt: b.startedAt, expiresAt: b.expiresAt }));
  }

  restore(saved: unknown, now: number): void {
    if (!Array.isArray(saved)) return;
    const restored: Blind[] = [];
    for (const raw of saved as Array<Record<string, unknown>>) {
      if (!raw || typeof raw.name !== 'string' || !isNum(raw.startedAt) || !isNum(raw.expiresAt)) continue;
      if (raw.expiresAt <= now) continue;
      restored.push({ id: this.nextId++, name: raw.name, startedAt: raw.startedAt, expiresAt: raw.expiresAt });
    }
    this.list = [...restored, ...this.list];
  }

  reset(): void {
    this.list = [];
    this.lastPrune = -Infinity;
  }
}
