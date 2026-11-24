/**
 * Ring buffer of domain events ("orb.collected", "player.landed"). Tests and `bun run see` read
 * them to learn what happened without looking at pixels.
 *
 * Define a game's events as a union and the log is typed:
 *   type Events = { type: 'coin.collected'; total: number } | { type: 'player.died' };
 *   const events = new EventLog<Events>();
 */
export interface BaseEvent {
  type: string;
}

export type Stamped<E extends BaseEvent> = E & { tick: number; seq: number };

export interface Drained<E extends BaseEvent> {
  events: Stamped<E>[];
  /** Pass back to the next drain() call. */
  cursor: number;
  /** Events that were overwritten before they could be read. Any non-zero value fails a test run. */
  dropped: number;
}

/** The write side of an EventLog. Logic takes this so the engine can share one log for all events. */
export interface EventSink<E extends BaseEvent> {
  emit(event: E): void;
}

export class EventLog<E extends BaseEvent = BaseEvent> implements EventSink<E> {
  private readonly buffer: Stamped<E>[] = [];
  private seq = 0;
  /** Set by the game loop each tick so events are stamped with the tick they happened on. */
  tick = 0;

  private readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  emit(event: E): void {
    this.buffer.push({ ...event, tick: this.tick, seq: this.seq++ });
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  /** Events since `cursor` (a seq number), plus how many were lost to the ring buffer. */
  drain(cursor = 0): Drained<E> {
    const oldest = this.buffer[0]?.seq ?? this.seq;
    const events = this.buffer.filter((e) => e.seq >= cursor);
    return { events, cursor: this.seq, dropped: Math.max(0, oldest - cursor) };
  }

  /** Everything still in the buffer. */
  all(): Stamped<E>[] {
    return [...this.buffer];
  }
}
