import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { fixture, privateKey, readBuild } from "../fixtures/index/harness";
import { commitAt, entryRefs, readDirectory } from "../helpers/directory";
import { succeeded } from "../helpers/official-names";
import { workspace } from "../helpers/verify";

const space = workspace();
afterEach(() => space.release());

import { bundled } from "./helpers/bundled";

const BundledRemovals = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Record(
    Schema.String,
    Schema.Struct({
      kind: Schema.Literals(["stack", "fragment"]),
      replacedBy: Schema.optionalKey(Schema.String),
    }),
  ),
});

test("bundled removal rows name retired ids and current replacements [4.2c#5]", () => {
  const removals = Schema.decodeUnknownSync(BundledRemovals)(
    JSON.parse(readFileSync(join(bundled, "removed.json"), "utf8")) as unknown,
  );
  const current = (kind: "stack" | "fragment", id: string) =>
    existsSync(join(bundled, kind === "stack" ? "stacks" : "fragments", id));
  for (const [id, row] of Object.entries(removals.entries)) {
    expect(current(row.kind, id), `${row.kind}/${id} is still bundled`).toBe(false);
    if (row.replacedBy !== undefined)
      expect(
        current("stack", row.replacedBy) || current("fragment", row.replacedBy),
        `${id}: replacement ${row.replacedBy} is not bundled`,
      ).toBe(true);
  }
});

test("the bundled registry's current entries build a signed directory [4.2c#5]", async () => {
  const f = await fixture(space.dir());
  rmSync(f.registry, { recursive: true });
  cpSync(bundled, f.registry, { recursive: true });
  // The fixture has no release tags, so a removal row's last published content can't resolve.
  writeFileSync(join(f.registry, "removed.json"), '{ "schemaVersion": 1, "entries": {} }\n');
  commitAt(f, "2026-11-06T12:00:00Z", "fixture: bundled registry");
  // Spawns a full-registry index build: ~50 s loaded, 57 s on CI; allow ~3x CI's cost.
  succeeded(
    await f.invoke(["--out", f.out, "--previous", "none", "--key", privateKey], {
      timeout: 150_000,
    }),
  );
  const directory = await readDirectory(f.out);
  expect(directory.removed).toEqual([]);
  // The bundled ledger proves no stack today, so the index may be empty; the rows still match.
  const { index } = await readBuild(f.out);
  expect(entryRefs(directory.entries)).toEqual(entryRefs(index.entries));
}, 180_000);
