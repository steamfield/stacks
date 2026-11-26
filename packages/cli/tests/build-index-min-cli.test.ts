import { verify } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { VERSION } from "../src/version";
import {
  fixture,
  preserve,
  privateKey,
  publicKey,
  readBuild,
  snapshot,
} from "./fixtures/index/harness";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

const lowerMinCli = "0.9.0";
const newerMinCli = VERSION.replace(
  /^(\d+)\.(\d+)\..*$/,
  (_, major: string, minor: string) => `${major}.${Number(minor) + 1}.0`,
);
const metadata = { formatVersion: 1, minCli: VERSION };

// Each case copies a source workspace and runs real Git and Bun processes.
const buildTimeout = 30_000;

async function expectRegistryRejection(
  f: Awaited<ReturnType<typeof fixture>>,
  signingArgs: string[],
) {
  const result = await f.invoke(["--out", f.out, "--previous", "none", ...signingArgs]);
  expect(result.status).toBeGreaterThan(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/\bregistry\.json\b/);
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
  "build:index names registry.json and publishes no index when it $label",
  async ({ contents }) => {
    const f = await fixture(space.dir());
    const file = join(f.registry, "registry.json");
    if (contents === undefined) rmSync(file);
    else writeFileSync(file, contents);

    const signingArgs = contents === undefined ? ["--unsigned"] : ["--key", privateKey];
    await expectRegistryRejection(f, signingArgs);
    expect(existsSync(join(f.out, "v1/index.json"))).toBe(false);
  },
  buildTimeout,
);

test(
  "a signed build:index rebuild preserves existing output when registry.json is missing",
  async () => {
    const f = await fixture(space.dir());
    const before = preserve(f.out);
    rmSync(join(f.registry, "registry.json"));

    await expectRegistryRejection(f, ["--key", privateKey]);
    expect(snapshot(f.out)).toEqual(before);
  },
  buildTimeout,
);

test(
  "build:index signs a header with the registry's lower minCli",
  async () => {
    const f = await fixture(space.dir());
    writeFileSync(
      join(f.registry, "registry.json"),
      JSON.stringify({ ...metadata, minCli: lowerMinCli }),
    );

    const result = await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    expect(result.stderr).toBe("");
    const { envelope, index } = await readBuild(f.out);
    expect(index.minCli).toBe(lowerMinCli);
    expect(
      verify(
        null,
        Buffer.from(envelope.payload),
        publicKey,
        Buffer.from(envelope.signature, "base64"),
      ),
    ).toBe(true);
  },
  buildTimeout,
);
