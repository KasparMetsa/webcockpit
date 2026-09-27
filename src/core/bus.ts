// Ordered, synchronous event bus (spec §1.2 layer 4).
//
// - Handlers run in subscription order, synchronously inside `emit`.
// - A throwing handler is reported with console.error; the rest still run.
// - No handler can stop propagation or change what others receive.
// - Hot path: `emit` allocates nothing. Subscribing or unsubscribing
//   replaces the handler array (copy-on-write), so an emit in progress keeps
//   iterating its own stable array.
// - A handler added during an emit is not called for that emit. A handler
//   removed during an emit is not called again, even in that emit.

import type { BusEventType, BusEvents, BusHandler } from './types';

interface Entry {
  fn: (payload: never) => void;
  active: boolean;
}

export class Bus {
  private readonly handlers = new Map<BusEventType, Entry[]>();

  /** Subscribes `handler` to `type`. Returns an idempotent unsubscribe. */
  on<K extends BusEventType>(type: K, handler: BusHandler<K>): () => void {
    const entry: Entry = { fn: handler as (payload: never) => void, active: true };
    const list = this.handlers.get(type);
    this.handlers.set(type, list ? [...list, entry] : [entry]);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const cur = this.handlers.get(type);
      if (!cur) return;
      const next = cur.filter((e) => e !== entry);
      if (next.length) this.handlers.set(type, next);
      else this.handlers.delete(type);
    };
  }

  /** Delivers `payload` to every handler of `type`, in order. */
  emit<K extends BusEventType>(type: K, payload: BusEvents[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (!e.active) continue;
      try {
        (e.fn as BusHandler<K>)(payload);
      } catch (err) {
        console.error(`[bus] handler for '${type}' threw`, err);
      }
    }
  }

  /** Number of handlers for `type` (for tests and diagnostics). */
  count(type: BusEventType): number {
    return this.handlers.get(type)?.length ?? 0;
  }
}
