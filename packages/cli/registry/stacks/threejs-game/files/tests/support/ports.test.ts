/**
 * Tests for freePort: the port it returns can be listened on, and a taken port isn't returned.
 */
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "./ports.ts";

const opened: Server[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((server) => new Promise((done) => server.close(done))));
});

/** Listens on `port` the way a dev server would, resolving once it is bound. */
function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    opened.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("freePort", () => {
  it("gives a port a server can listen on straight away", async () => {
    const port = await freePort();
    expect(Number.isInteger(port) && port > 0 && port < 65536).toBe(true);
    const server = await listenOn(port);
    expect(server.address()).toMatchObject({ port });
  });

  it("gives a different port while the last one is taken", async () => {
    const taken = await freePort();
    await listenOn(taken);
    expect(await freePort()).not.toBe(taken);
  });
});
