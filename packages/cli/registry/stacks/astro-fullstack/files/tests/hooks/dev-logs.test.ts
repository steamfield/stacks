import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outputRecord } from "../../scripts/dev-logs";
import { type Fixture, makeFixture, REPO } from "./helpers/dev";

const at = new Date("2026-01-01T00:00:00.000Z");

describe("outputRecord", () => {
  it("keeps Astro's JSON lines' level, message and label", () => {
    expect(
      outputRecord(
        "web",
        '{"message":"[Unhandled error] Error: boom\\n","label":"vite","level":"error"}',
        at,
      ),
    ).toEqual({
      time: at.toISOString(),
      source: "web",
      level: "error",
      msg: "[Unhandled error] Error: boom",
      label: "vite",
    });
  });

  it("skips the API's terminal copy of a record already in logs/server.jsonl", () => {
    const line =
      '2026-01-01T00:00:00.000Z info request {"requestId":"a","method":"GET","path":"/healthz","status":200,"durationMs":1,"time":"2026-01-01T00:00:00.000Z","level":"info","msg":"request"}';
    expect(outputRecord("api", line, at)).toBeUndefined();
    // The same text from the site is the site's own output.
    expect(outputRecord("web", line, at)?.msg).toBe(line);
  });

  it("keeps a record the API printed before its log file opened", () => {
    const line = '{"time":"2026-01-01T00:00:00.000Z","level":"error","msg":"startup","error":{}}';
    expect(outputRecord("api", line, at)).toMatchObject({
      level: "error",
      msg: "startup",
      source: "api",
    });
  });

  it.each([
    ["SyntaxError: Unexpected token", "error"],
    ["17:42:51 [ERROR] [vite] http proxy error: /healthz", "error"],
    ["(node:1) Warning: something deprecated", "warn"],
    ["Restarting 'src/platform/node.ts'", "info"],
    ['error: script "dev:api" exited with code 130', "info"],
    ['error: script "dev:api" exited with code 1', "error"],
    // The word inside a path or file name is not an error.
    ["17:42:51 [vite] page reload /src/lib/error.ts", "info"],
    ["[200] /error 2ms", "info"],
    ["[200] /warning 2ms", "info"],
  ])("levels plain text %j as %s", (line, level) => {
    expect(outputRecord("web", line, at)?.level).toBe(level);
  });
});

function logs(dir: string, ...args: string[]) {
  return spawnSync("bun", ["scripts/logs.ts", ...args], { cwd: dir, encoding: "utf8" });
}

