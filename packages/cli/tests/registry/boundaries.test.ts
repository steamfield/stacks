import { expect, test } from "vitest";
import { lint } from "./helpers/grit";

test.each(["typescript-cli"])(
  "%s starter Grit rejects console and misplaced env reads, allowing near misses",
  (stack) => {
    const plugin = `registry/stacks/${stack}/files/biome-plugins/boundaries.grit`;
    for (const { source, nearMiss, message } of [
      {
        source: 'console.log("x");',
        nearMiss: 'export const hint = "console.log(x)";',
        message: "never console",
      },
      {
        source: "export const value = process.env;",
        nearMiss: "export const value = process.env;",
        message: "Read environment",
      },
    ]) {
      const denied = lint("src/handlers.ts", source, plugin);
      expect(denied.stdout + denied.stderr).toContain(message);
      expect(denied.status).not.toBe(0);
      const allowed = lint("src/config.ts", nearMiss, plugin);
      expect(allowed.stdout + allowed.stderr).not.toContain(message);
      expect(allowed.status).toBe(0);
    }
  },
);
const mcpPlugin = "registry/stacks/typescript-mcp/files/biome-plugins/boundaries.grit";
test.each([
  ["a console call", 'console.log("x");', "console.log corrupts it", "tests/server.test.ts"],
  ["stdout", "export const value = process.stdout;", "stdout carries JSON-RPC", "scripts/a.ts"],
  ["process", "export const value = process.env;", "Only src/index.ts reads", "src/index.ts"],
  [
    "a transport",
    'import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"; export { StdioServerTransport };',
    "Transports start only in src/index.ts",
    "src/index.ts",
  ],
])(
  "typescript-mcp starter Grit rejects %s in src/server.ts and allows it in its place",
  (_name, source, message, allowedPath) => {
    const denied = lint("src/server.ts", source, mcpPlugin);
    expect(denied.stdout + denied.stderr).toContain(message);
    expect(denied.status).not.toBe(0);
    const allowed = lint(allowedPath, source, mcpPlugin);
    expect(allowed.stdout + allowed.stderr).not.toContain(message);
    expect(allowed.status).toBe(0);
  },
);
test("typescript-mcp starter Grit rejects the v1 SDK everywhere", () => {
  const source =
    'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"; export { McpServer };';
  for (const path of ["src/server.ts", "tests/server.test.ts"]) {
    const denied = lint(path, source, mcpPlugin);
    expect(denied.stdout + denied.stderr).toContain("is the v1 SDK");
    expect(denied.status).not.toBe(0);
  }
});
test.each([
  'import { McpServer } from "@modelcontextprotocol/server"; export { McpServer };',
  'export const hint = "process.stdout; process.exit(0); console.log(x); process.env";',
  "// console.log(process.env); process.exit(0); process.stdout",
])("typescript-mcp starter Grit allows the near miss %s", (source) => {
  const result = lint("src/server.ts", source, mcpPlugin);
  expect(result.stdout + result.stderr).not.toContain("plugin");
  expect(result.status).toBe(0);
});
