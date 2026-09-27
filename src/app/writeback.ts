// Runtime variable write-back (ADR 0015 "Live profile and write-back",
// owner decision 2026-09-27).
//
// When a script sets a variable, the new value is queued for the profile
// that is loaded. A flush (debounced, and forced on `pagehide` and on
// disconnect) reads the latest stored text of that profile, rewrites only
// the values of variables that have a top-level `#variable` entry there
// (`setVariable`, P1), and saves when the text changed. Variables that
// are not in the profile, and every other runtime change, stay in the
// session. Nothing is written until a profile has loaded completely
// (`target` is null before that: the "has loaded" guard, Inv §5.9).

import type { ProfileStore } from '../profiles';
import { parseProfile, serialize, setVariable } from '../script/doc';

export const WRITE_BACK_DELAY_MS = 1000;

export interface WriteBackOptions {
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  onError?: (message: string) => void;
}

export class VariableWriteBack {
  private targetName: string | null = null;
  private pending = new Map<string, string>();
  private timer: unknown = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(
    private readonly store: ProfileStore,
    private readonly opts: WriteBackOptions = {},
  ) {
    this.delayMs = opts.delayMs ?? WRITE_BACK_DELAY_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** The profile values are written to (null: none loaded, nothing is written). */
  get target(): string | null {
    return this.targetName;
  }

  /** Switches the target profile; values queued for the old one are flushed first. */
  setTarget(name: string | null): Promise<void> {
    const done = this.flush();
    this.targetName = name;
    return done;
  }

  /** Queues `name = value` for the target profile. */
  queue(name: string, value: string): void {
    if (this.targetName === null) return;
    this.pending.set(name, value);
    if (this.timer === null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        void this.flush();
      }, this.delayMs);
    }
  }

  /** Writes what is queued now. Resolves when the save is done. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0 || this.targetName === null) {
      this.pending.clear();
      return this.chain;
    }
    const name = this.targetName;
    const values = this.pending;
    this.pending = new Map();
    this.chain = this.chain.then(() => this.write(name, values));
    return this.chain;
  }

  private async write(name: string, values: Map<string, string>): Promise<void> {
    try {
      const rec = await this.store.get(name);
      if (!rec) return;
      let doc = parseProfile(rec.text);
      for (const [k, v] of values) doc = setVariable(doc, k, v);
      const text = serialize(doc);
      if (text !== rec.text) await this.store.save(name, text);
    } catch (err) {
      this.opts.onError?.(`Could not save variables to profile ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
