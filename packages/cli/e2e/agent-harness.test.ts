import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { NewResult } from "../src/schemas/new";
import { VerifyEvent, VerifyResult } from "../src/schemas/verify";
import { binary, scratchPath } from "./package";

const VerifyFailure = Schema.Struct({
  error: Schema.Struct({
    tag: Schema.Literal("VerifyFailed"),
    message: Schema.String,
    retryable: Schema.Boolean,
  }),
});

test("the compiled binary ships hook smoke checks and no shared Vitest hook suite", async () => {
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
        env,
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
    // Go has no stack-owned hook tests, so this isolates the shared harness.
    const scaffold = await run(
      [
        binary,
        "new",
        "go-cli",
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
    expect(result.warnings).toEqual([{ code: "with_not_applicable", id: "claude-harness" }]);
    expect(existsSync(join(project, "tests/hooks"))).toBe(false);
    expect(existsSync(join(project, "tests/helpers/hooks.ts"))).toBe(false);
    const smoke = await run(["bash", ".claude/hooks/smoke.sh"], project);
    expect(smoke).toEqual({
      status: 0,
      stdout: "hooks-smoke: guards and hook configs OK\n",
      stderr: "",
    });
    // The agent normally writes the setup target; this fixture needs no installed tools.
    writeFileSync(join(project, "Makefile"), ".PHONY: install\ninstall:\n\t@true\n");
    const manifest = Schema.decodeUnknownSync(Manifest)(
      JSON.parse(readFileSync(join(project, ".stacks/manifest.json"), "utf8")),
    );
    const steps = manifest.verify.filter(
      (step) => step.owner === "agent-ops" && step.name === "hooks-smoke",
    );
    expect(steps.map((step) => step.name)).toEqual(["hooks-smoke"]);
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
    ).toEqual(["hooks-smoke"]);

    const smokePath = join(project, ".claude/hooks/smoke.sh");
    writeFileSync(smokePath, `${readFileSync(smokePath, "utf8")}\nexit 1\n`);
    const failed = await run(selection, project);
    expect(failed.status).toBe(5);
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
    expect(failure.steps.find((step) => step.name === "hooks-smoke")?.status).toBe("failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
