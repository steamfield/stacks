/**
 * Reports the checkout's development processes, HTTP readiness and logged problems.
 * The background command and agent startup hook use this view to diagnose the current session.
 */

// What this checkout's dev servers are doing: running or not, their ports, whether each answers,
// and how many warn/error records this run has. `bun run dev:status` prints it, and the
// SessionStart hook (.claude/hooks/dev-server-status.ts) puts it in an agent's context. Paths
// are relative to the repo root, which callers chdir to first.
import { countProblems, OUTPUT_LOG, SERVER_LOG, TERMINAL_LOG } from "./dev-logs";
import { orphanedGroups, runningDevServer } from "./dev-pid";

/**
 * Why a URL didn't answer OK by `deadline` (at most 5 s per attempt), or undefined when it did.
 * Refused connections and timeouts are expected while a server boots.
 */
export async function unanswered(url: string, deadline: number): Promise<string | undefined> {
  const wait = Math.max(1, Math.min(5000, deadline - Date.now()));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(wait) });
    if (res.ok) return undefined;
    await res.body?.cancel();
    return `HTTP ${res.status}`;
  } catch (error) {
    if (!(error instanceof Error)) return "no answer";
    if ("code" in error && typeof error.code === "string") return error.code;
    const cause = error.cause;
    if (cause instanceof Error && "code" in cause && typeof cause.code === "string")
      return cause.code;
    return error.name === "TimeoutError" ? "no answer" : error.message;
  }
}

export type DevStatus = {
  state: "running" | "orphaned" | "stopped";
  /** Both servers answered (always false unless running). */
  healthy: boolean;
  lines: string[];
};

/** The status report. `timeoutMs` bounds each health probe; both run at once. */
export async function devStatus(timeoutMs = 2000): Promise<DevStatus> {
  const server = runningDevServer();
  if (!server) {
    const orphans = orphanedGroups();
    if (orphans.length) {
      return {
        state: "orphaned",
        healthy: false,
        lines: [
          `A killed dev session left its servers running (process groups ${orphans.join(", ")}), with no dev process to own them. Stop them with bun run dev:stop, then start again with bun run dev:bg.`,
        ],
      };
    }
    return {
      state: "stopped",
      healthy: false,
      lines: [
        "No dev servers are running from this checkout. Start them with bun run dev:bg; the last run's logs are still readable with bun run logs.",
      ],
    };
  }
  const deadline = Date.now() + timeoutMs;
  const [api, web] = await Promise.all([
    unanswered(`http://localhost:${server.api}/healthz`, deadline),
    unanswered(`http://localhost:${server.web}/`, deadline),
  ]);
  const problems = countProblems();
  const lines = [
    `Dev servers are running from this checkout (pid ${server.pid}); reuse them rather than starting more.`,
    `  API   http://localhost:${server.api}  ${api ? `not answering /healthz (${api})` : "healthy"}`,
    `  site  http://localhost:${server.web}  ${web ? `not answering / (${web})` : "healthy"}`,
    `  logs  bun run logs (--help for filters); files ${SERVER_LOG}, ${OUTPUT_LOG}, ${TERMINAL_LOG}`,
  ];
  if (problems > 0) {
    lines.push(`  ${problems} warn/error record(s) this run: bun run logs --level warn`);
  }
  if (api || web) lines.push("  Restart with bun run dev:stop, then bun run dev:bg.");
  return { state: "running", healthy: !api && !web, lines };
}
