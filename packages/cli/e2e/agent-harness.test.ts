import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NewResult } from "../src/schemas/new";
import { VerifyEvent, VerifyResult } from "../src/schemas/verify";

import { binary, scratchPath } from "./package";

const modules = join(import.meta.dir, "../node_modules");
const vitest = join(
  dirname(fileURLToPath(import.meta.resolve("vitest/package.json"))),
  "vitest.mjs",
);
const VerifyFailure = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.Literal("VerifyFailed"),
    message: Schema.String,
    retryable: Schema.Boolean,
  }),
});
const SuiteReport = Schema.Struct({
  success: Schema.Boolean,
  numPassedTests: Schema.Number,
  numFailedTests: Schema.Number,
  testResults: Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
});

test("the compiled binary ships a runnable hook suite and a harness-owned check step [3.4a#2]", async () => {
  const root = mkdtempSync(join(tmpdir(), "stacks-harness-"));
  try {
    const home = join(root, "home");
    mkdirSync(home);
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      PATH: `${scratchPath}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      NO_COLOR: "1",
      LOG_LEVEL: "none",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    async function run(argv: string[], cwd: string) {
      const child = Bun.spawn(argv, {
        cwd,
        env: { ...env, PATH: `${join(cwd, "node_modules/.bin")}:${env.PATH}` },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      });
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { status, stdout, stderr };
    }
    const scaffold = await run(
      [
        binary,
        "new",
        "astro-blog",
        "project café",
        "--with",
        "claude-harness",
        "--without",
        "git-hooks",
        "--agents",
        "claude",
        "--no-launch",
        "--json",
      ],
      root,
    );
    expect(scaffold.status).toBe(0);
    expect(scaffold.stderr).toBe("");
    const result = Schema.decodeUnknownSync(NewResult)(JSON.parse(scaffold.stdout));
    const project = result.project;
    expect(result.fragments).toContain("claude-harness");
    expect(result.warnings).toEqual([]);

    // Supply installed tooling only. All hook code and tests come from the compiled scaffold.
    symlinkSync(modules, join(project, "node_modules"), "dir");
    // Supply the conventional runner aliases an agent would add, using the installed toolchain.
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        scripts: {
          test: "vitest run tests/hooks",
          "test:unit": "vitest run",
          "test:hooks": "vitest run tests/hooks",
        },
      }),
    );
    // The agent normally writes Makefile. This fixture's install checks already supplied tools.
    writeFileSync(
      join(project, "Makefile"),
      ".PHONY: install test\ninstall:\n\ttest -x node_modules/.bin/vitest && test -x node_modules/.bin/tsc\ntest:\n\tvitest run tests/hooks\n",
    );
    const reportPath = join(root, "hooks-report.json");
    // The stack's own Vitest and TypeScript configs load framework packages this fixture doesn't
    // install; the hook suite needs neither.
    writeFileSync(join(project, "tsconfig.json"), "{}\n");
    writeFileSync(
      join(project, "vitest.config.ts"),
      'export default { test: { environment: "node", include: ["tests/hooks/**/*.test.ts"] } };\n',
    );
    const suite = await run(
      ["node", vitest, "run", "tests/hooks", "--reporter=json", `--outputFile=${reportPath}`],
      project,
    );
    expect(suite.status, `${suite.stdout}\n${suite.stderr}`).toBe(0);
    expect(suite.stderr).toBe("");
    const report = Schema.decodeUnknownSync(SuiteReport)(
      JSON.parse(readFileSync(reportPath, "utf8")),
    );
    expect(report.success).toBe(true);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPassedTests).toBeGreaterThan(0);
    expect(report.testResults.length).toBeGreaterThanOrEqual(4);
    for (const file of report.testResults) {
      expect(file.name.startsWith(`${project}/tests/hooks/`)).toBe(true);
      expect(file.status).toBe("passed");
    }
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(readFileSync(join(project, ".stacks/manifest.json"), "utf8")),
    );
    const steps = manifest.verify.filter(
      (step) =>
        step.owner === "claude-harness" && step.name === "harness-hooks" && step.layer === "check",
    );
    expect(steps.length).toBeGreaterThan(0);
    const selection = [
      binary,
      "verify",
      "--only",
      steps.map((step) => step.name).join(","),
      "--json",
    ];
    const verify = await run(selection, project);
    expect(verify.status, verify.stderr).toBe(0);
    const verified = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(verify.stdout));
    // Stderr holds only live events (closed decode), one started per step that ran.
    const events = verify.stderr
      .trimEnd()
      .split("\n")
      .map((line) =>
        Schema.decodeUnknownSync(VerifyEvent)(JSON.parse(line), { onExcessProperty: "error" }),
      );
    expect(events.flatMap((event) => (event.event === "step-started" ? [event.name] : []))).toEqual(
      verified.steps.filter((step) => step.status !== "skipped").map((step) => step.name),
    );
    expect(verified.outcome).toBe("partial");
    expect(verified.totals.failed).toBe(0);
    expect(
      verified.steps
        .filter((step) => step.phase === "setup")
        .every((step) => step.status === "passed"),
    ).toBe(true);
    expect(
      verified.steps
        .filter(
          (step) => steps.some((owned) => owned.name === step.name) && step.status === "passed",
        )
        .map((step) => step.name),
    ).toEqual(steps.map((step) => step.name));

    const shippedTest = report.testResults[0]?.name;
    if (!shippedTest) throw new Error("the shipped hook suite reported no test files");
    const original = readFileSync(shippedTest, "utf8");
    try {
      writeFileSync(
        shippedTest,
        `${original}\nthrow new Error("acceptance: copied hook test must fail");\n`,
      );
      const failed = await run(selection, project);
      expect(failed.status).toBe(5);
      // Every line but the last is a live event; the last is the one envelope.
      const lines = failed.stderr.trimEnd().split("\n");
      for (const line of lines.slice(0, -1))
        Schema.decodeUnknownSync(VerifyEvent)(JSON.parse(line), { onExcessProperty: "error" });
      Schema.decodeUnknownSync(VerifyFailure)(JSON.parse(lines.at(-1) ?? ""));
      const failure = Schema.decodeUnknownSync(VerifyResult)(JSON.parse(failed.stdout));
      expect(failure.outcome).toBe("failed");
      expect(
        failure.steps
          .filter((step) => step.phase === "setup")
          .every((step) => step.status === "passed"),
      ).toBe(true);
      expect(
        failure.steps.filter(
          (step) => steps.some((owned) => owned.name === step.name) && step.status === "failed",
        ).length,
      ).toBeGreaterThan(0);
    } finally {
      writeFileSync(shippedTest, original);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
