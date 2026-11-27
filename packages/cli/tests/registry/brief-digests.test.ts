import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { rewriteDigests } from "../../scripts/brief-digests";
import { workspace } from "../helpers/verify";
import { briefDigests } from "./fixtures/bundled-brief-digests";

const space = workspace();
afterEach(() => space.release());

const defaultKey = "go-cli:default";
const sandboxKey = "go-cli:sandbox";
const incorrect = `sha256:${"0".repeat(64)}`;
const comment = `/** An example digest row.
  "${defaultKey}": "${incorrect}",
*/
`;
const rows = `
export const briefDigests: Readonly<Record<string, string>> = {
  "${defaultKey}": "${incorrect}",
  "${sandboxKey}": "${briefDigests[sandboxKey]}",
};
`;

test("rewrites a stale digest and preserves a current digest and the fixture comment", () => {
  const file = join(space.dir(), "brief digests.ts");
  writeFileSync(file, comment + rows);

  rewriteDigests(file);

  expect(readFileSync(file, "utf8")).toBe(
    comment +
      rows.replace(
        `  "${defaultKey}": "${incorrect}",`,
        `  "${defaultKey}": "${briefDigests[defaultKey]}",`,
      ),
  );
}, 15_000);

test("names a missing brief key and leaves the fixture intact", () => {
  const file = join(space.dir(), "brief digests.ts");
  const missing = "missing-stack:default";
  const contents = rows.replace(
    `"${sandboxKey}": "${briefDigests[sandboxKey]}"`,
    `"${missing}": "${incorrect}"`,
  );
  writeFileSync(file, contents);

  expect(() => rewriteDigests(file)).toThrow(missing);
  expect(readFileSync(file, "utf8")).toBe(contents);
}, 15_000);
