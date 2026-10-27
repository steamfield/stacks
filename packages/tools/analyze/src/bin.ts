#!/usr/bin/env bun
import { parse } from "./cli";
import { exitCode, type Outcome, usageError } from "./errors";
import { main } from "./main";
import { defaultWriters } from "./output";

const controller = new AbortController();
const abort = (): void => controller.abort();
process.on("SIGINT", abort);
process.on("SIGTERM", abort);

try {
  const result = parse(process.argv.slice(2));
  if (!result.ok) {
    await defaultWriters.stderr(`error: ${result.reason}\n`);
    process.exitCode = exitCode(usageError(result.reason));
  } else {
    const outcome: Outcome = await main(result.parsed);
    process.exitCode = exitCode(outcome);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unexpected defect";
  await defaultWriters.stderr(`error: ${message}\n`);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", abort);
  process.off("SIGTERM", abort);
}
