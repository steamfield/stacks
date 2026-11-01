import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { runCli } from "./helpers/cli";
import { newRegistry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.each([
  ["c1-go-docker", "C1_GO_DOCKER"],
  ["web3-app", "WEB3_APP"],
])("new keeps digits attached in %s and its env prefix", async (name, prefix) => {
  const home = space.dir();
  const result = await runCli(
    ["new", "fixture-stack", "--name", name, "--scope", "@acme", "--json"],
    {
      home,
      host: { registry: newRegistry },
    },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const created = Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  expect(basename(created.project)).toBe(name);
  const readme = readFileSync(join(created.project, "README.md"), "utf8");
  expect(readme).toContain(`- slug: ${name}\n`);
  expect(readme).toContain(`- env: ${prefix}_PORT\n`);
  expect(readme).toContain("- scope: acme\n");
});

test("the brief header prints the project slug and env prefix in one line", async () => {
  const home = space.dir();
  const result = await runCli(["new", "fixture-stack", "app", "--name", "My App", "--json"], {
    home,
    host: { registry: newRegistry },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  const brief = readFileSync(join(home, "app", ".stacks", "BRIEF.md"), "utf8");
  expect(brief.split("## Your job")[0]).toContain(
    "- Project slug: `my-app`; env prefix: `MY_APP`\n",
  );
});
