import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Manifest } from "@steamfield/stacks-format";
import { Exit, Schema } from "effect";
import { afterEach, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { quiet, runCli, tempDir } from "./helpers/cli";
import { bundledAt, composeExit } from "./helpers/compose";
import { reviewSearchFixture } from "./helpers/search-fixture";

const registry = join(import.meta.dirname, "../registry");
const dirs: ReturnType<typeof tempDir>[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) dir.cleanup();
});
function workspace() {
  const dir = tempDir();
  dirs.push(dir);
  return dir.path;
}
const Settings = Schema.Struct({
  hooks: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        matcher: Schema.optionalKey(Schema.String),
        hooks: Schema.Array(Schema.Struct({ command: Schema.String })),
      }),
    ),
  ),
});

async function scaffold(stack: string) {
  const home = workspace();
  const bundled = join(home, "bundled");
  cpSync(registry, bundled, { recursive: true });
  reviewSearchFixture(bundled);
  const cwd = join(home, "unrelated cwd");
  mkdirSync(cwd);
  const result = await runCli(
    [
      "new",
      stack,
      "project",
      "--with",
      "claude-harness",
      "--agents",
      "claude",
      "--no-launch",
      "--json",
    ],
    {
      home,
      env: { ...quiet, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1" },
      host: { registry: bundled, cwd },
    },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const decoded = Schema.decodeUnknownSync(NewResult)(JSON.parse(result.stdout));
  expect(decoded.git).toBe("fresh");
  return { decoded, project: join(cwd, "project") };
}

// validate's budget rows for these pairings are asserted against the suite's one whole-registry
// report, in tests/bundled-registry.test.ts.
test("astro-blog composes one destructive hook and single-owner files with the harness [3.4a#1]", async () => {
  const { decoded, project } = await scaffold("astro-blog");
  expect(decoded.fragments.filter((id) => id === "claude-harness")).toHaveLength(1);
  expect(decoded.fragments).toContain("agent-ops");
  expect(decoded.warnings).toEqual([]);
  const settings = Schema.decodeUnknownSync(Settings)(
    JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8")),
  );
  const bashHooks = (settings.hooks.PreToolUse ?? [])
    .filter((group) => group.matcher?.split("|").includes("Bash"))
    .flatMap((group) => group.hooks.map((hook) => hook.command));
  expect(
    bashHooks.filter(
      (command) =>
        command.includes("/block-destructive.sh") || command.includes("/guard-commands.ts"),
    ),
  ).toEqual([expect.stringContaining("/block-destructive.sh")]);
  const commands = Object.values(settings.hooks).flatMap((groups) =>
    groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
  );
  expect(new Set(commands).size).toBe(commands.length);

  const exit = await composeExit(
    { stack: "astro-blog", with: ["claude-harness"], agents: ["claude"] },
    { roots: bundledAt(registry) },
  );
  if (Exit.isFailure(exit)) throw new Error(`composition failed: ${JSON.stringify(exit.cause)}`);
  expect(new Set(exit.value.files.map((file) => file.path)).size).toBe(exit.value.files.length);
  for (const file of exit.value.files) {
    if (file.kind !== "merge") expect(file.owners, file.path).toHaveLength(1);
    expect(decoded.written).toContain(file.path);
  }
  expect(exit.value.files.find((file) => file.path === ".claude/settings.json")?.owners).toEqual(
    expect.arrayContaining([
      { kind: "fragment", id: "agent-ops" },
      { kind: "fragment", id: "claude-harness" },
    ]),
  );
  const manifest = Schema.decodeUnknownSync(Manifest)(
    JSON.parse(readFileSync(join(project, ".stacks/manifest.json"), "utf8")),
  );
  expect(manifest.fragments.map((fragment) => fragment.id)).toEqual(decoded.fragments);
}, 30_000);

test("explicit --with on Go keeps the harness and warns, without a Go validation pairing [3.4a#4]", async () => {
  const { decoded, project } = await scaffold("go-cli");
  expect(decoded.fragments).toContain("claude-harness");
  expect(decoded.warnings).toEqual([{ code: "with_not_applicable", id: "claude-harness" }]);
  expect(decoded.written).toContain(".claude/hooks/guard-commands.ts");
  expect(readFileSync(join(project, ".claude/hooks/guard-commands.ts"), "utf8")).not.toBe("");
}, 30_000);
