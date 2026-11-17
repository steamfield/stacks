import { sign } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DependencyAllowlist, TelemetryBatch } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import { keyId, privateKey, publicKey } from "./fixtures/index/harness";
import { runCli, tempDir } from "./helpers/cli";
import { registry, telemetryRoot, writeJson } from "./helpers/telemetry";
import { readManifestAt } from "./helpers/verify";

const allowlist = Schema.decodeUnknownSync(DependencyAllowlist)({
  formatVersion: 1,
  generatedAt: "2026-10-28T00:00:00Z",
  names: { npm: [], pypi: [], go: ["github.com/a/b"], crates: [] },
});
const payload = JSON.stringify(allowlist);
const envelope = {
  keyId,
  payload,
  signature: sign(null, Buffer.from(payload), readFileSync(privateKey)).toString("base64"),
};
const decodeBatch = Schema.decodeUnknownSync(TelemetryBatch, { onExcessProperty: "error" });
let temporary: ReturnType<typeof tempDir>;
let home: string;
let url: string;
let events: Array<TelemetryBatch["events"][number]>;
let close: () => Promise<void>;

beforeEach(async () => {
  temporary = tempDir();
  home = temporary.path;
  events = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/v1/allowlist.json") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(envelope));
      return;
    }
    if (pathname === "/v1/events") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      events.push(...decodeBatch(JSON.parse(Buffer.concat(chunks).toString("utf8"))).events);
      response.writeHead(202, { "Content-Type": "application/json" }).end('{"rejected":[]}');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing port");
  url = `http://127.0.0.1:${address.port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(async () => {
  await close();
  temporary.cleanup();
});

async function invoke(args: string[], cwd?: string, human = false, debug = false) {
  return runCli(args, {
    home,
    releaseBuild: true,
    apiUrl: url,
    allowlistKeys: [{ keyId, publicKey }],
    host: {
      registry,
      platform: "darwin",
      ...(cwd ? { cwd } : {}),
      ...(human ? { stdoutIsTTY: true } : {}),
    },
    env: {
      STACKS_TELEMETRY_URL: url,
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      PATH: process.env.PATH,
      LOG_LEVEL: "none",
      ...(debug ? { STACKS_TELEMETRY_DEBUG: "1" } : {}),
    },
  });
}
async function project() {
  writeJson(join(telemetryRoot(home), "notice.json"), {
    noticeShownAt: new Date().toISOString(),
    noticeVersion: 2,
  });
  const created = await invoke(["new", "go-cli", "project", "--json"]);
  expect(created.status).toBe(0);
  const root = join(home, "project");
  writeFileSync(
    join(root, "go.mod"),
    "module example.com/project\nrequire github.com/a/b/v2 v2.3.1\n",
  );
  return root;
}
function projectFile(root: string) {
  return join(telemetryRoot(home), "projects", `${readManifestAt(root).projectId}.json`);
}

test("a failed spool write does not advance the dependency report interval", async () => {
  const root = await project();
  const spool = join(telemetryRoot(home), "spool");
  rmSync(spool, { recursive: true, force: true });
  writeFileSync(spool, "blocked");
  const failedQueue = await invoke(["verify", "--json"], root);
  expect(failedQueue.status).toBe(0);
  expect(readFileSync(projectFile(root), "utf8")).not.toContain("depsSentAt");
  rmSync(spool);
  mkdirSync(spool);
  expect((await invoke(["verify", "--json"], root)).status).toBe(0);
  expect(events.filter((event) => event.type === "verify" && "deps" in event)).toHaveLength(1);
});

test("debug output does not advance the dependency report interval", async () => {
  const root = await project();
  const debug = await invoke(["verify", "--json"], root, false, true);
  expect(debug.status).toBe(0);
  expect(readFileSync(projectFile(root), "utf8")).not.toContain("depsSentAt");
  expect(events.filter((event) => event.type === "verify")).toHaveLength(0);
  expect((await invoke(["verify", "--json"], root)).status).toBe(0);
  expect(events.filter((event) => event.type === "verify" && "deps" in event)).toHaveLength(1);
});

test.each([false, true])(
  "a v1 user sees the second notice in %s mode before deps",
  async (human) => {
    const root = await project();
    writeJson(join(telemetryRoot(home), "notice.json"), {
      noticeShownAt: new Date().toISOString(),
      noticeVersion: 1,
    });
    const first = await invoke(["verify"], root, human);
    expect(first.status).toBe(0);
    expect(first.stderr).toContain(`${url}/telemetry`);
    expect(first.stderr).toContain("telemetry disable");
    expect(events.filter((event) => event.type === "verify")).toHaveLength(0);
    const second = await invoke(["verify"], root, human);
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain("stacks now sends");
    expect(events.filter((event) => event.type === "verify" && "deps" in event)).toHaveLength(1);
  },
);
