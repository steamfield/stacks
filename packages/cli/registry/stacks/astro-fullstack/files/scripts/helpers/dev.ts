// Fixtures for the shipped development scripts and boundary probes, independent of agent settings.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REPO = realpathSync(join(import.meta.dirname, "../.."));

export type Fixture = {
  dir: string;
  real: string;
  cleanup: () => void;
};

// Keep caches local while running the checkout's installed tools.
export function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "dev-tooling-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(join(REPO, "node_modules/.bin"), join(dir, "node_modules/.bin"));
  return {
    dir,
    real: realpathSync(dir),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
