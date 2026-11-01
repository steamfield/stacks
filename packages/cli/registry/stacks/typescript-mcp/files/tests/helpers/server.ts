// An in-memory client connected to a fresh server over a linked transport pair, with a temporary
// root directory and the server's log records captured.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { AppConfig } from "../../src/config.ts";
import { createLogger, type Logger, type LogLevel } from "../../src/logging.ts";
import { createServer } from "../../src/server.ts";

export type LogRecord = Record<string, unknown> & { level: string; msg: string };

/** A logger whose records land in the returned array instead of stderr. */
export function captureLogger(level: LogLevel = "debug"): {
  logger: Logger;
  records: LogRecord[];
} {
  const records: LogRecord[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line) records.push(JSON.parse(line) as LogRecord);
      }
      done();
    },
  });
  return { logger: createLogger(level, sink), records };
}

/** A temporary directory, removed by the returned cleanup. */
export function tempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "mcp-root-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export type TestServer = {
  client: Client;
  root: string;
  records: LogRecord[];
  close: () => Promise<void>;
};

/** A connected client and server. Close it in afterEach: the client first, then the root. */
export async function testServer(overrides: Partial<AppConfig> = {}): Promise<TestServer> {
  const { root, cleanup } = tempRoot();
  const { logger, records } = captureLogger();
  const config: AppConfig = { root, logLevel: "debug", maxFileBytes: 1024, ...overrides };
  const server = createServer({ name: "test-server", version: "0.0.0" }, { config, logger });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    root,
    records,
    close: async () => {
      await client.close();
      await server.close();
      cleanup();
    },
  };
}
