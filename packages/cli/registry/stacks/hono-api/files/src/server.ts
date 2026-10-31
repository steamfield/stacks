import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { App } from "./app.ts";

export type RunningServer = {
  /** The bound port (the real one when you asked for port 0). */
  port: number;
  /** Stops accepting connections and resolves once open ones have finished. */
  close(): Promise<void>;
};

/** Serves the app on Node. The only module that touches the HTTP server. */
export function startServer(app: App, port: number): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            if ("closeIdleConnections" in server) server.closeIdleConnections();
          }),
      });
    });
    server.once("error", reject);
  });
}
