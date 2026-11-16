/** Stack guards keep servers and interactive tools out of foreground agent calls. */
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  agentOps,
  allowed,
  bashPayload,
  composedSettings,
  denied,
  fixture,
  noted,
  registry,
  run,
  withoutTool,
  writePayload,
} from "./helpers/shipped-hooks";

const rows = [
  {
    stack: "go-library",
    hook: "guard-library.sh",
    deny: ["go test -fuzz FuzzParse"],
    reason: "-fuzztime",
    allow: "go test -fuzz FuzzParse -fuzztime 10s",
  },
  {
    stack: "go-mcp",
    hook: "guard-mcp.sh",
    deny: ["npx @modelcontextprotocol/inspector ./bin/server"],
    reason: "--cli",
    allow: "npx @modelcontextprotocol/inspector --cli ./bin/server",
  },
  {
    stack: "go-tui",
    hook: "guard-tui.sh",
    deny: ["script -q /dev/null ./bin/app"],
    reason: "make test",
    allow: "script -q /dev/null ./bin/app --json",
  },
  {
    stack: "python-data",
    hook: "guard-python-data.sh",
    deny: ["uv run marimo edit notebooks/report.py"],
    reason: "make notebooks",
  },
  {
    stack: "quarkus-api",
    hook: "guard-maven.sh",
    deny: ["./mvnw quarkus:dev", "quarkus dev"],
    reason: "make test",
  },
  {
    stack: "rust-tui",
    hook: "guard-tui.sh",
    deny: ["script -q /dev/null cargo run"],
    reason: "make test",
    allow: "script -q /dev/null cargo run --json",
  },
  {
    stack: "spring-boot-api",
    hook: "guard-maven.sh",
    deny: ["./mvnw spring-boot:run"],
    reason: "background",
  },
  {
    stack: "spring-boot-web",
    hook: "guard-spring-web.sh",
    deny: ["./mvnw spring-boot:run"],
    reason: "background",
  },
  {
    stack: "streamlit",
    hook: "guard-streamlit.sh",
    deny: ["uv run streamlit run app.py", "make dev"],
    reason: "make test",
  },
  {
    stack: "nuxt",
    hook: "guard-nuxt-commands.sh",
    deny: ["bun run dev", "nuxt dev", "node .output/server/index.mjs", "npx nuxi@latest preview"],
    reason: "run_in_background",
  },
  {
    stack: "typescript-mcp",
    hook: "guard-typescript-mcp-commands.sh",
    deny: ["bun run inspect", "npx @modelcontextprotocol/inspector"],
    reason: "--cli",
    allow: "mcp-inspector --cli node dist/index.js",
  },
  {
    stack: "hono-api",
    hook: "guard-hono-api-commands.sh",
    deny: ["bun run dev"],
    reason: "run_in_background",
  },
  {
    stack: "nestjs-api",
    hook: "guard-nestjs-api-commands.sh",
    deny: ["bunx nest start --watch", "bun run dev"],
    reason: "run_in_background",
  },
  {
    stack: "typescript-api",
    hook: "guard-api-commands.sh",
    deny: ["bun run dev"],
    reason: "bun run dev:bg",
  },
];
const space = fixture();
const prepared = new Map<string, { root: string; command: string }>();
let noJq: string, noAwk: string;
beforeAll(async () => {
  noJq = withoutTool(space.path, "jq");
  noAwk = withoutTool(space.path, "awk");
  for (const row of rows) {
    const root = join(space.path, row.stack);
    const hooks = join(root, ".claude/hooks");
    mkdirSync(hooks, { recursive: true });
    mkdirSync(join(root, "tmp"));
    symlinkSync(join(agentOps, "files/.claude/hooks/_lib.sh"), join(hooks, "_lib.sh"));
    const entry = join(registry, "stacks", row.stack);
    const source = row.stack === "typescript-api" ? "files" : "adapters/claude";
    symlinkSync(join(entry, source, ".claude/hooks", row.hook), join(hooks, row.hook));
    const settings = await composedSettings(row.stack);
    const command = (settings.hooks.PreToolUse ?? [])
      .filter((group) => !group.matcher || new RegExp(group.matcher).test("Bash"))
      .flatMap((group) => group.hooks)
      .find((hook) => hook.command.includes(`/${row.hook}"`))?.command;
    if (!command) throw new Error(`Missing wired guard for ${row.stack}`);
    prepared.set(row.stack, { root, command });
  }
});
afterAll(() => space.cleanup());
function project(stack: string) {
  const value = prepared.get(stack);
  if (!value) throw new Error(`Unprepared stack: ${stack}`);
  return value;
}

