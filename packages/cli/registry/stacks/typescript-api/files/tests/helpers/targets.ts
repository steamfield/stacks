import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { onTestFinished } from "vitest";
import type { LogEntry } from "../../src/logging.ts";
import { capturedApp, testServer } from "./server.ts";

export const targets = ["node", "web"] as const;

export async function target(
  kind: (typeof targets)[number],
): Promise<Awaited<ReturnType<typeof testServer>>> {
  if (kind === "node") return testServer();
  const records: LogEntry[] = [];
  const web = HttpRouter.toWebHandler(
    capturedApp(records).pipe(Layer.provide(HttpServer.layerServices)),
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
