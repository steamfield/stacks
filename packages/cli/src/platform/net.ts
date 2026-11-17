/**
 * Provides the Node HTTP and TCP transports. HTTP returns redirects as responses so a local
 * verification probe cannot be redirected to another host.
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
