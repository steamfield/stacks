import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Server, Socket } from "node:net";
import { dirname, join } from "node:path";
import { Manifest, type ManifestStep, RunRecord } from "@steamfield/stacks-format";
import { Schema } from "effect";
import type { Environment } from "../../src/config";
import { digestSteps, encodeManifest, MANIFEST_PATH } from "../../src/core/manifest";
import { ProjectState, projectStateFor } from "../../src/core/project-state";
import { VerifyEvent, VerifyResult } from "../../src/schemas/verify";
import type { HostInfo } from "../../src/services/host";
import type { Writer } from "../../src/services/output-write";
import { quiet, runCli, tempDir } from "./cli";

/** A step as a test writes it: `name` and `run`, everything else defaulted like `new` would. */
export type StepInput = Partial<ManifestStep> & Pick<ManifestStep, "name" | "run">;

export const step = (input: StepInput): ManifestStep => ({
  phase: "check",
  owner: "fixture-stack",
  skipByDefault: false,
  ...input,
});

/**
 * A valid schema-version-1 manifest holding `steps`, its `verifyDigest` computed over them the way
 * `new` computes it unless `overrides` names one.
 */
export function manifest(steps: StepInput[], overrides: Partial<Manifest> = {}): Manifest {
  const built: Manifest = {
    schemaVersion: 1,
    projectId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    createdAt: "2026-10-26T09:00:00.000Z",
    cli: "0.0.0",
    mode: "new",
    preset: "default",
    agents: ["claude"],
    stack: { id: "fixture-stack", origin: "bundled", trusted: true },
    fragments: [],
    env: {},
    commands: {},
    verify: steps.map(step),
    verifyDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    briefWords: 0,
    ...overrides,
  };
  return overrides.verifyDigest ? built : { ...built, verifyDigest: digestSteps(built) };
}

/** XDG_STATE_HOME under `home`, as tests that keep a state record across runs set it. */
export const stateEnv = (home: string) => ({ XDG_STATE_HOME: join(home, "state") });
/** Where the state record for `projectId` lives under `stateEnv(home)`. */
export const recordPath = (home: string, projectId: string) =>
  join(home, "state", "stacks", "projects", `${projectId}.json`);

/**
 * Writes a project as `new` leaves it: the manifest under `root` and its state record under
 * `stateEnv(home)`, holding the manifest's real path. Returns the manifest.
 */
export function writeRecordedProject(
  root: string,
  home: string,
  steps: StepInput[],
  overrides: Partial<Manifest> = {},
): Manifest {
  const path = writeProject(root, steps, overrides);
  const written = manifest(steps, overrides);
  const file = recordPath(home, written.projectId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      Schema.encodeSync(ProjectState)(projectStateFor(written, realpathSync(path))),
      null,
      2,
    ),
  );
  return written;
}

/** Reads a state record back, decoded. */
export const readRecord = (file: string): ProjectState =>
  Schema.decodeUnknownSync(ProjectState)(JSON.parse(readFileSync(file, "utf8")), {
    onExcessProperty: "error",
  });

/** Reads a manifest file back, decoded. */
export const readManifestAt = (root: string): Manifest =>
  Schema.decodeUnknownSync(Manifest)(JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8")), {
    onExcessProperty: "error",
  });

/** `.stacks/state/runs.jsonl` under `root`, each line decoded as a `RunRecord`. */
export function runRecords(root: string): RunRecord[] {
  const file = join(root, ".stacks", "state", "runs.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) =>
      Schema.decodeUnknownSync(RunRecord)(JSON.parse(line), { onExcessProperty: "error" }),
    );
}

/** Writes `.stacks/manifest.json` under `root` and returns its path. */
export function writeProject(
  root: string,
  steps: StepInput[],
  overrides: Partial<Manifest> = {},
): string {
  mkdirSync(join(root, ".stacks"), { recursive: true });
  const path = join(root, MANIFEST_PATH);
  writeFileSync(path, encodeManifest(manifest(steps, overrides)));
  return path;
}

/** Temporary directories and detached pids a test made, released by `release()` in afterEach. */
export function workspace() {
  const dirs: ReturnType<typeof tempDir>[] = [];
  const pidFiles: string[] = [];
  return {
    dir() {
      const dir = tempDir();
      dirs.push(dir);
      return dir.path;
    },
    /** Remembers a file a fixture writes a detached pid into, so release() can kill it. */
    trackPid(file: string) {
      pidFiles.push(file);
      return file;
    },
    release() {
      for (const file of pidFiles.splice(0)) {
        const pid = readPid(file);
        if (pid)
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
      }
      for (const dir of dirs.splice(0)) dir.cleanup();
    },
  };
}

