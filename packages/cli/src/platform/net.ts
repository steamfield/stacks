/**
 * The CLI's network access, provided once by `bin.ts` (and by `tests/helpers/cli.ts`).
 *
 * Every HTTP request the CLI makes (verify's readiness probes, `update`'s npm lookup, search,
 * stats, the remote index, telemetry) goes through the `HttpClient` built here on Node's
 * `fetch`, with redirects returned rather than followed. That keeps a verify probe, which may only
 * target a local address, from being sent on to another host by a redirect. `Tcp` opens the plain
 * sockets verify's port checks use.
 */
import { makeNet } from "@effect/platform-node/NodeSocket";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { Tcp } from "../services/net";

export const NetLayer = Layer.mergeAll(
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
  ),
  Tcp.layer((host, port) => makeNet({ host, port })),
);
