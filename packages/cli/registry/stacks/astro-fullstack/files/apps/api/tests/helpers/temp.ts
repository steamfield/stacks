import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "api-test-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
