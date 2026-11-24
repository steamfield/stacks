/**
 * How the shell records a game error: every report lands in `window.__game.errors` (so tests fail
 * on it) and the log, and a fatal one also puts a banner over the game. DOM-free so it runs under
 * Node.
 */
import { createLogger } from "./core/index.ts";

/** Options for `GameContext.reportError`. */
export interface ReportErrorOptions {
  /**
   * Whether the game can't carry on without help. Default true: the shell shows a red banner that
   * stays up. Pass false for a failure the game shows and recovers from on its own (an asset that
   * fails once, then loads on retry): it is still recorded and logged, with no banner.
   */
  fatal?: boolean;
}

/** Reports an error from `source`; see `ReportErrorOptions` for what `fatal` changes. */
export type ReportError = (source: string, error: unknown, options?: ReportErrorOptions) => void;

/** One recorded error, as `window.__game.errors` holds it. */
export interface RecordedError {
  source: string;
  message: string;
}

const log = createLogger("shell");

/**
 * A reporter that appends to `errors`, logs at error level, and calls `showBanner` with a one-line
 * summary for fatal reports only.
 */
export function createErrorReporter(
  errors: RecordedError[],
  showBanner: (line: string) => void,
): ReportError {
  return (source, error, { fatal = true } = {}) => {
    const message =
      error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    errors.push({ source, message });
    log.error(`${source}: ${message}`);
    if (fatal) showBanner(`${source}: ${message.split("\n")[0]}`);
  };
}
