/**
 * Everything the CLI prints goes through this service: a command's result, its warnings, live
 * progress, verify's live events and the error a failed run ends with.
 *
 * The first thing it settles is the audience, meaning who reads this invocation's output: `json`
 * with `--json`, `human` at a person's own terminal, `agent` everywhere else (an agent's shell, a
 * pipe, CI). Commands render text by `Output.audience`; nothing else may differ between them.
 *
 * Results are buffered, not written as they come. `main.ts` calls `flush` once the command
 * succeeds and `clear` when it fails, so a failed run leaves stdout empty and stderr ends with
 * the error (`error`), a JSON envelope in JSON mode. `flushNow` writes early, before `new` hands
 * the terminal to a coding agent. Writes to stdout and stderr fail as `BrokenPipe` when the
 * reader closed the pipe (EPIPE) and as `PermissionDenied` otherwise; `progress`, `event` and the
 * live line instead swallow write failures and stop writing after the first one.
 *
 * Only a human gets styling. Color is decided once per stream: on when that stream is a
 * terminal or `FORCE_COLOR=1` is set, off whenever `NO_COLOR` is set. The live line (`live`, a
 * spinner redrawn on stderr) needs stderr to be a terminal and is off under `NO_COLOR` too.
 *
 * `bin.ts` builds the real layer from `Host` and `AppConfig`; tests use `fixed` or `memory`.
 */
import { stripVTControlCharacters, styleText } from "node:util";
import type { DetectedAgent } from "@steamfield/stacks-format";
import { Clock, Context, Effect, Layer, Option, type Scope, Semaphore } from "effect";
import { AppConfig } from "../config";
import { printable } from "../core/text";
import {
  type AppError,
  BrokenPipe,
  encodeDetails,
  failureGuide,
  keepsResult,
  PermissionDenied,
  retryable,
} from "../errors";
import { Host, type HostInfo } from "./host";

/**
 * Who reads this invocation's output. `json`: `--json` was given. `human`: stdout is a terminal
 * and no agent is detected. `agent`: everything else (an agent's shell, a pipe, CI). The three
 * never behave differently; only the rendering changes.
 */
export type Audience = "json" | "agent" | "human";
/** Remove terminal styling and cursor sequences before storing or displaying step output. */
export const stripAnsi = stripVTControlCharacters;

/** `json` wins; `human` needs a terminal on stdout, no detected agent and no CI. */
export function resolveAudience({
  jsonFlag,
  stdoutIsTTY,
  agent,
  ci,
}: {
  jsonFlag: boolean;
  stdoutIsTTY: boolean;
  agent: DetectedAgent;
  ci: boolean;
}): Audience {
  if (jsonFlag) return "json";
  return !ci && stdoutIsTTY && agent === "none" ? "human" : "agent";
}

export type Writer = (text: string) => Promise<void>;
type StyleKind = "error" | "warn" | "ok" | "skip" | "dim" | "next";
export type Style = (kind: StyleKind, text: string) => string;
export const plainStyle: Style = (_kind, text) => text;
const formats = {
  error: "red",
  warn: "yellow",
  ok: "green",
  skip: "gray",
  dim: "dim",
  next: "cyan",
} as const;
const makeStyle = (enabled: boolean): Style =>
  enabled ? (kind, text) => styleText(formats[kind], text, { validateStream: false }) : plainStyle;

/** Writes `text`, failing `BrokenPipe` on EPIPE and `PermissionDenied` on any other error. */
function write(writer: Writer, text: string) {
  return Effect.tryPromise({
    try: () => writer(text),
    catch: (error) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE"
        ? new BrokenPipe()
        : new PermissionDenied({ details: { reason: "write" } }),
  });
}

