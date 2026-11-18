import { cpSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Manifest, TelemetryAddEvent, TelemetryNewEvent } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodeManifest, MANIFEST_PATH } from "../src/core/project/manifest";
import { AddResult } from "../src/schemas/add";
import { NewResult } from "../src/schemas/new";
import {
  notified,
  ok,
  type TelemetryServer,
  telemetryCli,
  telemetryServer,
  workspace,
} from "./helpers/telemetry";
import { workspaceRegistry } from "./helpers/workspace";

const NewV3 = Schema.Struct({ ...TelemetryNewEvent.fields, schemaVersion: Schema.Literal(3) });
const AddV3 = Schema.Struct({ ...TelemetryAddEvent.fields, schemaVersion: Schema.Literal(3) });

let space: ReturnType<typeof workspace>;
let home: string;
let server: TelemetryServer;
beforeEach(async () => {
  space = workspace();
  home = space.home;
  server = await telemetryServer();
});
afterEach(async () => {
  await server.close();
  expect(server.errors).toEqual([]);
  space.cleanup();
});

const options = (cwd = home) => ({
  home,
  env: { STACKS_TELEMETRY_URL: server.url },
  host: { registry: workspaceRegistry, cwd },
});
const project = () => join(home, "app");

/** `new pair` with telemetry on; returns its one `new` event. */
async function scaffoldPair() {
  await notified(home, server.url);
  const result = await telemetryCli(["new", "pair", "app", "--no-launch", "--json"], options());
  ok(result);
  Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  const events = server.events().filter((event) => event.type === "new");
  expect(events).toHaveLength(1);
  return Schema.decodeUnknownSync(NewV3, { onExcessProperty: "error" })(events[0]);
}
/** `add db` in the pair project; returns its one `add` event. */
async function addDb() {
  const result = await telemetryCli(["add", "db", "--json"], options(project()));
  ok(result);
  Schema.decodeUnknownSync(AddResult)(JSON.parse(result.stdout));
  const events = server.events().filter((event) => event.type === "add");
  expect(events).toHaveLength(1);
  return Schema.decodeUnknownSync(AddV3, { onExcessProperty: "error" })(events[0]);
}
const manifestAt = (root: string) =>
  Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8")));
const editManifest = (root: string, edit: (manifest: Manifest) => Manifest) =>
  writeFileSync(join(root, MANIFEST_PATH), encodeManifest(edit(manifestAt(root))));
/** A user-root copy of `web-part`, which overrides the bundled part when `pair` composes. */
const userWebPart = () =>
  cpSync(
    join(workspaceRegistry, "stacks", "web-part"),
    join(home, "config", "stacks", "stacks", "web-part"),
    { recursive: true },
  );
const official = { user: 0, project: 0, source: 0 };

describe("telemetry for a workspace project", () => {
  test("an all-bundled workspace reports its fingerprint on new and add", async () => {
    const created = await scaffoldPair();
    expect(created).toMatchObject({ stack: "pair", origin: "bundled", nonOfficial: official });
    expect(created.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    const event = await addDb();
    expect(event).toMatchObject({ stack: "pair", origin: "bundled", nonOfficial: official });
    expect(event.fragments).toContain("db");
    expect(event.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("a bundled workspace over a user-root part counts the part as not official and reports no fingerprint", async () => {
    userWebPart();
    const created = await scaffoldPair();
    expect(created).toMatchObject({
      stack: "pair",
      origin: "bundled",
      nonOfficial: { user: 1, project: 0, source: 0 },
    });
    expect(created).not.toHaveProperty("fingerprint");
    const event = await addDb();
    expect(event).toMatchObject({ nonOfficial: { user: 1, project: 0, source: 0 } });
    expect(event).not.toHaveProperty("fingerprint");
  });

  test("an edited Manifest.parts ref claiming bundled is re-resolved to its real origin", async () => {
    userWebPart();
    await scaffoldPair();
    editManifest(project(), (manifest) => ({
      ...manifest,
      parts: (manifest.parts ?? []).map((part) => ({
        ...part,
        stack: { ...part.stack, origin: "bundled", trusted: true },
      })),
    }));
    const event = await addDb();
    expect(event).toMatchObject({ nonOfficial: { user: 1, project: 0, source: 0 } });
    expect(event).not.toHaveProperty("fingerprint");
  });

  test("a manifest whose parts differ from the registry workspace's gets no recomputed fingerprint", async () => {
    await scaffoldPair();
    renameSync(join(project(), "frontend"), join(project(), "client"));
    editManifest(project(), (manifest) => ({
      ...manifest,
      parts: (manifest.parts ?? []).map((part) =>
        part.name === "frontend" ? { ...part, name: "client" } : part,
      ),
    }));
    const event = await addDb();
    expect(event).toMatchObject({ stack: "pair", origin: "bundled", nonOfficial: official });
    expect(event).not.toHaveProperty("fingerprint");
  });
});
