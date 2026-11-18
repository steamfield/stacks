import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { quiet, runCli } from "./helpers/cli";
import { newWorkspace, workspaceRegistry } from "./helpers/workspace";

const PARTS = [
  { name: "backend", role: "api", stack: "api-part" },
  { name: "frontend", role: "web", stack: "web-part" },
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** `new <stack>` in the workspace fixture registry with extra flags; the decoded `--json` result. */
async function newJson(stack: string, ...flags: string[]) {
  const home = mkdtempSync(join(tmpdir(), "stacks-results-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const result = await runCli(
    ["new", stack, join(home, "app"), "--no-launch", "--json", ...flags],
    {
      home,
      env: { ...quiet, PATH: process.env.PATH ?? "" },
      host: { registry: workspaceRegistry },
    },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(result.stdout);
}

async function show(args: string[], env: Record<string, string> = {}) {
  const result = await runCli(["show", ...args], {
    env: { ...quiet, ...env },
    host: { registry: workspaceRegistry },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

const showJson = async (id: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(ShowReport))(await show([id, "--json"]));

describe("new --json for a workspace", () => {
  test("lists each part with its name, role and stack in parts order", async () => {
    const { result, target } = await newWorkspace();
    cleanups.push(() => rmSync(dirname(target), { recursive: true, force: true }));
    expect(result.status).toBe(0);
    const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(result.stdout);
    expect(decoded.stack).toBe("pair");
    expect(decoded.parts).toEqual(PARTS);
  });

  test("a dry run carries the same parts", async () => {
    const decoded = await newJson("pair", "--dry-run");
    expect(decoded.dryRun).toBe(true);
    expect(decoded.parts).toEqual(PARTS);
  });

  test("a stack without parts has no parts key at all", async () => {
    const decoded = await newJson("api-part");
    expect("parts" in decoded).toBe(false);
  });
});

describe("show for a workspace", () => {
  test("--json lists the parts and a stack without parts has none", async () => {
    expect((await showJson("pair")).parts).toEqual(PARTS);
    expect("parts" in (await showJson("api-part"))).toBe(false);
  });

  test("agent text names every part on one line", async () => {
    const text = await show(["pair"]);
    expect(text.split("\n")).toContain("Parts: backend (api, api-part), frontend (web, web-part)");
  });

  test("text for a stack without parts has no Parts line", async () => {
    expect((await show(["api-part"])).split("\n").some((line) => line.startsWith("Parts:"))).toBe(
      false,
    );
  });
});

describe("stacks schema", () => {
  test.each(["new", "show"])("%s documents the optional parts field", async (name) => {
    const result = await runCli(["schema", name, "--json"]);
    expect(result.status).toBe(0);
    const document = JSON.parse(result.stdout) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(document.properties.parts).toMatchObject({ type: "array" });
    expect(document.required).not.toContain("parts");
  });
});
