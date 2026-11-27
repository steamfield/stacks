import { cpSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ErrorEnvelope } from "../src/errors";
import { ValidateReport } from "../src/schemas/validate";
import { VERSION } from "../src/version";
import { quiet, runCli } from "./helpers/cli";
import { emptyRegistry } from "./helpers/registry";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const metadata = { formatVersion: 1, minCli: VERSION };
const newerMinCli = VERSION.replace(
  /^(\d+)\.(\d+)\..*$/,
  (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`,
);

function writeAllowlist(root: string) {
  writeFileSync(
    join(root, "allowlist.json"),
    JSON.stringify({
      formatVersion: 1,
      generatedAt: "2026-10-28T00:00:00Z",
      names: { npm: [], pypi: [], go: [], crates: [] },
    }),
  );
}

async function validateRegistry(options: { official: boolean; contents?: string }) {
  const home = realpathSync(space.dir());
  const bundled = join(home, "bundled");
  cpSync(emptyRegistry, bundled, { recursive: true });
  writeAllowlist(bundled);
  writeFileSync(join(bundled, "registry.json"), JSON.stringify(metadata));

  const root = join(home, "registry fixture café");
  mkdirSync(join(root, "stacks"), { recursive: true });
  if (options.official) writeAllowlist(root);
  if (options.contents !== undefined) writeFileSync(join(root, "registry.json"), options.contents);

  const result = await runCli(["validate", root, "--json"], {
    home,
    env: quiet,
    host: { registry: bundled },
  });
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(ValidateReport))(result.stdout);
  return { ...result, findings: report.findings };
}

test.each([
  { label: "is missing", contents: undefined },
  { label: "contains invalid JSON", contents: "{" },
  {
    label: "has the wrong formatVersion",
    contents: JSON.stringify({ ...metadata, formatVersion: 2 }),
  },
  { label: "has an extra key", contents: JSON.stringify({ ...metadata, extra: true }) },
  { label: "has a malformed minCli", contents: JSON.stringify({ ...metadata, minCli: "0.0" }) },
  {
    label: "requires a newer CLI",
    contents: JSON.stringify({ ...metadata, minCli: newerMinCli }),
  },
])(
  "validate reports one error when an official root's registry.json $label",
  async ({ contents }) => {
    const result = await validateRegistry({ official: true, contents });

    expect(result.findings).toMatchObject([{ file: "registry.json", severity: "error" }]);
    expect(result.status).toBe(2);
    const { error } = Schema.decodeUnknownSync(Schema.fromJsonString(ErrorEnvelope))(result.stderr);
    expect(error.tag).toBe("ValidationFailed");
  },
);

test.each([
  { label: "equal to", minCli: VERSION },
  { label: "below", minCli: "0.9.0" },
])("validate accepts an official root with minCli $label the CLI version", async ({ minCli }) => {
  const result = await validateRegistry({
    official: true,
    contents: JSON.stringify({ ...metadata, minCli }),
  });

  expect(result.findings).toEqual([]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
});

test.each([
  { label: "missing", contents: undefined },
  { label: "malformed", contents: "{" },
])("validate ignores $label registry.json at a root without an allowlist", async ({ contents }) => {
  const result = await validateRegistry({ official: false, contents });

  expect(result.findings).toEqual([]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
});
