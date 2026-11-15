import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { REPO } from "../helpers/hooks";

const fragment = join(REPO, "packages/cli/registry/fragments/claude-harness/files/.claude/hooks");

// See docs/harness.md, "Repo hooks and shipped hooks", for the intentionally separate hooks.
test.each(["_lib.ts"])("%s stays byte-identical in the shipped harness", (file) => {
  expect(
    readFileSync(join(REPO, ".claude/hooks", file)).equals(readFileSync(join(fragment, file))),
    `${file} drifted: edit one copy, then copy it to the other (.claude/hooks/ and ${fragment}).`,
  ).toBe(true);
});
