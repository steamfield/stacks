import { spawn } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { decodeEntry, type Entry } from "../../src/core/registry/entry";
import { ValidateReport } from "../../src/schemas/validate";
import { quiet, runCli, stopChildren, trackChild } from "./cli";
import { minimal, writeEntry } from "./registry";

export const cliRoot = join(import.meta.dirname, "../..");
export const bundled = join(cliRoot, "registry");
export function copyVocabulary(root: string) {
  cpSync(join(bundled, "search/vocabulary.json"), join(root, "search/vocabulary.json"));
}
export type Ref = Pick<Entry, "kind" | "id">;
/** Search and decoration read metadata, cards and root contracts, without composing payloads. */
export function copySearchRegistry(root: string, refs?: ReadonlyArray<Ref>) {
  for (const dir of ["stacks", "fragments", "search/stacks", "search/fragments"])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of readdirSync(bundled, { withFileTypes: true }))
    if (file.isFile()) cpSync(join(bundled, file.name), join(root, file.name));
  copyVocabulary(root);
  const selected =
    refs ??
    (["stack", "fragment"] as const).flatMap((kind) =>
      readdirSync(join(bundled, `${kind}s`)).map((id) => ({ kind, id })),
    );
  for (const ref of selected) {
    const dir = join(`${ref.kind}s`, ref.id);
    const markdown = ref.kind === "stack" ? "STACK.md" : "FRAGMENT.md";
    mkdirSync(join(root, dir), { recursive: true });
    cpSync(join(bundled, dir, markdown), join(root, dir, markdown));
    if (existsSync(cardPath(bundled, ref))) cpSync(cardPath(bundled, ref), cardPath(root, ref));
  }
  return root;
}
export const cardPath = (root: string, ref: Ref) =>
  join(root, "search", ref.kind === "stack" ? "stacks" : "fragments", `${ref.id}.json`);