test.concurrent.each(rows)(
  "$stack denies its foreground tools, permits bounded work, and fails open",
  async (row) => {
    const { root, command } = project(row.stack);
    for (const text of row.deny) {
      expect(denied(await run(root, command, bashPayload(root, text))), text).toContain(row.reason);
    }
    const text = row.deny[0];
    if (!text) throw new Error("No foreground example");
    allowed(await run(root, command, bashPayload(root, `timeout 5 ${text}`)));
    allowed(await run(root, command, bashPayload(root, `${text} &`)));
    if (row.allow) allowed(await run(root, command, bashPayload(root, row.allow)));
    noted(await run(root, command, bashPayload(root, text), { path: noJq }));
    noted(await run(root, command, bashPayload(root, text), { path: noAwk }));
    noted(await run(root, command, "{broken", { raw: true }));
    const copy = space.copy(root);
    rmSync(join(copy, ".claude/hooks/_lib.sh"));
    noted(await run(copy, command, bashPayload(copy, text)));
  },
);

test("the inventory exercises each distinct anti-hang artifact once", () => {
  const scripts = readdirSync(join(registry, "stacks"), { recursive: true, withFileTypes: true })
    .filter((file) => file.isFile() && file.name.startsWith("guard-") && file.name.endsWith(".sh"))
    .map((file) => join(file.parentPath, file.name));
  const distinct = new Set(scripts.map((path) => readFileSync(path, "utf8")));
  expect(scripts.map((path) => relative(registry, path))).toHaveLength(15);
  expect(distinct.size).toBe(rows.length);
  const tested = rows.map((row) =>
    readFileSync(join(project(row.stack).root, ".claude/hooks", row.hook), "utf8"),
  );
  expect(new Set(tested)).toEqual(distinct);
});

test.concurrent.each([
  { name: "AND and OR chains", texts: ["bun run dev && echo ready", "bun run dev || echo failed"] },
  {
    name: "the first position of a long command list",
    texts: [`bun run dev; ${"echo ready; ".repeat(80)}`],
  },
  {
    name: "a wrapped executable path with spaces",
    texts: ['env PORT=3000 "/opt/tool suite/bun" run dev'],
  },
  { name: "an unbounded timeout", texts: ["timeout 0 bun run dev"] },
  {
    name: "lists whose later background marker or earlier deadline only bounds another command",
    texts: ["bun run dev; true &", "timeout 5 true; bun run dev"],
  },
])("still denies foreground execution in $name", async ({ texts }) => {
  const { root, command } = project("hono-api");
  for (const text of texts)
    expect(denied(await run(root, command, bashPayload(root, text)))).toContain(
      "run_in_background",
    );
});
test("heredoc bodies are data, and commands after the delimiter are inspected", async () => {
  const { root, command } = project("hono-api");
  const text = "cat <<'EOF'\nbun run dev\nEOF\n";
  allowed(await run(root, command, bashPayload(root, text)));
  expect(denied(await run(root, command, bashPayload(root, `${text}bun run dev`)))).toContain(
    "run_in_background",
  );
});
test("conventions and generated-file edits pass through stack settings", async () => {
  const { root, command } = project("hono-api");
  allowed(await run(root, command, bashPayload(root, "bun test")));
  allowed(
    await run(root, command, {
      ...bashPayload(root, "bun run dev"),
      tool_input: { command: "bun run dev", run_in_background: true },
    }),
  );
  allowed(
    await run(root, command, writePayload(root, "dist/generated.ts", "export const value = 1;")),
  );
});
