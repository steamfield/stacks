// The entry point: the only module that reads process.env or handles signals.
import { createApp } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createLogger } from "./logging.ts";
import { startServer } from "./server.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

const logger = createLogger(config.logLevel);
const server = await startServer(createApp({ config, logger }), config.port);
logger.info({ port: server.port }, "listening");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    // Open keep-alive connections get 10 s to finish before the process exits anyway.
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ errorClass: (error as Error).constructor.name }, "close failed");
        process.exit(1);
      },
    );
  });
}
