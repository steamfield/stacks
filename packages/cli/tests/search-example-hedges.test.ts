import { realpathSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { ValidateReport } from "../src/schemas/validate";
import { quiet, runCli } from "./helpers/cli";
import { cardPath, put, seed, stamp } from "./helpers/search-metadata";
import { workspace } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());
const ref = { kind: "stack", id: "sample" } as const;
const clean = {
  title: "Log summary command",
  description: "A command that summarizes log files by level, as a table for people or JSON.",
};

/** Validates a bundled root whose one card carries `examples`, and returns its hedge findings. */
async function hedgeFindings(examples: ReadonlyArray<{ title: string; description: string }>) {
  const home = realpathSync(space.dir());
  const root = join(home, "bundled");
  seed(root, ref);
  const card = await stamp(root, ref);
  put(cardPath(root, ref), JSON.stringify({ ...card, projectExamples: examples }));
  const result = await runCli(["validate", "--json"], {
    home,
    env: quiet,
    host: { registry: root },
  });
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  expect(result.status, result.stderr).toBe(
    report.findings.some(({ severity }) => severity === "error") ? 2 : 0,
  );
  return report.findings
    .filter(({ check }) => check === "example-hedged")
    .map(({ severity, message }) => ({ severity, message }));
}

const warning = (position: number, phrase: string) => ({
  severity: "warning",
  message: `Project example ${position} reads as instructions or a disclaimer ("${phrase}"); describe the finished project and put limits in caveats.`,
});

test.each([
  ["illustrative", "An illustrative command that summarizes log files."],
  ["separately", "A deployed site. Configure the credentials separately."],
  ["yourself", "A landing page. Create the project yourself."],
  ["still the project's", "A JSON API. Access control is still the project's work."],
  ["remain separate", "A directory. Authentication and moderation remain separate decisions."],
  ["you write the", "A landing page, where you write the copy."],
  ["must be filled", "A contributor guide. The guide must be filled from the project."],
  ["before using it", "A signup site. Add storage before using it for real signups."],
  ["before sharing", "A tracker. Add sign-in before sharing it."],
  ["before launch", "A data browser. Add CORS on the API before launch."],
  ["need additional", "A notebook. Photos need additional implementation."],
  ["replace the", "A pricing service; replace the notes resource with price rules."],
])("an example that says %j is example-hedged", async (phrase, description) => {
  expect(await hedgeFindings([{ ...clean, description }])).toEqual([warning(1, phrase)]);
});

test("matching ignores case and names the phrase as written", async () => {
  expect(
    await hedgeFindings([{ ...clean, description: "AN ILLUSTRATIVE command for logs." }]),
  ).toEqual([warning(1, "ILLUSTRATIVE")]);
});

test("a phrase inside a longer word is not a hedge", async () => {
  expect(
    await hedgeFindings([{ ...clean, description: "Illustratively, it prints counts per level." }]),
  ).toEqual([]);
});

test("a hedge in the title is reported, and each example is reported at its own position", async () => {
  expect(
    await hedgeFindings([clean, { ...clean, title: "Illustrative log command" }, clean]),
  ).toEqual([warning(2, "Illustrative")]);
});

test("a card whose examples describe finished projects has no hedge findings", async () => {
  expect(await hedgeFindings([clean])).toEqual([]);
});
