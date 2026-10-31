import { realpathSync } from "node:fs";
import { join } from "node:path";
import { TelemetryAddEvent } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { AddResult } from "../src/schemas/add";
import { NewResult } from "../src/schemas/new";
import { scriptedTerminal } from "./helpers/cli";
import { minimal, writeEntry } from "./helpers/registry";
import {
  notified,
  ok,
  type TelemetryServer,
  telemetryCli,
  telemetryServer,
  workspace,
} from "./helpers/telemetry";

const AddV3 = Schema.Struct({ ...TelemetryAddEvent.fields, schemaVersion: Schema.Literal(3) });
let space: ReturnType<typeof workspace>;
let server: TelemetryServer;
beforeEach(async () => {
  space = workspace();
  server = await telemetryServer();
});
afterEach(async () => {
  await server.close();
  expect(server.errors).toEqual([]);
  space.cleanup();
});

test("add --dir reports a project override as custom without an official fingerprint", async () => {
  const home = space.home;
  const env = { STACKS_TELEMETRY_URL: server.url, PATH: process.env.PATH };
  await notified(home, server.url);
  const other = join(home, "other");
  const created = await telemetryCli(["new", "go-cli", other, "--json"], { home, env });
  ok(created);
  Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout));
  expect(realpathSync(other)).toBe(other);
  server.requests.length = 0;

  writeEntry({
    root: join(other, ".stacks"),
    kind: "fragment",
    dir: "tools",
    frontmatter: minimal("fragment", "tools"),
  });
  const result = await telemetryCli(["add", "extra", "--dir", other, "--json"], {
    home,
    env,
    host: { cwd: home, stdinIsTTY: true },
    terminal: scriptedTerminal(["y"]),
  });
  ok(result);
  Schema.decodeUnknownSync(AddResult)(JSON.parse(result.stdout));
  const events = server.events().filter((event) => event.type === "add");
  expect(events).toHaveLength(1);
  const event = Schema.decodeUnknownSync(AddV3, { onExcessProperty: "error" })(events[0]);
  expect(event.fragments).toEqual(["extra", "custom"]);
  expect(event.nonOfficial).toEqual({ user: 0, project: 1, source: 0 });
  expect(event).not.toHaveProperty("fingerprint");
});
