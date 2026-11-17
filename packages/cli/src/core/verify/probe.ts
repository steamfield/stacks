/**
 * Owns loopback readiness and port checks for verify. `Tcp` and `HttpClient` keep probes
 * independent of Node.
 */
import { Duration, Effect, Option, Schedule } from "effect";
import { HttpClient } from "effect/http";
import { Tcp } from "../../services/net";

/** Restrict probes to loopback because verify checks the local project. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CONNECT_TIMEOUT = Duration.seconds(1);
const REQUEST_TIMEOUT = Duration.seconds(5);
const PROBE_EVERY = Duration.millis(500);
/** `portClosed` checks this many times, this far apart: 5 s in all. */
const CLOSE_CHECKS = 20;
const CLOSE_CHECK_EVERY = Duration.millis(250);
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

type ProbeTarget = { url: string; host: string; port: number };

/**
 * Expand probe variables. Missing variables are environment failures. A malformed or non-local
 * HTTP URL is a step failure.
 */
export function probeTarget(
  http: string,
  env: Record<string, string>,
): ProbeTarget | { kind: "env" | "step"; reason: string } {
  const missing = [...http.matchAll(VARIABLE)]
    .map((match) => match[1] as string)
    .find((name) => env[name] === undefined);
  if (missing !== undefined)
    return { kind: "env", reason: `probe URL uses \${${missing}}, which is not set` };
  const expanded = http.replace(VARIABLE, (_, name: string) => env[name] ?? "");
  const bad = {
    kind: "step" as const,
    reason: "probe URL must be http on localhost, 127.0.0.1 or ::1",
  };
  if (!URL.canParse(expanded)) return bad;
  const url = new URL(expanded);
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname)) return bad;
  // URL keeps an IPv6 host in brackets; a socket wants the bare address.
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  return { url: url.href, host, port: url.port ? Number(url.port) : 80 };
}

/** Whether something accepts a TCP connection on `port`; `localhost` checks both loopbacks. */
export const portAnswers = (host: string, port: number) =>
  Effect.gen(function* () {
    const tcp = yield* Tcp;
    const hosts = host === "localhost" ? ["127.0.0.1", "::1"] : [host];
    for (const address of hosts) {
      const socket = yield* tcp.connect(address, port);
      const open = yield* Effect.scoped(socket.reader).pipe(
        Effect.timeoutOption(CONNECT_TIMEOUT),
        Effect.map(Option.isSome),
        Effect.orElseSucceed(() => false),
      );
      if (open) return true;
    }
    return false;
  });

/** Polls `url` every 500 ms (5 s per request) until a status below 500; never fails. */
export const probeReady = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const once = client.get(url).pipe(
      Effect.map((response) => response.status < 500),
      Effect.timeoutOption(REQUEST_TIMEOUT),
      Effect.map((ready) => Option.getOrElse(ready, () => false)),
      Effect.orElseSucceed(() => false),
    );
    yield* once.pipe(
      Effect.repeat({ until: (ready) => ready, schedule: Schedule.spaced(PROBE_EVERY) }),
    );
  });

/** Polls every 250 ms for up to 5 s until nothing answers on the port; true when it closed. */
export const portClosed = (host: string, port: number) =>
  Effect.gen(function* () {
    for (let check = 0; check < CLOSE_CHECKS; check++) {
      if (!(yield* portAnswers(host, port))) return true;
      yield* Effect.sleep(CLOSE_CHECK_EVERY);
    }
    return !(yield* portAnswers(host, port));
  });
