// Fixtures for the shipped development script smoke tests.
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO = realpathSync(join(import.meta.dirname, "../.."));

export function makeFixture(...scripts: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "dev-tooling-"));
  mkdirSync(join(dir, "scripts"));
  for (const file of scripts) copyFileSync(join(REPO, "scripts", file), join(dir, "scripts", file));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
