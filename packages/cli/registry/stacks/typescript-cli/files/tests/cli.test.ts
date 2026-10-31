import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BrokenPipe, ErrorEnvelope, errorClasses, errorEnvelope, exitCodeFor } from "../src/errors";
import { DoctorResult } from "../src/schemas/doctor";
import { ndjson, runCli, tempDir } from "./helpers/cli";

describe("stdout and error contracts", () => {
  it.each([
    { flags: ["--json=true"], json: true },
    { flags: ["--json", "false"], json: false },
    { flags: ["--json=false"], json: false },
    { flags: ["--json", "yes"], json: true },
    { flags: ["--no-json"], json: false },
  ])("uses the parsed boolean audience $flags", async ({ flags, json }) => {
    for (const command of ["doctor", "absent"]) {
      const result = await runCli([command, ...flags], { env: { LOG_LEVEL: "none" } });
      expect(result.status).toBe(command === "doctor" ? 0 : 2);
      if (command === "doctor") {
        expect(result.stderr).toBe("");
        if (json)
          expect(Schema.decodeUnknownSync(DoctorResult)(JSON.parse(result.stdout))).toMatchObject({
            greeting: "Hello, world!",
          });
        else expect(result.stdout).toContain("Greeting: Hello, world!");
      } else {
        expect(result.stdout).toBe("");
        if (json) expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "Usage" } });
        else expect(result.stderr).toBe("Invalid command. Run --help for usage.\n");
      }
    }
  });

  it.each([
    { flags: ["-v"], key: "version" },
    { flags: ["--version", "--help"], key: "help" },
    { flags: ["--version", "false", "--help"], key: "help" },
  ])("renders the framework action actually selected $flags", async ({ flags, key }) => {
    const result = await runCli(["--json", ...flags], { env: { LOG_LEVEL: "none" } });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(Object.keys(JSON.parse(result.stdout))).toEqual([key]);
  });

  it("rejects the unsupported built-in log-level flag", async () => {
    const result = await runCli(["doctor", "--log-level", "none", "--json"], {
      env: { LOG_LEVEL: "none" },
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { tag: "Usage" } });
  });
  it.each(
    [[], ["--help"], ["--version"], ["--json", "--help"], ["--json", "--version"]].map((args) => ({
      args,
    })),
  )("help and version survive broken config %j", async ({ args }) => {
    const home = await tempDir();
    const dir = join(home, "config", "test-cli");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), "broken");
    const result = await runCli(args, { home, env: { LOG_LEVEL: "none" } });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("\u001b");
    if (args.includes("--json"))
      expect(JSON.parse(result.stdout)).toHaveProperty(
        args.includes("--version") ? "version" : "help",
      );
    else expect(result.stdout).toContain(args.includes("--version") ? "dev" : "doctor");
  });

  it("renders the same diagnostic in human and JSON modes", async () => {
    const human = await runCli(["doctor"], { env: { LOG_LEVEL: "none" } });
    expect(human.status).toBe(0);
    expect(human.stderr).toBe("");
    expect(human.stdout).toContain("Greeting: Hello, world!");
    const json = await runCli(["doctor", "--json"], { env: { LOG_LEVEL: "none" } });
    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    expect(Schema.decodeUnknownSync(DoctorResult)(JSON.parse(json.stdout))).toMatchObject({
      greeting: "Hello, world!",
      configError: null,
    });
  });

  it.each([["unknown"], ["doctor", "--unknown"], ["doctor", "extra"]].map((args) => ({ args })))(
    "usage failures keep stdout empty %j",
    async ({ args }) => {
      for (const json of [false, true]) {
        const result = await runCli([...args, ...(json ? ["--json"] : [])], {
          env: { LOG_LEVEL: "none" },
        });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        if (json)
          expect(Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr))).toMatchObject({
            error: { tag: "Usage", retryable: false },
          });
        else expect(result.stderr).toBe("Invalid command. Run --help for usage.\n");
      }
    },
  );

  for (const Class of errorClasses)
    it(`renders ${new Class()._tag} through the real boundary`, async () => {
      const error = new Class();
      const result = await runCli(["--json"], {
        program: Effect.fail(error),
        env: { LOG_LEVEL: "none" },
      });
      expect(result.status).toBe(exitCodeFor(error));
      expect(result.stdout).toBe("");
      if (error instanceof BrokenPipe) expect(result.stderr).toBe("");
      else expect(JSON.parse(result.stderr)).toEqual(errorEnvelope(error));
    });

  it("a defect logs once without exposing its private message", async () => {
    const result = await runCli(["--json"], {
      program: Effect.die(new TypeError("PRIVATE_SENTINEL")),
      env: { LOG_LEVEL: "debug" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    const records = ndjson(result.stderr);
    expect(
      records.filter((value) => JSON.stringify(value).includes('"msg":"defect"')),
    ).toHaveLength(1);
    expect(records[0]).toMatchObject({ trace: expect.stringContaining("TypeError\nat ") });
    expect(records.at(-1)).toMatchObject({ error: { tag: "Defect" } });
    expect(result.stderr).not.toContain("PRIVATE_SENTINEL");
  });

  it("quietly accepts a closed output pipe", async () => {
    const result = await runCli(["doctor"], {
      stdout: async () => {
        throw Object.assign(new Error("closed"), { code: "EPIPE" });
      },
    });
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("quietly accepts a closed error pipe", async () => {
    const result = await runCli(["absent", "--json"], {
      env: { LOG_LEVEL: "none" },
      stderr: async () => {
        throw Object.assign(new Error("closed"), { code: "EPIPE" });
      },
    });
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});
