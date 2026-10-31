// HTTP for verify probes and update's registry request, over Node's fetch without redirects,
// so a local probe can't be sent to another host; TCP sockets supply port checks.
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
