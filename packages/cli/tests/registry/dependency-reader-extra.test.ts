import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { readDependencies } from "../../src/core/deps/index";
import { workspace } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());

function put(root: string, relative: string, contents: string) {
  const file = join(root, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
}
test("the bundled allowlist reports go-yaml by its module key", async () => {
  const root = space.dir();
  put(root, "go.mod", "module example.com/app\nrequire go.yaml.in/yaml/v3 v3.0.4\n");
  const bundledAllowlist = Schema.decodeUnknownSync(Schema.fromJsonString(DependencyAllowlist))(
    readFileSync(join(bundled, "allowlist.json"), "utf8"),
  );
  expect(
    await Effect.runPromise(
      readDependencies(root, bundledAllowlist).pipe(Effect.provide(NodeServices.layer)),
    ),
  ).toEqual([{ ecosystem: "go", name: "go.yaml.in/yaml", major: "3" }]);
});
