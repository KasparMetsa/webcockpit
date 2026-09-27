// Charm tracker (Inv §2.6.9): charmed followers, counting up to a 99 min cap.
//
//   `<name> starts following you.` / `Your control on <name> is renewed!`
//        a new charm, only when a charm cast in flight is at the queue
//        front (the follow line is ambiguous: mercenaries, pets, group
//        members). `a `/`an `/`the ` stripped, any case.
//   `<name> seems to be ruled by powers other than yours...`
//        resisted: the queue front is dropped
//   in flight: `You start to concentrate...`, `You muster …`, a recall
//   controlled without a charm (same follow line, no cast, no queue):
//        enslaved shadow   permanent (only × removes it)
//        wood elf          timed 99 min; leaves on its own line
//        dreadful warg     permanent; replaces the oldest enslaved shadow
//   cap  99 min, checked every 2 s (`down`); × = `dropCharm(id)` (`down`)
//
// Ids are monotonic and never reused; a restore moves the counter past the
// highest saved id. The follow line is its own action at priority 4, behind
// the other timers rules (ADR 0017 "Rules"). Saved: every entry.

import type { SystemRules } from '../gmcp/state';
import type { CastQueue } from './castq';
import type { TimerCell } from './entry';
import type { LineRouter } from './lines';
import type { Tracker, TrackerHost } from './tracker';

export const CHARM_CAP_MS = 99 * 60_000;
export const CHARMS_PRUNE_MS = 2_000;
export const CHARM_FOLLOW_PRIORITY = 4;
const RENEW_PREFIX = 'Your control on ';
const RENEW_SUFFIX = ' is renewed!';
export const CHARM_RESIST_SUFFIX = ' seems to be ruled by powers other than yours...';
export const WOOD_ELF_LEAVES = 'A wood elf leaves and vanishes into the distance.';

/** Mobs that follow without a charm: permanent (no timer) or timed. */
const CONTROLLED: Readonly<Record<string, { permanent: boolean; replaces?: string }>> = {
  'enslaved shadow': { permanent: true },
  'wood elf': { permanent: false },
  'dreadful warg': { permanent: true, replaces: 'enslaved shadow' },
};

interface Charm {
  id: number;
  name: string;
  startedAt: number;
  /** null = permanent. */
  expiresAt: number | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `A huge troll` / `the orc` / `an elf` → without the article; `Theoden` stays. */
export function stripCharmArticle(name: string): string {
  return name.replace(/^(an?|the)\s+/i, '');
}

export class CharmTracker implements Tracker {
  readonly key = 'charms';
  private readonly host: TrackerHost;
  private readonly casts: CastQueue;
  private list: Charm[] = [];
  private nextId = 1;
  private lastPrune = -Infinity;

  constructor(host: TrackerHost, casts: CastQueue) {
    this.host = host;
    this.casts = casts;
    casts.onStarted((now) => casts.markFrontInflight('charm', now));
    casts.onRecalled((now) => casts.markFrontInflight('charm', now));
  }

  route(router: LineRouter): void {
    router.onPrefix(RENEW_PREFIX, (text) => {
      if (text.endsWith(RENEW_SUFFIX)) this.followed(text.slice(RENEW_PREFIX.length, -RENEW_SUFFIX.length), this.host.now());
    });
    router.onSuffix(CHARM_RESIST_SUFFIX, () => this.casts.failFront(this.host.now()));
    router.onLine(WOOD_ELF_LEAVES, () => this.left('wood elf'));
  }

  installRules(system: SystemRules): void {
    system.define('action', '^%1 starts following you.$', '', {
      priority: CHARM_FOLLOW_PRIORITY,
      fn: (m) => this.followed(m.args[1] ?? '', this.host.now()),
    });
  }

  /** A follow (or renewed control) line with the mob's name as printed. */
  followed(raw: string, now: number): void {
    const name = stripCharmArticle(raw.trim());
    if (!name) return;
    const ctl = CONTROLLED[name.toLowerCase()];
    if (ctl) {
      if (ctl.replaces) this.removeOldest(ctl.replaces);
      this.add(name, now, ctl.permanent);
      return;
    }
    if (!this.casts.popIfFrontInflight('charm', now)) return;
    this.add(name, now, false);
  }

  private add(name: string, now: number, permanent: boolean): void {
    this.list.push({ id: this.nextId++, name, startedAt: now, expiresAt: permanent ? null : now + CHARM_CAP_MS });
    this.host.changed();
    this.host.announce('CHARM', name, 'up');
  }

  private removeOldest(lower: string): void {
    let pick = -1;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i]!;
      if (c.name.toLowerCase() === lower && (pick < 0 || c.startedAt < this.list[pick]!.startedAt)) pick = i;
    }
    if (pick < 0) return;
    const [c] = this.list.splice(pick, 1);
    this.host.changed();
    this.host.announce('CHARM', c!.name, 'down');
  }

  private left(lower: string): void {
    this.removeOldest(lower);
  }

  dropCharm(id: string): void {
    const i = this.list.findIndex((c) => `charm:${c.id}` === id);
    if (i < 0) return;
    const [c] = this.list.splice(i, 1);
    this.host.changed();
    this.host.announce('CHARM', c!.name, 'down');
  }

  tick(now: number): void {
    if (now - this.lastPrune < CHARMS_PRUNE_MS) return;
    this.lastPrune = now;
    const gone = this.list.filter((c) => c.expiresAt !== null && c.expiresAt <= now);
    if (gone.length === 0) return;
    this.list = this.list.filter((c) => !gone.includes(c));
    this.host.changed();
    for (const c of gone) this.host.announce('CHARM', c.name, 'down');
  }

  cells(): TimerCell[] {
    return this.list.map((c) => ({
      id: `charm:${c.id}`,
      name: c.name,
      group: 'charm' as const,
      startedAt: c.startedAt,
      expiresAt: c.expiresAt,
      expected: c.expiresAt === null ? null : CHARM_CAP_MS,
      tracked: true,
    }));
  }

  serialize(): unknown {
    return {
      nextId: this.nextId,
      list: this.list.map((c) => ({ id: c.id, name: c.name, startedAt: c.startedAt, expiresAt: c.expiresAt })),
    };
  }

  restore(saved: unknown, now: number): void {
    if (typeof saved !== 'object' || saved === null) return;
    const s = saved as { nextId?: unknown; list?: unknown };
    let maxId = isNum(s.nextId) ? Math.floor(s.nextId) - 1 : 0;
    const restored: Charm[] = [];
    if (Array.isArray(s.list)) {
      for (const raw of s.list as Array<Record<string, unknown>>) {
        if (!raw || typeof raw.name !== 'string' || !isNum(raw.startedAt) || !isNum(raw.id)) continue;
        const expiresAt = isNum(raw.expiresAt) ? raw.expiresAt : null;
        if (expiresAt !== null && expiresAt <= now) continue;
        maxId = Math.max(maxId, raw.id);
        restored.push({ id: Math.floor(raw.id), name: raw.name, startedAt: raw.startedAt, expiresAt });
      }
    }
    // Charms that landed while the record loaded keep theirs unless an id
    // collides; then they move past every saved one.
    const next = Math.max(this.nextId, maxId + 1);
    this.nextId = next;
    const taken = new Set(restored.map((c) => c.id));
    for (const c of this.list) if (taken.has(c.id)) c.id = this.nextId++;
    this.list = [...restored, ...this.list];
  }

  reset(): void {
    this.list = [];
    this.lastPrune = -Infinity;
  }
}
