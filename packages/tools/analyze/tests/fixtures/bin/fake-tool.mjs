#!/usr/bin/env node
// A single fake analyzer used by the test suite. Mode is selected by argv so
// every behavioural case (valid SARIF, non-zero exit with findings, failure,
// malformed JSON, wrong SARIF version, timeout) shares one binary and one
// payload definition — change the fixture here, not in six shell scripts.

import { setTimeout as sleep } from "node:timers/promises";

const SARIF_VERSION = "2.1.0";
const SCHEMA_URI =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json";
const TOOL_VERSION = "9.9.9";

const FINDING = {
  ruleId: "FAKE-R1",
  level: "note",
  message: { text: "fake finding" },
  locations: [{ physicalLocation: { artifactLocation: { uri: "src/add.ts" } } }],
};

const FINDING_RUN = {
  tool: { driver: { name: "fake-tool", version: TOOL_VERSION } },
  results: [FINDING],
  artifacts: [{ location: { uri: "src/add.ts" } }],
};

const EMPTY_RUN = {
  tool: { driver: { name: "fake-tool", version: TOOL_VERSION } },
  results: [],
};

function sarifLog(run) {
  return JSON.stringify({ version: SARIF_VERSION, $schema: SCHEMA_URI, runs: [run] });
}

function parseMode(argv) {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith("--mode=")) {
      return arg.slice("--mode=".length);
    }
  }
  return "valid";
}

const mode = parseMode(process.argv.slice(2));

if (process.argv.includes("--version")) {
  process.stdout.write(`${TOOL_VERSION}\n`);
  process.exit(0);
}

switch (mode) {
  case "valid":
    process.stdout.write(`${sarifLog(FINDING_RUN)}\n`);
    process.exit(0);
    break;
  case "findings":
    process.stdout.write(`${sarifLog(FINDING_RUN)}\n`);
    process.exit(1);
    break;
  case "fail":
    process.stderr.write("fake tool failed intentionally\n");
    process.exit(2);
    break;
  case "malformed":
    process.stdout.write('{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"fake-tool"');
    process.exit(0);
    break;
  case "invalid-version":
    process.stdout.write(
      `${JSON.stringify({
        version: "2.0.0",
        runs: [{ tool: { driver: { name: "wrong-version" } }, results: [] }],
      })}\n`,
    );
    process.exit(0);
    break;
  case "slow":
    // Stay alive long enough for the runner's timeout and process-group kill.
    await sleep(30000);
    process.stdout.write(`${sarifLog(EMPTY_RUN)}\n`);
    process.exit(0);
    break;
  default:
    process.stderr.write(`unknown mode: ${mode}\n`);
    process.exit(2);
    break;
}
