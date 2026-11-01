#!/usr/bin/env node
// The stdio entry: the only module that reads process (env, cwd, signals) or starts a transport.
// stdout is the protocol channel; everything else goes to stderr through the logger.
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import pkg from "../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./logging.ts";
import { createServer } from "./server.ts";

let config: Awaited<ReturnType<typeof loadConfig>>;
try {
  config = await loadConfig(process.env, process.cwd());
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

const logger = createLogger(config.logLevel);
const info = { name: pkg.name, version: pkg.version };

const handle = serveStdio(() => createServer(info, { config, logger }), {
  onerror: (error) => logger.error({ errorClass: error.constructor.name }, "transport error"),
});
logger.info({ name: info.name, version: info.version }, "serving on stdio");

// The client ends the session by closing stdin; the transport then closes and the process exits
// on its own. Signals close it the same way.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info({ signal }, "shutting down");
    handle.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