describe("countProblems", () => {
  let project: Fixture;
  afterEach(() => project.cleanup());

  it("counts warn, error and fatal records in both files, and nothing else", () => {
    project = makeFixture();
    mkdirSync(join(project.dir, "scripts"));
    mkdirSync(join(project.dir, "logs"));
    copyFileSync(join(REPO, "scripts/dev-logs.ts"), join(project.dir, "scripts/dev-logs.ts"));
    const lines = (records: object[]) => records.map((r) => `${JSON.stringify(r)}\n`).join("");
    writeFileSync(
      join(project.dir, "logs/server.jsonl"),
      lines([
        { level: "error", msg: "defect" },
        { level: "info", msg: "request" },
        // A message quoting a level is escaped by JSON.stringify, so it isn't counted.
        { level: "info", msg: '"level":"error"' },
        { level: "fatal", msg: "startup" },
      ]),
    );
    writeFileSync(
      join(project.dir, "logs/dev.jsonl"),
      lines([
        { level: "warn", msg: "deprecated" },
        { level: "debug", msg: "noise" },
      ]),
    );
    const result = spawnSync(
      "bun",
      ["-e", 'import { countProblems } from "./scripts/dev-logs"; console.log(countProblems())'],
      { cwd: project.dir, encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("3");
  });
});

describe("bun run logs", () => {
  let project: Fixture;
  const now = Date.now();
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  beforeEach(() => {
    project = makeFixture();
    mkdirSync(join(project.dir, "scripts"));
    mkdirSync(join(project.dir, "logs"));
    for (const file of ["logs.ts", "dev-logs.ts"]) {
      copyFileSync(join(REPO, "scripts", file), join(project.dir, "scripts", file));
    }
  });
  afterEach(() => project.cleanup());

  const put = (name: string, records: object[]) =>
    writeFileSync(
      join(project.dir, "logs", name),
      `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );

  function seed() {
    put("server.jsonl", [
      {
        time: ago(3600),
        level: "info",
        msg: "request",
        requestId: "old",
        method: "GET",
        path: "/healthz",
        status: 200,
        durationMs: 1,
      },
      {
        time: ago(60),
        level: "error",
        msg: "defect",
        requestId: "r-1",
        error: { class: "TypeError", stack: [] },
      },
      {
        time: ago(59),
        level: "info",
        msg: "request",
        requestId: "r-1",
        method: "GET",
        path: "/v1/things",
        status: 500,
        durationMs: 4,
      },
    ]);
    put("dev.jsonl", [
      { time: ago(30), level: "error", msg: "[vite] http proxy error: /healthz", source: "web" },
      { time: ago(20), level: "info", msg: "[200] / 2ms", source: "web" },
    ]);
  }

  it("merges both files in time order, one readable line per record", () => {
    seed();
    const result = logs(project.dir);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("info  api request GET /healthz 200 1ms id=old");
    expect(lines[1]).toContain('error api defect {"requestId":"r-1"');
    expect(lines[3]).toContain("error web [vite] http proxy error: /healthz");
  });

  it.each([
    [
      ["--level", "warn"],
      ["defect", "proxy error"],
    ],
    [
      ["--request", "r-1"],
      ["defect", "/v1/things"],
    ],
    [["--path", "/v1"], ["/v1/things"]],
    [
      ["--since", "10m"],
      ["defect", "/v1/things", "proxy error", "[200] /"],
    ],
    [["--source", "web", "--grep", "PROXY"], ["proxy error"]],
    [["--tail", "1"], ["[200] /"]],
  ])("filters with %j", (args, expected) => {
    seed();
    const lines = logs(project.dir, ...args)
      .stdout.trim()
      .split("\n");
    expect(lines).toHaveLength(expected.length);
    expected.forEach((text, i) => {
      expect(lines[i]).toContain(text);
    });
  });

  it("prints raw records with --json", () => {
    seed();
    const lines = logs(project.dir, "--json", "--level", "error").stdout.trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).msg)).toEqual([
      "defect",
      "[vite] http proxy error: /healthz",
    ]);
  });

  it("keeps records since an absolute ISO time", () => {
    seed();
    const lines = logs(project.dir, "--since", ago(45)).stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("proxy error");
    expect(lines[1]).toContain("[200] /");
  });

  it("leaves a record without a time out of a --since window", () => {
    put("dev.jsonl", [
      { level: "error", msg: "timeless", source: "web" },
      { time: ago(5), level: "info", msg: "recent", source: "web" },
    ]);
    const result = logs(project.dir, "--since", "1m");
    expect(result.stdout).toContain("recent");
    expect(result.stdout).not.toContain("timeless");
  });

  const many = () =>
    put(
      "server.jsonl",
      Array.from({ length: 101 }, (_, i) => ({ time: ago(200 - i), level: "info", msg: `n${i}` })),
    );

  it("prints every matching record with --json, and says when text output is cut", () => {
    many();
    const json = logs(project.dir, "--json");
    expect(json.stdout.trim().split("\n")).toHaveLength(101);
    expect(json.stderr).not.toContain("matching records");
    const text = logs(project.dir);
    expect(text.stdout.trim().split("\n")).toHaveLength(100);
    expect(text.stderr).toContain("last 100 of 101 matching records");
    // An explicit --tail under --json cuts too, and says so on stderr, never on stdout.
    const cut = logs(project.dir, "--json", "--tail", "2");
    expect(
      cut.stdout
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).msg),
    ).toEqual(["n99", "n100"]);
    expect(cut.stderr).toContain("last 2 of 101 matching records");
  });

  it("reads the previous run's files with --prev when only those exist", () => {
    put("server.prev.jsonl", [{ time: ago(10), level: "info", msg: "last run" }]);
    put("dev.prev.jsonl", [{ time: ago(9), level: "warn", msg: "last web", source: "web" }]);
    expect(logs(project.dir).status).toBe(1);
    const lines = logs(project.dir, "--prev").stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("info  api last run");
    expect(lines[1]).toContain("warn  web last web");
  });

  it.each(["server.jsonl", "dev.jsonl"])("reads %s when it is the only file", (name) => {
    put(name, [{ time: ago(10), level: "info", msg: "alone", source: "web" }]);
    const result = logs(project.dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("alone");
  });

  it("skips a last line cut off mid-write and prints the rest", () => {
    seed();
    writeFileSync(
      join(project.dir, "logs/server.jsonl"),
      `${JSON.stringify({ time: ago(5), level: "info", msg: "whole" })}\n{"time":"${ago(4)}","lev`,
    );
    const result = logs(project.dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("whole");
    expect(result.stdout).toContain("proxy error");
  });

  it("says how to start the servers when there are no logs", () => {
    const result = logs(project.dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("bun run dev:bg");
  });

  // Date's lenient parser reads "12" as 2001-12-01, so a bare number must not pass as a time.
  it.each([["--level", "loud"], ["--since", "yesterday"], ["--since", "12"], ["--bogus"]])(
    "rejects %j with exit 2 and a pointer to --help",
    (...args) => {
      seed();
      const result = logs(project.dir, ...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("bun run logs --help");
    },
  );
});

describe("bun run dev", { timeout: 30_000 }, () => {
  let project: Fixture;
  afterEach(() => project.cleanup());

  const freePort = () =>
    new Promise<string>((resolve) => {
      const server = createServer().listen(0, () => {
        const address = server.address();
        assert(address && typeof address === "object");
        const { port } = address;
        server.close(() => resolve(String(port)));
      });
    });

  // Stand-ins that print the way the real servers do, then stay up.
  const print = (lines: string[]) =>
    `bun -e 'for (const l of ${JSON.stringify(lines).replaceAll("'", "")}) console.error(l); setInterval(() => {}, 1000)'`;

  /** Runs scripts/dev.ts in a fixture whose dev:api and dev:web are `scripts`. */
  async function startDev(
    scripts: { "dev:api": string; "dev:web": string },
    previousLogs: Record<string, string> = {},
  ) {
    project = makeFixture();
    mkdirSync(join(project.dir, "scripts"));
    for (const file of ["dev.ts", "dev-pid.ts", "dev-logs.ts"]) {
      copyFileSync(join(REPO, "scripts", file), join(project.dir, "scripts", file));
    }
    writeFileSync(join(project.dir, "package.json"), JSON.stringify({ private: true, scripts }));
    mkdirSync(join(project.dir, "logs"));
    for (const [file, text] of Object.entries(previousLogs))
      writeFileSync(join(project.dir, "logs", file), text);
    return spawn("bun", ["scripts/dev.ts"], {
      cwd: project.dir,
      env: { ...process.env, PORT_API: await freePort(), PORT_WEB: await freePort() },
      stdio: "ignore",
    });
  }

  /** Ctrl-C the session, then wait until the server groups logs/dev.pid named are gone. */
  async function stopDev(dev: ChildProcess) {
    const pidFile = join(project.dir, "logs/dev.pid");
    const groups = existsSync(pidFile)
      ? readFileSync(pidFile, "utf8").trim().split(/\s+/).slice(3).map(Number)
      : [];
    dev.kill("SIGINT");
    await new Promise((resolve) => dev.on("close", resolve));
    for (const group of groups) {
      await vi.waitFor(() => expect(() => process.kill(-group, 0)).toThrow(/ESRCH/), {
        timeout: 10_000,
        interval: 100,
      });
    }
  }

  /**
   * The records dev.ts has finished writing. The file exists (empty) before the servers print,
   * and a line can be mid-write, so only text up to the last newline is parsed: a partial or
   * empty read means "not yet", never a JSON error.
   */
  const completeRecords = (file: string) => {
    const text = readFileSync(file, "utf8");
    return text
      .slice(0, text.lastIndexOf("\n") + 1)
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  };

  it("records what the servers print in logs/dev.jsonl, minus the API's own records", async () => {
    const dev = await startDev({
      "dev:api": print([
        '2026-01-01T00:00:00.000Z info request {"msg":"request","level":"info"}',
        "SyntaxError: Unexpected token",
      ]),
      "dev:web": print(['{"message":"http proxy error","label":"vite","level":"error"}']),
    });
    try {
      const file = join(project.dir, "logs/dev.jsonl");
      // Starting bun, then the stand-in servers, can take seconds on a loaded machine.
      await vi.waitFor(
        () => {
          const messages = completeRecords(file).filter((r) => !r.msg.startsWith("$ "));
          expect(messages).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                source: "api",
                level: "error",
                msg: "SyntaxError: Unexpected token",
              }),
              expect.objectContaining({ source: "web", level: "error", msg: "http proxy error" }),
            ]),
          );
          expect(messages.some((r) => r.msg.includes("info request"))).toBe(false);
        },
        { timeout: 20_000, interval: 100 },
      );
    } finally {
      await stopDev(dev);
    }
  });

  it("moves logs/dev.log and logs/dev.jsonl aside as *.old.* past 10 MB", async () => {
    // 11 MB of output in 1 kB lines.
    const flood =
      "bun -e 'const l = \"x\".repeat(1000); for (let i = 0; i < 11000; i++) console.error(l); setInterval(() => {}, 1000)'";
    const dev = await startDev(
      { "dev:api": flood, "dev:web": print(["ready"]) },
      {
        "dev.log": "previous terminal",
        "dev.jsonl": "previous output",
        "server.jsonl": "previous API",
      },
    );
    try {
      await vi.waitFor(
        () => {
          for (const name of ["dev.old.log", "dev.old.jsonl"]) {
            expect(existsSync(join(project.dir, "logs", name))).toBe(true);
          }
        },
        { timeout: 20_000, interval: 200 },
      );
      expect(readFileSync(join(project.dir, "logs/dev.prev.log"), "utf8")).toBe(
        "previous terminal",
      );
      expect(readFileSync(join(project.dir, "logs/dev.prev.jsonl"), "utf8")).toBe(
        "previous output",
      );
      expect(readFileSync(join(project.dir, "logs/server.prev.jsonl"), "utf8")).toBe(
        "previous API",
      );
      for (const name of ["dev.log", "dev.jsonl"]) {
        expect(statSync(join(project.dir, "logs", name)).size).toBeLessThan(10 * 1024 * 1024);
      }
    } finally {
      await stopDev(dev);
    }
  });
});
