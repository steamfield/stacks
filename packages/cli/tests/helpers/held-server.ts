import { existsSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";

/** Serve fixture files over loopback, with explicit release for stalled responses. */
export async function heldServer(root: string, hold: (path: string) => boolean) {
  const requests: string[] = [];
  const open = new Map<ServerResponse, string>();
  let peakOpen = 0;
  let holding = true;
  const reply = (response: ServerResponse, path: string) => {
    const file = join(root, path);
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(readFileSync(file));
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname;
    requests.push(path);
    if (!holding || !hold(path)) {
      reply(response, path);
      return;
    }
    open.set(response, path);
    peakOpen = Math.max(peakOpen, open.size);
    response.once("close", () => open.delete(response));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture HTTP port");
  function release(match: (path: string) => boolean = () => true) {
    for (const [response, path] of open) {
      if (!match(path)) continue;
      open.delete(response);
      reply(response, path);
    }
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    pending: () => [...open.values()],
    peakOpen: () => peakOpen,
    release,
    serveRemaining() {
      holding = false;
      release();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export type HeldServer = Awaited<ReturnType<typeof heldServer>>;
