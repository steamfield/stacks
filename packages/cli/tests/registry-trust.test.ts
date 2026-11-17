import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { fakeAgent } from "./helpers/agents";
import { quiet, runCli } from "./helpers/cli";
import { jsonResult } from "./helpers/create";
import { minimal, writeEntry } from "./helpers/registry";
import { readManifestAt, workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.each([
  { source: "project", origin: "project", fixture: ".stacks", trusted: false },
  { source: "user", origin: "user", fixture: "config/stacks", trusted: true },
  { source: "overridden bundled", origin: "bundled", fixture: "override", trusted: false },
])("new applies $source trust to launch and JSON", async ({ source, origin, fixture, trusted }) => {
  const home = realpathSync(space.dir());
  const registry = join(home, fixture);
  const entry = writeEntry({
    root: registry,
    kind: "stack",
    dir: "sample",
    frontmatter: minimal("stack", "sample"),
  });
  const agent = fakeAgent(join(home, "bin"), "claude");
  const options = {
    home,
    env: {
      ...quiet,
      PATH: dirname(agent.bin),
      ...(source === "overridden bundled" ? { STACKS_REGISTRY_DIR: registry } : {}),
    },
    host: { registry: join(home, "bundled"), stdoutIsTTY: true, stdinIsTTY: true },
  };
  const json = jsonResult(
    await runCli(["new", "sample", "json-app", "--json"], options),
    NewResult,
  );
  expect(json.untrusted).toEqual(
    trusted ? [] : [{ id: "sample", kind: "stack", origin, dir: entry }],
  );
  expect(json.handoff.untrusted).toEqual(trusted ? [] : ["sample"]);
  expect(agent.ran()).toBe(false);
  expect(readFileSync(join(json.project, json.brief), "utf8")).toContain("Guidance");

  const result = await runCli(["new", "sample", "human-app", "--launch", "claude"], options);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(trusted ? "Launching" : "Not launching an agent");
  expect(agent.ran()).toBe(trusted);
  expect(readManifestAt(join(home, "human-app"))).toMatchObject({
    stack: { id: "sample", origin, trusted },
    handoff: { kind: trusted ? "launch" : "print" },
  });
});
