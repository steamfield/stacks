import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { onTestFinished } from "vitest";
import type { LogEntry } from "../../src/logging.ts";
import { capturedApp, testServer } from "./server.ts";

export const targets = ["node", "web"] as const;

export async function target(
  kind: (typeof targets)[number],
  staticDir = "",
  maxBodyBytes = 1024,
): Promise<Awaited<ReturnType<typeof testServer>>> {
  if (kind === "node") return testServer(staticDir, maxBodyBytes);
  const records: LogEntry[] = [];
  const web = HttpRouter.toWebHandler(
    capturedApp(records, staticDir, maxBodyBytes).pipe(
      Layer.provide(
        Layer.mergeAll(HttpServer.layerServices, NodeServices.layer, NodeHttpPlatform.layer),
      ),
    ),
    {
      disableLogger: true,
    },
  );
  onTestFinished(web.dispose);
  return {
    records,
    request: (path, init) => web.handler(new Request(`http://test.local${path}`, init)),
  };
}
