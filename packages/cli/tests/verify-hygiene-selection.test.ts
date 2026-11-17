import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { decodeResult, splitEvents, verify, workspace, writeProject } from "./helpers/verify";

const space = workspace();
afterEach(() => space.release());

test.each([
  {
    flags: ["--only", "base,app-check", "--skip-tag", "slow"],
    stages: { base: "partial", app: null },
    baseReason: "tagged slow; --skip-tag leaves it out",
    appReason: "the base did not fully run; the app stage waits for a full verify",
    ran: [],
  },
  {
    flags: ["--skip-tag", "slow"],
    stages: { base: "green", app: "green" },
    baseReason: "a hygiene check; --all or --only <name> runs it",
    appReason: undefined,
    ran: ["app-check"],
  },
  {
    flags: ["--only", "base,app-check"],
    stages: { base: "green", app: "green" },
    baseReason: undefined,
    appReason: undefined,
    ran: ["base", "app-check"],
  },
])("verify $flags reports which stages and checks ran", async (example) => {
  const root = space.dir();
  writeProject(root, [
    { name: "base", tags: ["hygiene", "slow"], run: "touch ran-base" },
    { name: "app-check", tags: ["app"], run: "touch ran-app-check" },
  ]);

  const result = await verify([...example.flags, "--json"], { cwd: root });

  expect(result.status).toBe(0);
  const report = decodeResult(result.stdout);
  expect(report).toMatchObject({
    outcome: "partial",
    scope: "partial",
    stages: example.stages,
    totals: { passed: example.ran.length, failed: 0, skipped: 2 - example.ran.length },
  });
  expect(report.steps.map(({ name, status, reason }) => [name, status, reason])).toEqual([
    ["base", example.baseReason ? "skipped" : "passed", example.baseReason],
    ["app-check", example.appReason ? "skipped" : "passed", example.appReason],
  ]);
  const { events, rest } = splitEvents(result.stderr);
  expect(rest).toBe("");
  expect(events.map(({ event, name }) => [event, name])).toEqual(
    example.ran.flatMap((name) => [
      ["step-started", name],
      ["step-finished", name],
    ]),
  );
  expect(existsSync(join(root, "ran-base"))).toBe(example.ran.some((name) => name === "base"));
  expect(existsSync(join(root, "ran-app-check"))).toBe(
    example.ran.some((name) => name === "app-check"),
  );
});
