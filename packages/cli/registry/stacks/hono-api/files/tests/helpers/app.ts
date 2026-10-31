import { createApp } from "../../src/app.ts";
import { createLogger } from "../../src/logging.ts";
import { createMemoryNotes, type NotesStore } from "../../src/services/notes.ts";

export type LogRecord = Record<string, unknown> & { level: string; msg: string };

/** A fresh app with its own store and a logger whose records the test can read. */
export function testApp(options: { notes?: NotesStore; maxBodyBytes?: number } = {}) {
  const records: LogRecord[] = [];
  const logger = createLogger("debug", {
    write: (line: string) => {
      records.push(JSON.parse(line) as LogRecord);
    },
  });
  const app = createApp({
    config: { maxBodyBytes: options.maxBodyBytes ?? 65_536 },
    logger,
    notes: options.notes ?? createMemoryNotes(),
  });
  const requests = () => records.filter((record) => record.msg === "request");
  return { app, records, requests };
}

export const jsonBody = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
