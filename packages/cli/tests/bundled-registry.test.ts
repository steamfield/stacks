import { join } from "node:path";
import { Schema } from "effect";
import { beforeAll, expect, test } from "vitest";
import { ValidateReport } from "../src/schemas/validate";
import { quiet, runCli } from "./helpers/cli";

// The registry that ships with the CLI: every entry in it must validate with zero errors and zero
// warnings, and resolve only inside itself. Notes never fail this gate.
//
// This is the suite's one validation of the whole bundled registry, so its cost grows with the
// registry only here. Other tests that need a whole-registry property assert it against this
// report; a test about one entry validates that entry alone.
const bundled = join(import.meta.dirname, "..", "registry");

let result: Awaited<ReturnType<typeof runCli>>;
let report: ValidateReport;
beforeAll(async () => {
  result = await runCli(["validate", "--json"], {
    env: { ...quiet, PATH: process.env.PATH ?? "" },
    host: { registry: bundled },
  });
  report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  // This walks every shipped entry and composition; concurrent gates can exceed Vitest's 5 s.
}, 60_000);

test("the bundled registry validates with zero errors and zero warnings [1.5#14] [1.6a#1] [1.6d#7] [3.3b#2]", () => {
  expect(report.root).toBe(bundled);
  expect(report.bundled).toBe(true);
  expect(report.findings.filter((finding) => finding.severity !== "note")).toEqual([]);
  expect(result.status).toBe(0);
});

const composed = (entry: string) =>
  report.sizes.filter((row) => row.kind === "composed" && row.entry === entry);

test("validate budgets astro-blog with claude-harness in both presets [3.4a#1]", () => {
  expect(
    composed("astro-blog")
      .filter((row) => row.with === "claude-harness")
      .map((row) => row.preset)
      .sort(),
  ).toEqual(["default", "sandbox"]);
});

test("validate budgets go-cli without pairing it with claude-harness [3.4a#4]", () => {
  expect(composed("go-cli").length).toBeGreaterThan(0);
  expect(
    report.sizes.filter((row) => row.entry === "go-cli" && row.with === "claude-harness"),
  ).toEqual([]);
});
