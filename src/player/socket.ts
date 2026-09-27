// A replay socket the log player pushes (ADR 0018): no timing of its own.
// The engine (src/player/engine.ts) decides what is delivered when and
// calls `data`, `sent` and `end`; one socket per run of the chain, so the
// session passes through `disconnected` between runs as it did live.
//
// `connect()` opens at once (Session has already emitted `connecting`), so
// the session is in `login` when the engine delivers the first bytes.

import type { Socketish } from '../core/types';
import type { IsReplay } from '../net/session';

/** Reason given when a run's log is exhausted (the replay socket's wording). */
export const REASON_RUN_END = 'replay finished';

export class PlayerSocket implements Socketish, IsReplay {
  onOpen: (() => void) | null = null;
  onData: ((bytes: Uint8Array) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  onSent: ((text: string) => void) | null = null;

  readonly forceUtf8 = true as const;
  readonly replay = true as const;

  private state: 'new' | 'open' | 'closed' = 'new';

  get isOpen(): boolean {
    return this.state === 'open';
  }

  connect(): void {
    if (this.state !== 'new') return;
    this.state = 'open';
    this.onOpen?.();
  }

  send(_bytes: Uint8Array): void {
    // Nothing is sent from a replay.
  }

  close(): void {
    this.state = 'closed';
  }

  /** Delivers inbound telnet bytes. */
  data(bytes: Uint8Array): void {
    if (this.state === 'open' && bytes.length > 0) this.onData?.(bytes);
  }

  /** A recorded outbound command (`''` = empty Enter). */
  sent(text: string): void {
    if (this.state === 'open') this.onSent?.(text);
  }

  /** The run's log ended: the connection closes. */
  end(reason = REASON_RUN_END): void {
    if (this.state !== 'open') return;
    this.state = 'closed';
    this.onClose?.(reason);
  }
}