export function put(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
export async function entryAt(root: string, ref: Ref): Promise<Entry> {
  const dir = join(root, ref.kind === "stack" ? "stacks" : "fragments", ref.id);
  const decoded = await Effect.runPromise(
    decodeEntry(
      ref.kind,
      readFileSync(join(dir, ref.kind === "stack" ? "STACK.md" : "FRAGMENT.md"), "utf8"),
    ),
  );
  if (decoded._tag !== "Meta")
    throw new Error(`Invalid search fixture: ${JSON.stringify(decoded)}`);
  return {
    ...ref,
    dir,
    meta: decoded.meta,
    body: decoded.body,
    origin: "bundled",
    trusted: true,
    shadows: [],
  };
}
export async function sourceDigest(root: string, ref: Ref) {
  const { searchSourceDigest } = await import("../../src/core/search/digest");
  return searchSourceDigest(await entryAt(root, ref));
}
export function card(ref: Ref, digest = `sha256:${"0".repeat(64)}`) {
  return {
    schemaVersion: 1,
    ...ref,
    source: { digest, by: "author", reviewedAt: "2020-01-01" },
    summary: "Small commands for local automation.",
    ...(ref.kind === "stack"
      ? { platforms: ["cli"], productKinds: ["cli-tool"], languages: ["typescript"] }
      : { capabilities: [] }),
    requests: [
      "batch rename my receipts",
      "inspect archived build artifacts",
      "automate repeated local chores",
    ],
    useCases: ["local automation"],
    synonyms: ["utility"],
    goodFor: ["small tools"],
    notFor: ["phone applications"],
  };
}
export function draftCard(ref: Ref) {
  return {
    ...card(ref),
    description: "Guidance and starter files for building the requested project.",
    seoDescription: "Build a project from the selected recipe.",
    projectExamples: [
      {
        title: "Illustrative project",
        description: "An illustrative project built from the selected recipe.",
      },
    ],
    plain: {
      whatItIs: "A starter for a project using the selected recipe.",
      goodAt: ["Building a small project"],
      notGoodAt: ["Shipping a finished product without further work"],
    },
  };
}
export async function stamp(root: string, ref: Ref) {
  const value = card(ref, await sourceDigest(root, ref));
  put(cardPath(root, ref), JSON.stringify(value, null, 2));
  return value;
}
export function seed(root: string, ref: Ref) {
  writeEntry({
    root,
    kind: ref.kind,
    dir: ref.id,
    frontmatter: minimal(ref.kind, ref.id, ref.kind === "stack" ? "tags: [scripts]" : ""),
    body: "# Fixture\n\n## Setup\n\nBuild a small command.\n",
  });
}
export async function validateSearch(
  root: string,
  options: { home: string; bundled?: boolean; registry?: string },
) {
  const result = await runCli(["validate", ...(options.bundled ? [] : [root]), "--json"], {
    home: options.home,
    host: { registry: options.bundled ? root : (options.registry ?? bundled) },
    env: quiet,
  });
  expect(result.stdout.trim(), result.stderr).not.toBe("");
  const report = Schema.decodeUnknownSync(ValidateReport)(JSON.parse(result.stdout));
  const errors = report.findings.some((finding) => finding.severity === "error");
  expect(result.status, result.stderr).toBe(errors ? 2 : 0);
  if (errors) {
    const envelope = Schema.decodeUnknownSync(
      Schema.Struct({ error: Schema.Struct({ tag: Schema.String }) }),
    )(JSON.parse(result.stderr));
    expect(envelope.error.tag).toBe("ValidationFailed");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  } else expect(result.stderr).toBe("");
  return report;
}
export const searchFindings = (report: ValidateReport) =>
  report.findings.filter(
    ({ check }) => check.startsWith("search-") || check.startsWith("vocabulary-"),
  );

/** A checkout copy keeps the maintainer script's real writes away from the working registry. */
export function decorateWorkspace(temporary: string, refs?: ReadonlyArray<Ref>) {
  const root = realpathSync(temporary);
  const cli = join(root, "packages/cli");
  for (const part of ["src", "scripts", "package.json"])
    cpSync(join(cliRoot, part), join(cli, part), { recursive: true });
  cpSync(join(cliRoot, "../format"), join(root, "packages/format"), {
    recursive: true,
    filter: (path) => !path.includes("node_modules") && !path.includes("/dist"),
  });
  symlinkSync(join(cliRoot, "../../node_modules"), join(root, "node_modules"));
  linkDependencies(cliRoot, cli);
  linkDependencies(join(cliRoot, "../format"), join(root, "packages/format"));
  mkdirSync(join(cli, "node_modules/@steamfield"), { recursive: true });
  symlinkSync(join(root, "packages/format"), join(cli, "node_modules/@steamfield/stacks-format"));
  const registry = join(cli, "registry");
  if (refs === undefined) cpSync(bundled, registry, { recursive: true });
  else copySearchRegistry(registry, refs);
  for (const id of ["second", "third"]) seed(registry, { kind: "stack", id });
  return { root, cli, registry };
}
function linkDependencies(source: string, target: string) {
  mkdirSync(join(target, "node_modules"), { recursive: true });
  for (const name of readdirSync(join(source, "node_modules"))) {
    if (!["@steamfield", ".bin", ".vite-temp"].includes(name))
      symlinkSync(join(source, "node_modules", name), join(target, "node_modules", name));
  }
}
export type DecorateWorkspace = ReturnType<typeof decorateWorkspace>;
const providers = new Set<() => Promise<void>>();
export async function closeDecorateFixtures() {
  await stopChildren();
  await Promise.all([...providers].map((close) => close()));
}
export function decorate(
  f: DecorateWorkspace,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; tty?: boolean } = {},
) {
  const argv = ["--no-env-file", "--config=/dev/null", join(f.cli, "scripts/decorate.ts"), ...args];
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const command = options.tty ? "script" : "bun";
  let commandArgs = argv;
  if (options.tty) {
    commandArgs =
      process.platform === "darwin"
        ? ["-q", "/dev/null", "bun", ...argv]
        : ["-qec", ["bun", ...argv].map(quote).join(" "), "/dev/null"];
  }
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const stdin = openSync("/dev/null", "r");
    const child = spawn(command, commandArgs, {
      cwd: f.cli,
      detached: true,
      timeout: 20_000,
      env: {
        PATH: process.env.PATH,
        HOME: join(f.root, "home"),
        XDG_CONFIG_HOME: join(f.root, "home/config"),
        XDG_STATE_HOME: join(f.root, "home/state"),
        NO_COLOR: "1",
        LOG_LEVEL: "debug",
        // Each workspace has a fresh HOME; caching here only adds writes to tear down.
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        ...options.env,
      },
      stdio: [stdin, "pipe", "pipe"],
    });
    trackChild(child, true);
    closeSync(stdin);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (status, signal) => {
      if (status === null) reject(new Error(`decorate terminated by ${signal}`));
      else
        resolve({
          status,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
    });
  });
}
export async function openRouter(
  replies: ReadonlyArray<{ status?: number; content: string; cost?: number }>,
) {
  const requests: { url: string; authorization: string | undefined; body: unknown }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    const reply = replies[requests.length];
    requests.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
    if (!reply) {
      res.writeHead(500).end("Unexpected extra request");
      return;
    }
    res.writeHead(reply.status ?? 200, { "Content-Type": "application/json", "Retry-After": "0" });
    res.end(
      JSON.stringify({
        id: `fixture-${requests.length}`,
        choices: [
          { message: { role: "assistant", content: reply.content }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 100,
          total_tokens: 200,
          cost: reply.cost ?? 0.001,
        },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fake OpenRouter port");
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve, reject) => {
      server.close((error) => {
        providers.delete(close);
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
    return closing;
  };
  providers.add(close);
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/api/v1`,
    close,
  };
}
