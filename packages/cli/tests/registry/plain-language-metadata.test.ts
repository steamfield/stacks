import { join } from "node:path";
import { DependencyAllowlist, SearchMetadata } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { goAllowlistKey } from "../../src/core/deps/index";
import { ShowReport } from "../../src/schemas/show";
import { quiet, runCli } from "../helpers/cli";
import { cardPath, readJson } from "../helpers/search-metadata";
import { workspace } from "../helpers/verify";
import { bundled as bundledRoot } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());

// The bundled registry's zero-warning half of 4.5f#17 is asserted against the suite's one
// whole-registry report, in tests/registry/bundled-registry.test.ts.
// Listed once at collection so each entry gets its own row and timeout: as one test, the loop of
// shows took 12 s alone and ran past 60 s on a loaded CI shard.
const bundledListing = await runCli(["list", "--json"], {
  home: space.dir(),
  env: quiet,
  host: { registry: bundledRoot },
});
const bundledEntries =
  bundledListing.status === 0
    ? Schema.decodeUnknownSync((await import("../../src/schemas/list")).ListResult)(
        JSON.parse(bundledListing.stdout),
      ).entries
    : [];

test("list --json reads the bundled registry's entries [4.5f#17]", () => {
  expect(bundledListing.status, bundledListing.stderr).toBe(0);
  expect(bundledListing.stderr).toBe("");
  expect(bundledEntries.length).toBeGreaterThan(0);
});

test.each(bundledEntries)(
  "$kind/$id has plain copy and a card for every dependency it uses [4.5f#17]",
  async (entry) => {
    const card = Schema.decodeUnknownSync(SearchMetadata)(readJson(cardPath(bundledRoot, entry)));
    expect(card.plain).toBeDefined();
    const allow = Schema.decodeUnknownSync(DependencyAllowlist)(
      readJson(join(bundledRoot, "allowlist.json")),
    );
    const { DependencyCardFile } = await import("@steamfield/stacks-format");
    const shownRun = await runCli(["show", entry.id, "--kind", entry.kind, "--json"], {
      home: space.dir(),
      env: quiet,
      host: { registry: bundledRoot },
    });
    expect(shownRun.status, shownRun.stderr).toBe(0);
    expect(shownRun.stderr).toBe("");
    const shown = Schema.decodeUnknownSync(ShowReport)(JSON.parse(shownRun.stdout));
    for (const names of Object.values(shown.deps))
      for (const name of names) {
        const matched = (["npm", "pypi", "go", "crates"] as const).filter((ecosystem) => {
          return allow.names[ecosystem].includes(ecosystem === "go" ? goAllowlistKey(name) : name);
        });
        expect(matched, name).toHaveLength(1);
        const ecosystem = matched[0];
        if (ecosystem === undefined) throw new Error(`Missing allowlist ecosystem for ${name}`);
        const file = Schema.decodeUnknownSync(DependencyCardFile)(
          readJson(join(bundledRoot, "deps", `${ecosystem}.json`)),
        );
        const key = ecosystem === "go" ? goAllowlistKey(name) : name;
        expect(file.cards[key], `${ecosystem}/${key}`).toBeDefined();
      }
  },
  // A row loads the registry for its `show`: up to 0.9 s alone, several seconds on a loaded shard.
  15_000,
);

test("show go-cli includes the canonical go-yaml card and preserves its full import path", async () => {
  const root = bundledRoot;
  const home = space.dir();
  const result = await runCli(["show", "go-cli", "--json"], {
    home,
    env: quiet,
    host: { registry: root },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const report = Schema.decodeUnknownSync(ShowReport)(JSON.parse(result.stdout));
  const { DependencyCardFile } = await import("@steamfield/stacks-format");
  const file = Schema.decodeUnknownSync(DependencyCardFile)(readJson(join(root, "deps/go.json")));
  expect(report.deps.cli).toContain("go.yaml.in/yaml/v3");
  expect(file.cards["go.yaml.in/yaml"]).toBeDefined();
  expect(report.dependencyCards?.["go/go.yaml.in/yaml"]).toEqual(file.cards["go.yaml.in/yaml"]);
  const text = await runCli(["show", "go-cli"], { home, env: quiet, host: { registry: root } });
  expect(text.status, text.stderr).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(/^Dependencies \(cli\): .*go\.yaml\.in\/yaml\/v3$/m);
});