export function readPid(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export type VerifyOptions = {
  /** The directory verify runs from (`Host.cwd`). */
  cwd: string;
  /** A HOME outside the project; one is made when absent. */
  home?: string;
  env?: Environment;
  signal?: AbortSignal;
  stdout?: Writer;
  /** Host fixture overrides beyond `cwd`, such as `stdinIsTTY`. */
  host?: Partial<HostInfo>;
};

/** `stacks verify <args>` from `cwd`, with this machine's PATH so steps find node and sleep. */
export async function verify(args: string[], options: VerifyOptions) {
  const own = options.home ? undefined : tempDir();
  try {
    return await runCli(["verify", ...args], {
      home: options.home ?? own?.path ?? "/invalid",
      host: { ...options.host, cwd: options.cwd },
      env: { PATH: process.env.PATH, ...quiet, ...options.env },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.stdout ? { stdout: options.stdout } : {}),
    });
  } finally {
    own?.cleanup();
  }
}

/** Decodes `verify --json`'s stdout, which must be exactly one JSON value. */
export const decodeResult = (stdout: string): VerifyResult =>
  Schema.decodeUnknownSync(VerifyResult)(JSON.parse(stdout), { onExcessProperty: "error" });

/** The last stderr line, parsed as the error envelope. */
export function envelope(stderr: string): unknown {
  return JSON.parse(stderr.trim().split("\n").at(-1) ?? "");
}

/**
 * `verify --json`'s stderr split into its live events, each decoded with `VerifyEvent` (closed),
 * and `rest`: every other line, which is the error envelope or nothing.
 */
export function splitEvents(stderr: string): { events: VerifyEvent[]; rest: string } {
  const lines = stderr.split("\n").filter((line) => line !== "");
  const isEvent = (line: string) => line.startsWith('{"event":');
  return {
    events: lines
      .filter(isEvent)
      .map((line) =>
        Schema.decodeUnknownSync(VerifyEvent)(JSON.parse(line), { onExcessProperty: "error" }),
      ),
    rest: lines
      .filter((line) => !isEvent(line))
      .map((line) => `${line}\n`)
      .join(""),
  };
}

/** The step names a run's events started, in order. */
export const startedSteps = (stderr: string) =>
  splitEvents(stderr).events.flatMap((event) =>
    event.event === "step-started" ? [event.name] : [],
  );

/** A result's step by name; throws when it is missing so a test reads the failure plainly. */
export function stepNamed(result: VerifyResult, name: string) {
  const found = result.steps.find((item) => item.name === name);
  if (!found) throw new Error(`no step named ${name} in ${JSON.stringify(result.steps)}`);
  return found;
}

/** The last non-empty line of a stream. */
export const lastLine = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

/** A port nothing listens on right now: listen on 0, read it, close. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Holds `port` on 127.0.0.1 with a plain TCP server until `close()`. */
export function holdPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.end());
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** Whether a TCP connect to 127.0.0.1:port succeeds. */
export function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Fixture scripts a serve step runs with `node`. `server.cjs` serves HTTP 200 on
 * `$PORT_WEB` (after `$LISTEN_DELAY_MS`); `background.cjs` starts that server detached, writes
 * its pid to `server.pid` and exits 0; `foreground.cjs` does the same and then stays running.
 */
export function writeServerScripts(root: string) {
  writeFileSync(
    join(root, "server.cjs"),
    [
      'const http = require("node:http");',
      "const port = Number(process.env.PORT_WEB);",
      "const delay = Number(process.env.LISTEN_DELAY_MS ?? 0);",
      'setTimeout(() => http.createServer((_q, s) => s.end("ok")).listen(port), delay);',
    ].join("\n"),
  );
  const detached = [
    'const { spawn } = require("node:child_process");',
    'const { writeFileSync } = require("node:fs");',
    'const child = spawn(process.execPath, ["server.cjs"], {',
    '  detached: true, stdio: "ignore", env: process.env,',
    "});",
    'writeFileSync("server.pid", String(child.pid));',
    "child.unref();",
  ];
  writeFileSync(join(root, "background.cjs"), [...detached, "process.exit(0);"].join("\n"));
  writeFileSync(
    join(root, "foreground.cjs"),
    [...detached, "setInterval(() => {}, 1000);"].join("\n"),
  );
}
