import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DependencyAllowlist } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { entryPath, fixture, privateKey, proof } from "./fixtures/index/harness";
import { tempDir } from "./helpers/cli";
import { writeLedger } from "./helpers/ledger";
import { reviewSearchFixture } from "./helpers/search-fixture";

test.each([
  {
    name: "missing-public-package",
    names: { npm: ["react"], pypi: [], go: [], crates: [] },
    accepted: false,
  },
  {
    name: "example.com/mod/v2",
    names: { npm: [], pypi: [], go: ["example.com/mod"], crates: [] },
    accepted: true,
  },
  {
    name: "example.com/missing/v2",
    names: { npm: [], pypi: [], go: ["example.com/mod"], crates: [] },
    accepted: false,
  },
  {
    name: "example.com/mod/v2",
    names: { npm: ["example.com/mod"], pypi: [], go: [], crates: [] },
    accepted: false,
  },
  {
    name: "example.com/mod/v2",
    names: { npm: ["example.com/mod/v2"], pypi: [], go: ["example.com/mod"], crates: [] },
    accepted: true,
  },
])(
  "build:index checks the allowlist for $name (accepted: $accepted)",
  async ({ name, names, accepted }) => {
    const temporary = tempDir();
    try {
      const built = await fixture(temporary.path);
      const file = join(entryPath(built.registry, "stack", "sample"), "STACK.md");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(
          "tags: [scripts]",
          `tags: [scripts]\ndeps:\n  runtime: [${name}]`,
        ),
      );
      const allowlist = Schema.decodeUnknownSync(DependencyAllowlist)({
        formatVersion: 1,
        generatedAt: "2026-10-28T00:00:00Z",
        names,
      });
      writeFileSync(join(built.registry, "allowlist.json"), JSON.stringify(allowlist));
      if (accepted) {
        const ecosystem = names.npm.includes(name) ? "npm" : "go";
        const key = ecosystem === "go" ? "example.com/mod" : name;
        mkdirSync(join(built.registry, "deps"), { recursive: true });
        writeFileSync(
          join(built.registry, "deps", `${ecosystem}.json`),
          JSON.stringify({
            formatVersion: 1,
            cards: {
              [key]: {
                whatItIs: "A module.",
                source: { by: "author", reviewedAt: new Date().toISOString().slice(0, 10) },
              },
            },
          }),
        );
      }
      reviewSearchFixture(built.registry);
      writeLedger(built.registry, [await proof(built.registry)]);
      execFileSync("git", ["add", "packages/cli/registry"], { cwd: built.root });
      execFileSync("git", ["commit", "--quiet", "-m", "fixture: unknown dependency"], {
        cwd: built.root,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
      });
      const result = await built.invoke([
        "--out",
        built.out,
        "--previous",
        "none",
        "--key",
        privateKey,
      ]);
      if (accepted) {
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toBe("");
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("sample");
        expect(result.stderr).toContain(name);
      }
    } finally {
      temporary.cleanup();
    }
  },
  90_000,
);
