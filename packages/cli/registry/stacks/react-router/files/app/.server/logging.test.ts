import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Logger } from "effect";
import { expect, it, onTestFinished } from "vitest";
import { defectInfo, entry, fileSink, type LogEntry, makeLogger, terminalLine } from "./logging";

const record = entry({ date: new Date(0), level: "INFO", message: "ready" });
it("removes the entire multiline message before extracting stack frames", () => {
  const error = new Error("failed\n    at PRIVATE_SENTINEL");
  expect(JSON.stringify(defectInfo(error))).not.toContain("PRIVATE_SENTINEL");
  expect(defectInfo(error).stack.length).toBeGreaterThan(0);
  error.stack = "unrecognized stack format\n    at PRIVATE_SENTINEL";
  expect(defectInfo(error).stack).toEqual([]);
});
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "router-logs-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
it("captures real Effect logger inputs with UTC time, scalar details and safe annotations", async () => {
  const records: LogEntry[] = [];
  await Effect.runPromise(
    Effect.logInfo("ready", { secret: "PRIVATE_SENTINEL" }).pipe(
      Effect.annotateLogs({
        token: "PRIVATE_SENTINEL",
        time: "collision",
        requestId: "safe",
        defect: new TypeError("PRIVATE_SENTINEL"),
      }),
      Effect.provide(Logger.layer([makeLogger((value) => records.push(value))])),
    ),
  );
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    time: expect.stringMatching(/Z$/),
    level: "info",
    msg: "ready",
    detail: ["[redacted]"],
    token: "[redacted]",
    annotation_time: "collision",
    requestId: "safe",
    error: { class: "TypeError" },
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE_SENTINEL");
  expect(terminalLine(record, true)).not.toContain("\u001b");
  expect(terminalLine(record, false)).toContain("\u001b");
});
it("recreates a deleted log directory", async () => {
  const dir = await temp();
  const folder = join(dir, "logs");
  const file = join(folder, "server.jsonl");
  const warnings: string[] = [];
  const append = fileSink(file, (message) => warnings.push(message));
  append(record);
  await rm(folder, { recursive: true });
  append(record);
  expect(await readFile(file, "utf8")).toBe(`${JSON.stringify(record)}\n`);
  expect(warnings).toEqual([]);
});
it("warns once on file failure and recovers without failing requests", async () => {
  const dir = await temp();
  const folder = join(dir, "occupied");
  await writeFile(folder, "not a directory");
  const warnings: string[] = [];
  const append = fileSink(join(folder, "server.jsonl"), (message) => warnings.push(message));
  append(record);
  append(record);
  expect(warnings).toHaveLength(1);
  await rm(folder);
  append(record);
  expect(await readFile(join(folder, "server.jsonl"), "utf8")).toBe(`${JSON.stringify(record)}\n`);
});
