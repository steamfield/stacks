import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEvalReport } from "./lib/eval-report";

const models = ["synthetic/model-a", "synthetic/model-b"];
const maxBytes = 1024 * 1024;

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/OPENROUTER|OPENAI/i.test(key)),
  );
}

async function readReport(path: string): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("report");
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error("report");
    return JSON.parse(buffer.subarray(0, length).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}

async function checkpoint() {
  const handoff = await mkdtemp(join(tmpdir(), "eval-check-"));
  try {
    const reportPath = join(handoff, "report.json");
    const started = Date.now();
    // Inherit verify's process group. No detached launcher or independent signal policy.
    const child = spawnSync(
      process.execPath,
      [
        "--no-env-file",
        "scripts/eval.ts",
        "--dry-run",
        "--models",
        models.join(","),
        "--report",
        reportPath,
      ],
      { env: childEnvironment(), stdio: "ignore" },
    );
    const childFailed = Boolean(child.error) || child.status !== 0;
    if (childFailed) {
      console.error("eval runner: unsuccessful exit");
      console.error(
        "Inspect the runner with bun --no-env-file scripts/eval.ts --dry-run --models synthetic/model-a,synthetic/model-b --report <path>",
      );
    }
    let value: unknown;
    try {
      value = await readReport(reportPath);
    } catch {
      console.error("eval report: missing, unreadable, symlink, oversized or invalid JSON");
      return 1;
    }
    const { report, issues } = validateEvalReport(value, models);
    if (report) {
      if (report.mode !== "stub") issues.push("mode: expected stub");
      const created = Date.parse(report.createdAt);
      // UTC ISO reports may omit fractional seconds.
      if (created < Math.floor(started / 1000) * 1000 || created > Date.now())
        issues.push("createdAt: stale or future report");
      await mkdir(".eval/results", { recursive: true });
      const result = `.eval/results/${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`;
      await writeFile(result, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
      console.log(result);
    }
    for (const issue of issues) console.error(`eval report: ${issue}`);
    return issues.length === 0 && !childFailed ? 0 : 1;
  } finally {
    await rm(handoff, { recursive: true, force: true });
  }
}

try {
  process.exitCode = await checkpoint();
} catch {
  console.error("eval checkpoint: unable to run or retain report");
  process.exitCode = 1;
}
