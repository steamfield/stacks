import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { withSdk } from "./helpers/session";

it("cancelling verify stops its step and leaves the server answering tools/list", () =>
  withSdk(async ({ client, box }) => {
    const entry = join(box.env.XDG_CONFIG_HOME, "stacks/stacks/cancellation");
    mkdirSync(entry, { recursive: true });
    writeFileSync(
      join(entry, "STACK.md"),
      `---
schema_version: 1
id: cancellation
kind: stack
name: Cancellation project
description: A project with a long-running verification step.
tags: [node]
verify:
  - { name: wait, run: "node sleeper.mjs", layer: test }
---

# Cancellation project

Run the verification step.
`,
    );
    const dir = join(box.root, "cancellation project");
    const created = await client.callTool({
      name: "stacks_new",
      arguments: { stack: "cancellation", dir, preset: "sandbox" },
    });
    expect(created.isError).toBeFalsy();
    writeFileSync(
      join(dir, "sleeper.mjs"),
      `
import { writeFileSync } from "node:fs";
writeFileSync("step.pid", String(process.pid));
setInterval(() => {}, 1000);
`,
    );
    const controller = new AbortController();
    const request = client.callTool({ name: "stacks_verify", arguments: { dir } }, undefined, {
      signal: controller.signal,
      timeout: 15_000,
    });
    const cancelled = expect(request).rejects.toThrow("cancel verification");
    try {
      const pidFile = join(dir, "step.pid");
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 5000 });
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      controller.abort(new Error("cancel verification"));
      await cancelled;
      await vi.waitFor(
        () => {
          expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
        },
        { timeout: 10_000 },
      );
      const listed = await client.listTools({}, { timeout: 5000 });
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "stacks_list",
        "stacks_new",
        "stacks_verify",
      ]);
    } finally {
      controller.abort();
      await cancelled;
    }
  }));
