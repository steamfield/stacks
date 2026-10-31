import { describe, expect, it } from "vitest";
import { denyReason, edit, REPO, runHook, write } from "../helpers/hooks";

const check = (path: string, content: string) =>
  runHook("PreToolUse", "guard-boundaries", write(`${REPO}/${path}`, content));
const checkEdit = (path: string, content: string) =>
  runHook("PreToolUse", "guard-boundaries", edit(`${REPO}/${path}`, content));

const C = "packages/contract/src";
const A = "apps/api/src";
const W = "apps/web/src";

describe("workspace boundaries", () => {
  it.each([
    [`${C}/groups/orders.ts`, 'import { z } from "zod";'],
    [`${C}/groups/orders.ts`, 'import { readFile } from "node:fs";'],
    [`${C}/api.ts`, 'import { Orders } from "@acme/api";'],
    [`${C}/errors.ts`, "const level = process.env.LEVEL;"],
    [`${C}/errors.ts`, "console.log('x');"],
    [`${A}/handlers/orders.ts`, 'import { readFile } from "node:fs/promises";'],
    [`${A}/app.ts`, 'import { NodeHttpServer } from "@effect/platform-node";'],
    [`${A}/services/Store.ts`, "const p = Bun.file('x');"],
    [`${A}/app.ts`, "process.exitCode = 1;"],
    [`${A}/app.ts`, "const { argv } = process;"],
    [`${A}/services/Orders.ts`, "process.env.SECRET;"],
    [`${A}/config.ts`, "const e = process.env;"],
    [`${A}/services/Shell.ts`, 'import { $ } from "bun";'],
    [`.claude/worktrees/x/${A}/handlers/orders.ts`, 'import { readFile } from "node:fs";'],
    [`${A}/handlers/orders.ts`, "console.log('x');"],
    [`${A}/schemas/order.ts`, 'import { Schema } from "@effect/schema";'],
    [`${W}/islands/Stats.tsx`, 'import { Orders } from "@acme/api";'],
    [`${W}/islands/Stats.tsx`, 'import { x } from "../../../api/src/app.ts";'],
    [`${W}/islands/Stats.tsx`, 'const r = await fetch("/v1/stats");'],
    [`${W}/components/Thing.tsx`, "const k = process.env.KEY;"],
    [`${W}/lib/data.ts`, 'import { readFileSync } from "node:fs";'],
  ])("denies %s: %s", async (path, content) =>
    expect(denyReason(await check(path, content))).toBeDefined(),
  );
  it.each([
    [`${C}/api.ts`, 'import { HttpApi } from "effect/http-api";'],
    [`${C}/errors.test.ts`, 'import { expect, it } from "vitest";'],
    [`${A}/config.test.ts`, 'import { readFile } from "node:fs";'],
    [`${W}/islands/ApiStatus.test.tsx`, 'import { readFile } from "node:fs";'],
    [`${C}/api.ts`, 'import { OrderGroup } from "./groups/orders.ts";'],
    [`${C}/schemas/order.ts`, 'import { Schema } from "effect";'],
    [`${A}/platform/node.ts`, 'import { NodeHttpServer } from "@effect/platform-node";'],
    [`${A}/platform/node.ts`, "process.on('SIGTERM', () => {});"],
    [`${A}/platform/node.ts`, "const provider = ConfigProvider.fromEnv({ env: process.env });"],
    [`${A}/config.ts`, 'const port = Config.port("PORT_API");'],
    [`${A}/handlers/orders.ts`, '// import { readFile } from "node:fs";'],
    [`${A}/handlers/orders.ts`, 'const hint = "use node:fs";'],
    [`.claude/worktrees/x/${A}/platform/node.ts`, 'import { readFile } from "node:fs";'],
    [`${A}/handlers/orders.ts`, 'import { Api } from "@acme/contract";'],
    [`${A}/services/Orders.ts`, 'const step = "process the order";'],
    [`${W}/lib/api.ts`, 'const r = await fetch("/v1/stats");'],
    [`${W}/islands/Stats.tsx`, 'import { Api } from "@acme/contract";'],
    [`${W}/lib/config.ts`, "const key = import.meta.env.PUBLIC_KEY;"],
    ["apps/api/tests/helpers/server.ts", 'import { createServer } from "node:http";'],
    ["scripts/dev.ts", 'import { spawn } from "node:child_process";'],
  ])("allows %s: %s", async (path, content) =>
    expect(denyReason(await check(path, content))).toBeUndefined(),
  );
  it("checks an Edit's new text too", async () => {
    expect(
      denyReason(await checkEdit(`${C}/errors.test.ts`, 'import { expect } from "vitest";')),
    ).toBeUndefined();
    expect(
      denyReason(await checkEdit(`${A}/handlers/orders.ts`, 'import { readFile } from "node:fs";')),
    ).toBeDefined();
    expect(
      denyReason(await checkEdit(`${A}/handlers/orders.ts`, 'import { Schema } from "effect";')),
    ).toBeUndefined();
  });
});