export class Output extends Context.Service<
  Output,
  {
    /** Resolved once when the layer is built; commands pick their text rendering by it. */
    audience: Audience;
    /**
     * The one-time telemetry notice (`telemetry/notice.ts`): written to stderr at once in text
     * modes, or attached as `notice` to the JSON result when it is flushed.
     */
    notice: (text: string) => Effect.Effect<void>;
    /** Whether the notice reached its reader: written to stderr, or flushed with a JSON result. */
    noticeDelivered: Effect.Effect<boolean>;
    style: Style;
    /** Clears on scope close; the caller renders completion through normal output. */
    live: (label: string) => Effect.Effect<void, never, Scope.Scope>;
    /** `value` in JSON mode; otherwise `text`, the rendering for this audience. */
    result: (value: unknown, text: string) => Effect.Effect<void>;
    note: (text: string) => Effect.Effect<void, BrokenPipe | PermissionDenied>;
    /** A live line on stderr in human mode; nothing for an agent or in JSON mode. Never fails. */
    progress: (text: string) => Effect.Effect<void>;
    /**
     * A live event on stderr for machine readers while a long command runs: `value` as one JSON
     * line in JSON mode, `agentText` (when given) as one line in agent mode, nothing for a human,
     * who gets `progress` lines instead. Never fails; stops after the first failed write. The
     * error envelope, written after it, stays the last stderr line.
     */
    event: (value: unknown, agentText?: string) => Effect.Effect<void>;
    /**
     * Encodes details and writes the envelope; details with excess properties are a defect.
     * `invocation` (`Host.invocation`) is quoted in the failure's guide (`errors.ts::failureGuide`):
     * the envelope's `next`, and the text modes' detail and `Next:` lines.
     */
    error: (
      error: AppError,
      invocation: string,
      rollback?: ReadonlyArray<string>,
    ) => Effect.Effect<void, BrokenPipe | PermissionDenied>;
    flush: Effect.Effect<void, BrokenPipe | PermissionDenied>;
    /** Text modes: writes buffered results now (before a child takes the terminal). JSON: no-op. */
    flushNow: Effect.Effect<void, BrokenPipe | PermissionDenied>;
    clear: Effect.Effect<void>;
  }
>()("stacks/Output") {
  static layer = ({
    jsonFlag,
    stdout,
    stderr,
  }: {
    jsonFlag: boolean;
    stdout: Writer;
    stderr: Writer;
  }) =>
    Layer.effect(
      Output,
      Effect.gen(function* () {
        const host = yield* Host;
        const config = yield* AppConfig;
        const agent = yield* config.agent;
        const color = yield* config.color;
        const audience = resolveAudience({
          jsonFlag,
          stdoutIsTTY: host.stdoutIsTTY,
          agent,
          ci: config.ci,
        });
        const styled = audience === "human" && !color.noColor;
        return make(audience, stdout, stderr, {
          stdout: styled && (host.stdoutIsTTY || color.forceColor),
          stderr: styled && (host.stderrIsTTY || color.forceColor),
          live: styled && host.stderrIsTTY,
          layout: host,
        });
      }),
    );
  /** An Output for a fixed audience, for tests that bypass the resolution. */
  static fixed = (audience: Audience, stdout: Writer, stderr: Writer) =>
    Layer.sync(Output, () => make(audience, stdout, stderr));
  static memory = (audience: Audience = "human") => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout,
      stderr,
      layer: Output.fixed(
        audience,
        async (s) => {
          stdout.push(s);
        },
        async (s) => {
          stderr.push(s);
        },
      ),
    };
  };
}

type ErrorView = {
  error: AppError;
  details: unknown;
  guide: ReturnType<typeof failureGuide>;
  style: Style;
  rollback: ReadonlyArray<string>;
};

/** The JSON error envelope (`errors.ts::ErrorEnvelope`) as one line. */
function renderEnvelope({ error, details, guide, rollback }: ErrorView): string {
  return `${JSON.stringify({
    error: {
      tag: error._tag,
      message: error.message,
      retryable: retryable(error),
      ...(guide.next === undefined ? {} : { next: guide.next }),
      ...(details === undefined ? {} : { details }),
      ...(rollback.length === 0 ? {} : { rollback: { incomplete: rollback } }),
    },
  })}\n`;
}

