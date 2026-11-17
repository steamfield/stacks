import { Clock, Effect, Option, Semaphore } from "effect";
import type { HostInfo } from "./host";
import { type Writer, write } from "./output-write";

/** The terminal facts the live line needs to fit on one row. */
export type LiveLayout = Pick<HostInfo, "columns" | "stringWidth">;

/** Clears the current terminal row: carriage return, then erase the whole line. */
const ERASE = "\r\u001b[2K";
const SPINNER = "|/-\\";

/** The spinner character for `elapsed` ms: a new one every 100 ms. */
function spinnerFrame(elapsed: number): string {
  return SPINNER[Math.floor(elapsed / 100) % 4] ?? "|";
}

/**
 * Fits `text` plus `tail` (the elapsed time) into one row, one column short of the width so the
 * cursor never wraps. The tail is dropped first when it alone doesn't fit, then `text` is cut at
 * a grapheme boundary and ends with an ellipsis. With no known width, nothing is cut.
 */
function fitLiveFrame(text: string, layout: LiveLayout | undefined, tail: string): string {
  if (!layout || Option.isNone(layout.columns)) return text + tail;
  const width = Math.max(0, layout.columns.value - 1);
  const suffix = layout.stringWidth(tail) <= width ? tail : "";
  if (layout.stringWidth(text + suffix) <= width) return text + suffix;
  let fitted = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    text,
  )) {
    if (layout.stringWidth(`${fitted}${segment}…${suffix}`) > width) break;
    fitted += segment;
  }
  return layout.stringWidth(`…${suffix}`) <= width ? `${fitted}…${suffix}` : suffix;
}

/**
 * The stderr side of Output: the live spinner line and the writes that must not interleave with
 * it. One lock serializes redraws and normal writes, so a frame can't split a row of other
 * output, and a write first erases a drawn frame. When the live line is disabled, `around` adds
 * nothing. `line` (for `progress` and `event`) and the frames are best-effort: the first failed
 * write closes them for good, and the command carries on.
 */
export function makeLive(stderr: Writer, enabled: boolean, layout?: LiveLayout) {
  const lock = Semaphore.makeUnsafe(1);
  let open = true;
  let active = false;
  const close = Effect.sync(() => {
    open = false;
  });
  const bestEffort = (text: string) =>
    Effect.suspend(() =>
      open
        ? write(stderr, text).pipe(
            Effect.catch(() => close),
            Effect.onInterrupt(() => close),
          )
        : Effect.void,
    );
  const around = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    enabled
      ? lock.withPermit(
          Effect.gen(function* () {
            if (active) yield* bestEffort(ERASE);
            return yield* effect;
          }),
        )
      : effect;
  /** Draws one frame unless a write holds the lock; that write erases the line anyway. */
  const drawFrame = (label: string, started: number) =>
    lock
      .withPermitsIfAvailable(1)(
        Effect.gen(function* () {
          const elapsed = (yield* Clock.currentTimeMillis) - started;
          const text = fitLiveFrame(
            `${spinnerFrame(elapsed)} ${label}`,
            layout,
            ` ${(elapsed / 1000).toFixed(1)}s`,
          );
          yield* bestEffort(`${ERASE}${text}`);
        }),
      )
      .pipe(Effect.forkChild);
  const live = Effect.fn("Output.live")(function* (label: string) {
    if (!enabled) return;
    const started = yield* Clock.currentTimeMillis;
    active = true;
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.gen(function* () {
          active = false;
          yield* bestEffort(ERASE);
        }),
      ),
    );
    const tick = Effect.sleep("100 millis").pipe(Effect.andThen(drawFrame(label, started)));
    // Registered after the clear finalizer, so drawing stops before the line clears.
    yield* tick.pipe(Effect.forever, Effect.forkScoped);
  });
  return {
    live,
    around,
    line: (text: string) =>
      lock.withPermit(Effect.suspend(() => bestEffort(`${active ? ERASE : ""}${text}\n`))),
  };
}
