/**
 * Owns audience selection and application writes to stdout and stderr. Buffering lets
 * `writeFailure` or `flushSuccess` settle the result when the command ends.
 */
import { stripVTControlCharacters, styleText } from "node:util";
import type { DetectedAgent } from "@steamfield/stacks-format";
import { Context, Effect, Layer, type Scope } from "effect";
import { AppConfig } from "../config";
import { failureGuide } from "../core/failure-guide";
import { printable } from "../core/text/text";
import {
  type AppError,
  type BrokenPipe,
  keepsResult,
  type PermissionDenied,
  type PreparedFailure,
} from "../errors";
import { Host } from "./host";
import { type LiveLayout, makeLive } from "./output-live";
import { type Writer, write } from "./output-write";

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

export class Output extends Context.Service<
  Output,
  {
    /** Resolved once when the layer is built; commands pick their text rendering by it. */
    audience: Audience;
    /**
     * Writes to stderr in text modes or registers a notice for subsequent JSON object results.
     */
    showNotice: (text: string) => Effect.Effect<void>;
    /** Set after a successful stderr notice write or a flush of JSON containing the notice. */
    didDeliverNotice: Effect.Effect<boolean>;
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
    error: (
      failure: PreparedFailure,
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
  guide: ReturnType<typeof failureGuide>;
  style: Style;
  rollback: ReadonlyArray<string>;
};

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

type BufferedResult = { text: string | undefined; noticeAttached: boolean };

function hasSerializedNotice(text: string | undefined, notice: string): boolean {
  const value: unknown = text === undefined ? undefined : JSON.parse(text);
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getOwnPropertyDescriptor(value, "notice")?.value === notice
  );
}

function renderJsonResult(value: unknown, notice: string | undefined): BufferedResult {
  if (notice && typeof value === "object" && value !== null) {
    const result = { ...value, notice };
    const hasCustomSerializer = "toJSON" in result && typeof result.toJSON === "function";
    const text = JSON.stringify(result);
    return { text, noticeAttached: !hasCustomSerializer || hasSerializedNotice(text, notice) };
  }
  return { text: JSON.stringify(value), noticeAttached: false };
}

function make(
  audience: Audience,
  stdout: Writer,
  stderr: Writer,
  display: Display = PLAIN_DISPLAY,
): Output["Service"] {
  const json = audience === "json";
  const results: BufferedResult[] = [];
  let notice: string | undefined;
  let noticeDelivered = false;
  const terminal = makeLive(stderr, display.live, display.layout);
  const style = makeStyle(display.stdout);
  const errorStyle = makeStyle(display.stderr);
  const markNoticeDelivered = Effect.sync(() => {
    noticeDelivered = true;
  });
  // Uninterruptible: results leave the buffer only to be written, so an interrupt waits for the
  // write rather than reporting before it lands. A stalled stdout still yields to a second signal.
  const flush = Effect.uninterruptible(
    Effect.suspend(() => {
      if (!results.length) return Effect.void;
      const text = `${results.map((result) => result.text).join("\n")}\n`;
      const noticeAttached = results.some((result) => result.noticeAttached);
      results.length = 0;
      return terminal
        .around(write(stdout, text))
        .pipe(Effect.tap(() => (noticeAttached ? markNoticeDelivered : Effect.void)));
    }),
  );
  return {
    audience,
    showNotice: (text) =>
      Effect.gen(function* () {
        notice = text;
        if (json) return;
        yield* terminal.around(write(stderr, `${text}\n`)).pipe(
          Effect.tap(() => markNoticeDelivered),
          Effect.ignoreCause,
        );
      }),
    didDeliverNotice: Effect.sync(() => noticeDelivered),
    style,
    live: terminal.live,
    result: (value, text) =>
      Effect.sync(() => {
        results.push(json ? renderJsonResult(value, notice) : { text, noticeAttached: false });
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
    error: (failure, invocation, rollback = []) =>
      Effect.suspend(() => {
        const { error } = failure;
        const guide = failureGuide(error, invocation);
        const text = json
          ? failure.renderEnvelope(guide.next, rollback)
          : renderErrorText({ error, guide, style: errorStyle, rollback });
        return terminal.around(write(stderr, text));
      }),
    flush,
    flushNow: json ? Effect.void : flush,
    clear: Effect.sync(() => {
      results.length = 0;
    }),
  };
}
