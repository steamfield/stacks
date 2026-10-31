import { Schema } from "effect";
import { expect, test } from "vitest";
import { DependencyRollup, FragmentMeta, StackMeta, stackDependencies } from "../src/index.js";

const stack = (fragments: object, deps: object = {}) =>
  Schema.decodeUnknownSync(StackMeta, { onExcessProperty: "error" })({
    schema_version: 1,
    id: "s",
    kind: "stack",
    name: "S",
    description: "A stack.",
    deps,
    fragments,
  });

const fragment = (id: string, deps: object, requires: string[] = []) =>
  Schema.decodeUnknownSync(FragmentMeta, { onExcessProperty: "error" })({
    schema_version: 1,
    id,
    kind: "fragment",
    name: id,
    description: "A fragment.",
    category: "tooling",
    deps,
    requires,
  });

test("a stack's dependencies include its required and default fragments' and what they require, in declaration order", () => {
  const rollup = stackDependencies(
    stack({ required: ["db"], default: ["ci"] }, { test: ["testify"], cli: ["viper", "cobra"] }),
    [
      fragment("db", { runtime: ["pgx"] }, ["migrations"]),
      fragment("migrations", { runtime: ["goose"] }),
      fragment("ci", {}),
      fragment("unrelated", { runtime: ["never"] }),
    ],
  );
  expect(rollup).toEqual({
    included: [
      { role: "test", name: "testify", stack: true, fragments: [] },
      { role: "cli", name: "viper", stack: true, fragments: [] },
      { role: "cli", name: "cobra", stack: true, fragments: [] },
      { role: "runtime", name: "pgx", stack: false, fragments: ["db"] },
      { role: "runtime", name: "goose", stack: false, fragments: ["migrations"] },
    ],
    optional: [],
  });
  expect(Schema.decodeUnknownSync(DependencyRollup)(rollup)).toEqual(rollup);
});

test("a package several entries declare is listed once with every source", () => {
  const rollup = stackDependencies(stack({ default: ["b", "a"] }, { runtime: ["effect"] }), [
    fragment("a", { runtime: ["effect"] }),
    fragment("b", { runtime: ["effect"], test: ["effect"] }),
  ]);
  expect(rollup.included).toEqual([
    { role: "runtime", name: "effect", stack: true, fragments: ["a", "b"] },
    { role: "test", name: "effect", stack: false, fragments: ["b"] },
  ]);
});

test("optional fragments list only what they add, by id, and drop those that add nothing", () => {
  const rollup = stackDependencies(
    stack({ default: ["base"], optional: ["zed", "otel", "same"] }),
    [
      fragment("base", { runtime: ["effect"] }),
      fragment("otel", { runtime: ["effect", "otlp"] }, ["base", "tracing"]),
      fragment("tracing", { runtime: ["spans"] }),
      fragment("same", { runtime: ["effect"] }),
      fragment("zed", { cli: ["zed"] }),
    ],
  );
  expect(rollup.optional).toEqual([
    {
      fragment: "otel",
      deps: [
        { role: "runtime", name: "otlp", stack: false, fragments: ["otel"] },
        { role: "runtime", name: "spans", stack: false, fragments: ["tracing"] },
      ],
    },
    { fragment: "zed", deps: [{ role: "cli", name: "zed", stack: false, fragments: ["zed"] }] },
  ]);
});

test("missing fragments and requires cycles are skipped", () => {
  const rollup = stackDependencies(stack({ default: ["a", "gone"], optional: ["also-gone"] }), [
    fragment("a", { runtime: ["x"] }, ["b"]),
    fragment("b", { runtime: ["y"] }, ["a"]),
  ]);
  expect(rollup).toEqual({
    included: [
      { role: "runtime", name: "x", stack: false, fragments: ["a"] },
      { role: "runtime", name: "y", stack: false, fragments: ["b"] },
    ],
    optional: [],
  });
});
