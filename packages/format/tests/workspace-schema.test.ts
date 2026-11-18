import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { FragmentMeta, IndexEntry, Manifest, StackMeta } from "../src/index";

const decodeStack = (meta: unknown) =>
  Schema.decodeUnknownSync(StackMeta, { onExcessProperty: "error" })(meta);
const decodeManifest = (manifest: unknown) =>
  Schema.decodeUnknownSync(Manifest, { onExcessProperty: "error" })(manifest);
const decodeIndexEntry = (entry: unknown) =>
  Schema.decodeUnknownSync(IndexEntry, { onExcessProperty: "error" })(entry);

const stack = {
  schema_version: 1,
  id: "hono-react",
  kind: "stack",
  name: "Hono and React",
  description: "An API and a web client in one project.",
};
const parts = [
  { name: "backend", role: "api", stack: "hono-api" },
  { name: "frontend", role: "web", stack: "react-vite" },
];
const backend = parts[0];

test("a workspace stack decodes its parts in order", () => {
  expect(decodeStack({ ...stack, parts }).parts).toStrictEqual(parts);
});

test("a stack without parts decodes to the same value as before, with no parts key", () => {
  const decoded = decodeStack(stack);
  expect("parts" in decoded).toBe(false);
  // toStrictEqual fails on an added key even when its value is undefined, so this pins the
  // decoded shape that the CLI's fingerprints hash.
  expect(decoded).toStrictEqual({
    schemaVersion: 1,
    id: "hono-react",
    kind: "stack",
    name: "Hono and React",
    description: "An API and a web client in one project.",
    tags: [],
    deps: {},
    commands: {},
    tools: [],
    decisions: [],
    env: {},
    verify: [],
    merge: [],
    fragments: { required: [], default: [], optional: [] },
  });
  expect(Schema.encodeSync(StackMeta)(decoded)).not.toHaveProperty("parts");
});

test.each([
  ["an empty parts list", []],
  ["a part named ..", [{ ...backend, name: ".." }]],
  ["a part named .git", [{ ...backend, name: ".git" }]],
  ["a part named a/b", [{ ...backend, name: "a/b" }]],
  ["a part named Backend", [{ ...backend, name: "Backend" }]],
  ["a part with an empty name", [{ ...backend, name: "" }]],
  ["a part with an extra key", [{ ...backend, dir: "server" }]],
  ["a part without a role", [{ name: "backend", stack: "hono-api" }]],
  ["a part without a stack", [{ name: "backend", role: "api" }]],
  ["a part with a non-kebab role", [{ ...backend, role: "API" }]],
  ["a part with a non-kebab stack id", [{ ...backend, stack: "../hono-api" }]],
])("a stack with %s fails to decode", (_case, value) => {
  expect(() => decodeStack({ ...stack, parts: value })).toThrow(/parts/);
});

test("a fragment with category link decodes", () => {
  const meta = Schema.decodeUnknownSync(FragmentMeta, { onExcessProperty: "error" })({
    schema_version: 1,
    id: "openapi-client",
    kind: "fragment",
    name: "OpenAPI client",
    description: "A generated client for the API part.",
    category: "link",
    applies_to: ["react-vite"],
  });
  expect(meta.category).toBe("link");
});

const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/manifest.json"), "utf8"),
);
const manifestParts = [
  { name: "backend", role: "api", stack: { id: "hono-api", origin: "bundled", trusted: true } },
  { name: "frontend", role: "web", stack: { id: "react-vite", origin: "user", trusted: true } },
];

test("a manifest with parts round-trips", () => {
  const value = { ...manifest, parts: manifestParts };
  const decoded = decodeManifest(value);
  expect(decoded).toStrictEqual(value);
  expect(Schema.encodeSync(Manifest)(decoded)).toStrictEqual(value);
});

test("a manifest without parts has no parts key", () => {
  const decoded = decodeManifest(manifest);
  expect("parts" in decoded).toBe(false);
  expect(decoded).toStrictEqual(manifest);
});

test("a manifest part with a role this version doesn't know decodes", () => {
  const value = { ...manifest, parts: [{ ...manifestParts[0], role: "mobile-native" }] };
  expect(decodeManifest(value)).toStrictEqual(value);
});

test.each([
  ["a name that isn't one kebab segment", { name: "../backend" }],
  ["an empty role", { role: "" }],
  ["a stack that isn't an entry ref", { stack: "hono-api" }],
  ["an extra key", { dir: "backend" }],
])("a manifest part with %s fails to decode", (_case, change) => {
  expect(() =>
    decodeManifest({ ...manifest, parts: [{ ...manifestParts[0], ...change }] }),
  ).toThrow(/parts/);
});

const digest = `sha256:${"a".repeat(64)}`;
const indexStack = {
  id: "hono-react",
  kind: "stack",
  schemaVersion: 1,
  name: "Hono and React",
  description: "An API and a web client in one project.",
  tags: [],
  digest,
  composition: { "openapi-client": digest },
};

test("an index stack entry decodes with and without part pins", () => {
  expect(decodeIndexEntry(indexStack)).toStrictEqual(indexStack);
  const pinned = { ...indexStack, parts: { backend: digest, frontend: digest } };
  expect(decodeIndexEntry(pinned)).toStrictEqual(pinned);
});

const { composition: _composition, ...indexMetadata } = indexStack;

test.each([
  [
    "a pin keyed by a part name that isn't kebab-case",
    { ...indexStack, parts: { "../x": digest } },
    /invalid part name/,
  ],
  ["a pin to a malformed digest", { ...indexStack, parts: { backend: "sha256:short" } }, /parts/],
  [
    "part pins on a fragment",
    { ...indexMetadata, kind: "fragment", parts: { backend: digest } },
    /fragments cannot carry/,
  ],
])("an index entry with %s fails to decode", (_case, entry, message) => {
  expect(() => decodeIndexEntry(entry)).toThrow(message);
});