/**
 * The message, then the guide's lines, the unrestored paths and the `Next:` line, each indented.
 * A keeps-result failure's report already ends with that `Next:` line, so it isn't repeated.
 */
function renderErrorText({ error, guide, style, rollback }: ErrorView): string {
  const next =
    guide.next === undefined || keepsResult(error) ? [] : [style("next", `Next: ${guide.next}`)];
  const restore = rollback.length
    ? [`Rollback incomplete: check ${rollback.map(printable).join(", ")} before retrying.`]
    : [];
  const indented = [...guide.lines, ...restore, ...next].map((line) => `  ${line}`);
  return `${[style("error", error.message), ...indented].join("\n")}\n`;
}

/** Which streams get styling, whether the live line may redraw, and the terminal's measure. */
type Display = { stdout: boolean; stderr: boolean; live: boolean; layout?: LiveLayout };
const PLAIN_DISPLAY: Display = { stdout: false, stderr: false, live: false };

function make(
  audience: Audience,
  stdout: Writer,
  stderr: Writer,
  display: Display = PLAIN_DISPLAY,
): Output["Service"] {
  const json = audience === "json";
  const results: string[] = [];
  let notice: string | undefined;
  let noticeDelivered = false;
  const terminal = makeLive(stderr, display.live, display.layout);
  const style = makeStyle(display.stdout);
  const errorStyle = makeStyle(display.stderr);
  const markNoticeDelivered = Effect.sync(() => {
    noticeDelivered = true;
  });
  /** A JSON object result carries the pending notice; any other value is kept as it is. */
  const withNotice = (value: unknown) =>
    notice && typeof value === "object" && value !== null ? { ...value, notice } : value;
  // Uninterruptible: results leave the buffer only to be written, so an interrupt waits for the
  // write rather than reporting before it lands. A stalled stdout still yields to a second signal.
  const flush = Effect.uninterruptible(
    Effect.suspend(() => {
      if (!results.length) return Effect.void;
      const text = `${results.join("\n")}\n`;
      results.length = 0;
      return terminal
        .around(write(stdout, text))
        .pipe(Effect.tap(() => (json && notice !== undefined ? markNoticeDelivered : Effect.void)));
    }),
  );
  return {
    audience,
    notice: (text) =>
      Effect.gen(function* () {
        notice = text;
        if (json) return;
        yield* terminal.around(write(stderr, `${text}\n`)).pipe(
          Effect.tap(() => markNoticeDelivered),
          Effect.ignoreCause,
        );
      }),
    noticeDelivered: Effect.sync(() => noticeDelivered),
    style,
    live: terminal.live,
    result: (value, text) =>
      Effect.sync(() => {
        results.push(json ? JSON.stringify(withNotice(value)) : text);
      }),
    note: (text) =>
      terminal.around(
        write(stderr, `${text.startsWith("Warning:") ? errorStyle("warn", text) : text}\n`),
      ),
    progress: (text) => (audience === "human" ? terminal.line(text) : Effect.void),
    event: (value, agentText) => {
      if (json) return terminal.line(JSON.stringify(value));
      return audience === "agent" && agentText !== undefined
        ? terminal.line(agentText)
        : Effect.void;
    },
    error: (error, invocation, rollback = []) =>
      encodeDetails(error).pipe(
        Effect.orDie,
        Effect.flatMap((details) => {
          const view = {
            error,
            details,
            guide: failureGuide(error, invocation),
            style: errorStyle,
            rollback,
          };
          return terminal.around(
            write(stderr, json ? renderEnvelope(view) : renderErrorText(view)),
          );
        }),
      ),
    flush,
    flushNow: json ? Effect.void : flush,
    clear: Effect.sync(() => {
      results.length = 0;
    }),
  };
}

/** The terminal facts the live line needs to fit on one row. */
type LiveLayout = Pick<HostInfo, "columns" | "stringWidth">;

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
function makeLive(stderr: Writer, enabled: boolean, layout?: LiveLayout) {
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
