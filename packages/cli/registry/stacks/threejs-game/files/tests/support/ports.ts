/**
 * Free TCP ports for the servers the tests and `bun run see` start, so parallel runs on one
 * machine never fight over a fixed port.
 */
import { createServer } from "node:net";

/**
 * A TCP port on 127.0.0.1 that nothing was listening on a moment ago. The port is released before
 * this returns, so start the server on it promptly.
 *
 * @throws {Error} When the OS refuses to open a listening socket or reports no port for it.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error(`the OS opened a socket but reported no port (${String(address)})`));
      });
    });
  });
}
