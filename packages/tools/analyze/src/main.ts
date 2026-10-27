import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { helpText, type Parsed } from "./cli";
import { readAttribution } from "./core/attribution";
import { computeDigest } from "./core/digest";
import { computeInventory } from "./core/inventory";
import { assemble, DRIVER_VERSION } from "./core/run";
import { DEFAULT_TOOLS_JSON_PATH, runTools } from "./core/tools";
import { inputError, type Outcome, ok } from "./errors";
import { defaultWriters, type Writers } from "./output";
import type { SarifLog } from "./schemas/sarif";
import { sarifSchemaUri, validateSarif } from "./schemas/sarif";

export type MainOptions = {
  readonly writers?: Writers;
  readonly toolsJsonPath?: string;
};

async function emit(parsed: Parsed, writers: Writers, toolsJsonPath: string): Promise<Outcome> {
  if (parsed.help) {
    await writers.stdout(`${helpText()}\n`);
    return ok(false);
  }
  if (parsed.version) {
    await writers.stdout(`${DRIVER_VERSION}\n`);
    return ok(false);
  }

  const target = isAbsolute(parsed.target) ? parsed.target : resolve(process.cwd(), parsed.target);
  if (!existsSync(target)) {
    return inputError(`Target path does not exist: ${parsed.target}`);
  }
  let targetStat: ReturnType<typeof statSync>;
  try {
    targetStat = statSync(target);
  } catch {
    return inputError(`Target path is not readable: ${parsed.target}`);
  }
  if (!targetStat.isDirectory()) {
    return inputError(`Target path is not a directory: ${parsed.target}`);
  }

  const outputFile = parsed.out !== undefined ? resolve(parsed.out) : undefined;
  const digest = computeDigest(target, {
    excludeGlobs: parsed.exclude,
    outputFile,
  });
  const metrics = computeInventory(target, parsed.exclude);
  const { attribution, warning } = readAttribution(target, parsed.label);
  if (warning !== undefined) {
    await writers.stderr(`warning: ${warning}\n`);
  }

  const {
    ledger,
    runs: toolRuns,
    adapterOrder,
  } = await runTools(target, parsed.tool, toolsJsonPath);

  const sarifInputs: { id: string; log: SarifLog }[] = [];
  for (let i = 0; i < parsed.sarif.length; i += 1) {
    const file = parsed.sarif[i];
    if (file === undefined) continue;
    const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
    if (!existsSync(abs)) {
      await writers.stderr(`warning: --sarif file not found: ${file}\n`);
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(abs, "utf8");
    } catch {
      await writers.stderr(`warning: --sarif file unreadable: ${file}\n`);
      continue;
    }
    let parsedLog: unknown;
    try {
      parsedLog = JSON.parse(raw);
    } catch {
      await writers.stderr(`warning: --sarif file is not JSON: ${file}\n`);
      continue;
    }
    const validation = validateSarif(parsedLog);
    if (!validation.ok) {
      await writers.stderr(`warning: --sarif ${file}: ${validation.reason}\n`);
      continue;
    }
    sarifInputs.push({ id: `sarif:${file}`, log: validation.log });
  }

  const createdAt = new Date().toISOString();
  const compactUtc = createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runId = `run-${compactUtc}-${randomUUID().slice(0, 8)}`;
  const log = assemble({
    targetAbs: target,
    digest,
    metrics,
    attribution,
    tools: ledger,
    adapterOrder,
    toolRuns,
    sarifInputs,
    createdAt,
    runId,
  });

  const serialized = `${JSON.stringify(log)}\n`;

  if (outputFile !== undefined) {
    const dir = dirname(outputFile);
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${outputFile}.tmp-${process.pid}`;
      writeFileSync(tmp, serialized, "utf8");
      try {
        renameSync(tmp, outputFile);
      } catch {
        if (existsSync(tmp)) {
          try {
            unlinkSync(tmp);
          } catch {
            // ignore
          }
        }
        return inputError(`Could not write output file: ${outputFile}`);
      }
    } catch {
      return inputError(`Could not write output file: ${outputFile}`);
    }
    return ok(true);
  }

  await writers.stdout(serialized);
  return ok(true);
}

export async function main(parsed: Parsed, options?: MainOptions): Promise<Outcome> {
  const writers = options?.writers ?? defaultWriters;
  const toolsJsonPath = options?.toolsJsonPath ?? DEFAULT_TOOLS_JSON_PATH;
  try {
    return await emit(parsed, writers, toolsJsonPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected defect";
    await writers.stderr(`error: ${message}\n`);
    return { ok: false, kind: "defect", message };
  }
}

export { sarifSchemaUri };
