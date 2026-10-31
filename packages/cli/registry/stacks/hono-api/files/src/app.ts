import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import type { AppConfig } from "./config.ts";
import { AppError, envelope, toAppError } from "./errors.ts";
import { type Logger, requestLogger } from "./logging.ts";
import { createRouter } from "./router.ts";
import { healthRoutes } from "./routes/health.ts";
import { notesRoutes } from "./routes/notes.ts";
import { createMemoryNotes, type NotesStore } from "./services/notes.ts";

export type AppDeps = {
  config: Pick<AppConfig, "maxBodyBytes">;
  logger: Logger;
  notes?: NotesStore;
};

/**
 * The whole API as a fetch handler: no Node imports, so the same app serves through
 * src/server.ts on Node and runs in tests through app.request().
 */
export function createApp({ config, logger, notes = createMemoryNotes() }: AppDeps) {
  const app = createRouter();

  app.use(requestId({ limitLength: 128 }));
  app.use(requestLogger(logger));
  app.use(
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: () => {
        throw new AppError("payload_too_large");
      },
    }),
  );

  app.route("/", healthRoutes());
  app.route("/", notesRoutes(notes));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "API", version: "1" },
  });

  // A wrong method on a declared path is a miss too: Hono answers both with the 404 envelope.
  app.notFound((c) => c.json(envelope(new AppError("not_found"), c.get("requestId")), 404));

  app.onError((error, c) => {
    const appError = toAppError(error);
    if (appError.code === "internal") {
      // The class and stack go to the log; the message may hold secrets, so it stays out.
      logger.error(
        {
          requestId: c.get("requestId"),
          errorClass: error.constructor.name,
          stack: error.stack?.split("\n").slice(1).join("\n"),
        },
        "unhandled error",
      );
    }
    return c.json(envelope(appError, c.get("requestId")), appError.status);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
