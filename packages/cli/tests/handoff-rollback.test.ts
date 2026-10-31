import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Command } from "effect/cli";
import { expect, test } from "vitest";
import { cli } from "../src/cli";
import { ErrorEnvelope } from "../src/errors";
import { VERSION } from "../src/version";
import {
  PICKER_PROMPT,
  pickerCli,
  pickerManifest,
  pickerTTY,
  pickerWorkspace,
} from "./helpers/picker";

function executable(file: string, body: string) {
  writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  chmodSync(file, 0o755);
}

function appWorkspace(incomplete: boolean) {
  const workspace = pickerWorkspace();
  mkdirSync(join(workspace.home, "Applications", "Codex.app"), { recursive: true });
  executable(
    join(workspace.bin, "open"),
    `const fs = require("node:fs");
fs.writeFileSync("../before.json", fs.readFileSync(".stacks/manifest.json"));
fs.chmodSync(${JSON.stringify(incomplete ? ".stacks" : ".stacks/manifest.json")}, ${incomplete ? "0o555" : "0o000"});
process.exit(9);`,
  );
  return workspace;
}

const command = (harness: string) =>
  Command.runWith(cli, { version: VERSION, renderErrors: false })([
    "new",
    "picker-stack",
    "app",
    "--sandbox",
    "--launch",
    harness,
  ]);

function unlock(workspace: ReturnType<typeof pickerWorkspace>) {
  chmodSync(join(workspace.project, ".stacks"), 0o755);
  chmodSync(join(workspace.project, ".stacks", "manifest.json"), 0o644);
}

test.skipIf(process.getuid?.() === 0)(
  "a failed app fallback record reports its original error and incomplete manifest rollback as JSON",
  async () => {
    const workspace = appWorkspace(true);
    const manifest = join(workspace.project, ".stacks", "manifest.json");
    try {
      // Main's args choose JSON rendering; the supplied program still parses the real launch command.
      const result = await pickerCli(workspace, ["--json"], {
        program: command("codex-app"),
        host: { ...pickerTTY, platform: "darwin" },
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
        onExcessProperty: "error",
      });
      expect(envelope.error).toMatchObject({
        tag: "PermissionDenied",
        message: "Permission denied.",
        details: { reason: "unwritable", path: manifest },
        rollback: { incomplete: [manifest] },
      });
      expect(readFileSync(manifest, "utf8")).toBe(
        readFileSync(join(workspace.home, "before.json"), "utf8"),
      );
    } finally {
      unlock(workspace);
      workspace.cleanup();
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an app fallback's incomplete rollback is reported before Next in agent output",
  async () => {
    const workspace = appWorkspace(true);
    const manifest = join(workspace.project, ".stacks", "manifest.json");
    try {
      const result = await pickerCli(workspace, [], {
        program: command("codex-app"),
        host: { ...pickerTTY, platform: "darwin" },
        env: { CI: "1" },
      });
      expect(result.status).toBe(6);
      // The launch summary was flushed before open failed; it cannot be withdrawn.
      expect(result.stdout).toContain("Opening the Codex app on app...");
      expect(result.stdout).not.toContain(PICKER_PROMPT);
      expect(result.stderr).toContain("Permission denied.");
      const lines = result.stderr.trimEnd().split("\n");
      expect(lines.at(-2)).toBe(`  Rollback incomplete: check ${manifest} before retrying.`);
      expect(lines.at(-1)).toMatch(/^\s*Next:/);
      expect(readFileSync(manifest, "utf8")).toBe(
        readFileSync(join(workspace.home, "before.json"), "utf8"),
      );
    } finally {
      unlock(workspace);
      workspace.cleanup();
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an app fallback record failure with nothing left to restore still prints the handoff and succeeds",
  async () => {
    const workspace = appWorkspace(false);
    const manifest = join(workspace.project, ".stacks", "manifest.json");
    try {
      const result = await pickerCli(workspace, [], {
        program: command("codex-app"),
        host: { ...pickerTTY, platform: "darwin" },
        env: { CI: "1" },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Opening the Codex app on app...");
      expect(result.stdout).toContain(PICKER_PROMPT);
      unlock(workspace);
      expect(readFileSync(manifest, "utf8")).toBe(
        readFileSync(join(workspace.home, "before.json"), "utf8"),
      );
      expect(pickerManifest(workspace.project).handoff).toMatchObject({
        kind: "launch",
        agent: "codex",
      });
    } finally {
      unlock(workspace);
      workspace.cleanup();
    }
  },
);

test.skipIf(process.getuid?.() === 0)(
  "an EACCES terminal launch reports incomplete fallback rollback with the launch PermissionDenied envelope",
  async () => {
    const workspace = pickerWorkspace();
    const manifest = join(workspace.project, ".stacks", "manifest.json");
    const interpreter = join(workspace.home, "blocked-interpreter");
    writeFileSync(interpreter, "not executable\n");
    chmodSync(interpreter, 0o644);
    const agent = join(workspace.bin, "codex");
    writeFileSync(agent, `#!${interpreter}\n`);
    chmodSync(agent, 0o755);
    // git init is the last scaffold step; lock the completed metadata before the launch.
    unlinkSync(join(workspace.bin, "git"));
    executable(
      join(workspace.bin, "git"),
      `const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const result = spawnSync("/usr/bin/git", args, { stdio: "inherit" });
if (args[0] === "init" && result.status === 0) {
  fs.writeFileSync("../before.json", fs.readFileSync(".stacks/manifest.json"));
  fs.chmodSync(".stacks", 0o555);
}
process.exit(result.status ?? 1);`,
    );
    try {
      const result = await pickerCli(workspace, ["--json"], {
        program: command("codex"),
      });
      expect(result.status).toBe(6);
      expect(result.stdout).toBe("");
      const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(JSON.parse(result.stderr), {
        onExcessProperty: "error",
      });
      expect(envelope.error).toMatchObject({
        tag: "PermissionDenied",
        details: { reason: "launch", path: agent },
        rollback: { incomplete: [manifest] },
      });
      expect(readFileSync(manifest, "utf8")).toBe(
        readFileSync(join(workspace.home, "before.json"), "utf8"),
      );
    } finally {
      unlock(workspace);
      workspace.cleanup();
    }
  },
);
