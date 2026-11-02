import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

export function tempDir() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "stacks-mcp-")));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
