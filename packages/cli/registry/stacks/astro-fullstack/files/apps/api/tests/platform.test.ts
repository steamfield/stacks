import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect";
import { HttpServer } from "effect/http";
import { expect, it, onTestFinished } from "vitest";
import { entry } from "../src/logging.ts";
import { fileSink, Server } from "../src/platform/node.ts";
import { tempDir } from "./helpers/temp.ts";

const record = entry({ date: new Date(0), level: "info", message: "ready" });

it("recreates deleted log directories and rotates active logs without replacing the previous run", async () => {
  const dir = await tempDir();
  const folder = join(dir, "logs");
  const file = join(folder, "server.jsonl");
  const warnings: string[] = [];
  const append = fileSink(file, (message) => warnings.push(message));
  append(record);
  expect(JSON.parse((await readFile(file, "utf8")).trim())).toEqual(record);
  await rm(folder, { recursive: true });
  append(record);
  expect((await readFile(file, "utf8")).trim()).toBe(JSON.stringify(record));
  await writeFile(join(folder, "server.prev.jsonl"), "previous run");
  await writeFile(file, "x".repeat(10 * 1024 * 1024));
  append(record);
  expect((await stat(join(folder, "server.old.jsonl"))).size).toBe(10 * 1024 * 1024);
  expect(await readFile(join(folder, "server.prev.jsonl"), "utf8")).toBe("previous run");
  expect((await stat(file)).size).toBeLessThan(10 * 1024 * 1024);
  expect(warnings).toEqual([]);
});

it("warns once on a failed file sink, keeps accepting records, and recovers", async () => {
  const dir = await tempDir();
  const folder = join(dir, "occupied");
  await writeFile(folder, "not a directory");
  const warnings: string[] = [];
  const append = fileSink(join(folder, "server.jsonl"), (message) => warnings.push(message));
  append(record);
  append(record);
  expect(warnings).toHaveLength(1);
  await rm(folder);
  await mkdir(folder);
  append(record);
  expect(await readFile(join(folder, "server.jsonl"), "utf8")).toBe(`${JSON.stringify(record)}\n`);
  expect(warnings).toHaveLength(1);
});

it("keeps file-sink failure nonfatal when its warning output also fails", async () => {
  const dir = await tempDir();
  const occupied = join(dir, "occupied");
  await writeFile(occupied, "not a directory");
  let warnings = 0;
  const append = fileSink(join(occupied, "server.jsonl"), () => {
    warnings++;
    throw new Error("Warning output closed");
  });
  expect(() => append(record)).not.toThrow();
  expect(() => append(record)).not.toThrow();
  expect(warnings).toBe(1);
});

it("serves the live app with real configuration and writes its development records", async () => {
  const dir = await tempDir();
  const file = join(dir, "server.jsonl");
  const scope = await Effect.runPromise(Scope.make());
  onTestFinished(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      Server.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnvRecord({
              PORT_API: "0",
              LOG_LEVEL: "debug",
              NO_COLOR: "1",
              LOG_FILE: file,
            }),
          ),
        ),
      ),
      scope,
    ),
  );
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag === "UnixPathAddress") throw new Error("Expected TCP");
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  const value: unknown = JSON.parse((await readFile(file, "utf8")).trim());
  expect(value).toMatchObject({
    msg: "request",
    level: "debug",
    path: "/healthz",
    requestId: response.headers.get("x-request-id"),
  });
});
