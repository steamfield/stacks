import { styleText } from "node:util";
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
export function resolveAudience(
  json: boolean,
  stdoutIsTTY: boolean,
  agent: DetectedAgent,
  ci = false,
): Audience {
  if (json) return "json";
  return !ci && stdoutIsTTY && agent === "none" ? "human" : "agent";
}
export type Writer = (text: string) => Promise<void>;
export type StyleKind = "error" | "warn" | "ok" | "skip" | "dim" | "next";
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
    notice: (text: string) => Effect.Effect<void>;
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
  /**
   * This invocation's Output: the audience comes from `--json` (`json`), `Host.stdoutIsTTY` and
   * `AppConfig.agent`, resolved once here.
   */
  static layer = (json: boolean, stdout: Writer, stderr: Writer) =>
    Layer.effect(
      Output,
      Effect.gen(function* () {
        const host = yield* Host;
        const config = yield* AppConfig;
        const agent = yield* config.agent;
        const color = yield* config.color;
        const audience = resolveAudience(json, host.stdoutIsTTY, agent, config.ci);
        const enabled = audience === "human" && !color.noColor;
        const stderrTTY = host.stderrIsTTY;
        return make(audience, stdout, stderr, {
          stdout: enabled && (host.stdoutIsTTY || color.forceColor),
          stderr: enabled && (stderrTTY || color.forceColor),
          live: enabled && stderrTTY,
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
  json: boolean;
  style: Style;
  rollback: ReadonlyArray<string>;
};
/**
 * The envelope (`errors.ts::ErrorEnvelope`) in JSON mode; otherwise the message, the guide's
 * lines and its `Next:` line. A keeps-result failure's report already ends with that `Next:` line.
 */
function renderError({ error, details, guide, json, style, rollback }: ErrorView): string {
  if (json)
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
  const next =
    guide.next === undefined || keepsResult(error) ? [] : [style("next", `Next: ${guide.next}`)];
  const restore = rollback.length
    ? [`Rollback incomplete: check ${rollback.map(printable).join(", ")} before retrying.`]
    : [];
  return `${[style("error", error.message), ...[...guide.lines, ...restore, ...next].map((line) => `  ${line}`)].join("\n")}\n`;
}
function make(
  audience: Audience,
  stdout: Writer,
  stderr: Writer,
  color: { stdout: boolean; stderr: boolean; live: boolean; layout?: LiveLayout } = {
    stdout: false,
    stderr: false,
    live: false,
  },
): Output["Service"] {
  const json = audience === "json";
  const results: string[] = [];
  let notice: string | undefined;
  let noticeDelivered = false;
  const terminal = makeLive(stderr, color.live, color.layout);
  const style = makeStyle(color.stdout);
  const errorStyle = makeStyle(color.stderr);
  // Uninterruptible: results leave the buffer only to be written, so an interrupt waits for the
  // write rather than reporting before it lands. A stalled stdout still yields to a second signal.
  const flush = Effect.uninterruptible(
    Effect.suspend(() => {
      if (!results.length) return Effect.void;
      const text = `${results.join("\n")}\n`;
      results.length = 0;
      return terminal.around(write(stdout, text)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (json && notice !== undefined) noticeDelivered = true;
          }),
        ),
      );
    }),
  );
  return {
    audience,
    notice: (text) =>
      Effect.gen(function* () {
        notice = text;
        if (!json)
          yield* terminal.around(write(stderr, `${text}\n`)).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                noticeDelivered = true;
              }),
            ),
            Effect.ignoreCause,
          );
      }),
    noticeDelivered: Effect.sync(() => noticeDelivered),
    style,
    live: terminal.live,
    result: (value, text) =>
      Effect.sync(() => {
        const result =
          notice && typeof value === "object" && value !== null ? { ...value, notice } : value;
        results.push(json ? JSON.stringify(result) : text);
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
        Effect.flatMap((details) =>
          terminal.around(
            write(
              stderr,
              renderError({
                error,
                details,
                guide: failureGuide(error, invocation),
                json,
                style: errorStyle,
                rollback,
              }),
            ),
          ),
        ),
      ),
    flush,
    flushNow: json ? Effect.void : flush,
    clear: Effect.sync(() => {
      results.length = 0;
    }),
  };
}

/** Serialize redraws and normal writes so a frame cannot split a child's output row. */
type LiveLayout = Pick<HostInfo, "columns" | "stringWidth">;

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

function makeLive(stderr: Writer, enabled: boolean, layout?: LiveLayout) {
  const lock = Semaphore.makeUnsafe(1);
  let open = true;
  let active = false;
  const erase = "\r\u001b[2K";
  const bestEffort = (text: string) =>
    Effect.suspend(() =>
      open
        ? write(stderr, text).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                open = false;
              }),
            ),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                open = false;
              }),
            ),
          )
        : Effect.void,
    );
  const around = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    enabled
      ? lock.withPermit(
          Effect.gen(function* () {
            if (active) yield* bestEffort(erase);
            return yield* effect;
          }),
        )
      : effect;
  const live = Effect.fn("Output.live")(function* (label: string) {
    if (!enabled) return;
    const started = yield* Clock.currentTimeMillis;
    active = true;
    yield* Effect.addFinalizer(() =>
      lock.withPermit(
        Effect.gen(function* () {
          active = false;
          yield* bestEffort(erase);
        }),
      ),
    );
    const draw = Effect.gen(function* () {
      yield* Effect.sleep("100 millis");
      yield* lock
        .withPermitsIfAvailable(1)(
          Effect.gen(function* () {
            const elapsed = (yield* Clock.currentTimeMillis) - started;
            const frame = "|/-\\"[Math.floor(elapsed / 100) % 4] ?? "|";
            const text = fitLiveFrame(
              `${frame} ${label}`,
              layout,
              ` ${(elapsed / 1000).toFixed(1)}s`,
            );
            yield* bestEffort(`${erase}${text}`);
          }),
        )
        .pipe(Effect.forkChild);
    });
    // Registered after the clear finalizer, so drawing stops before the line clears.
    yield* draw.pipe(Effect.forever, Effect.forkScoped);
  });
  return {
    live,
    around,
    line: (text: string) =>
      lock.withPermit(Effect.suspend(() => bestEffort(`${active ? erase : ""}${text}\n`))),
  };
}
