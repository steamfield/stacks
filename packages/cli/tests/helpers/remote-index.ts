import { execFile } from "node:child_process";
import { sign } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { IndexEntry, RegistryIndex, SignedIndex } from "@steamfield/stacks-format";
import { Effect, type FileSystem, Layer, type Path } from "effect";
import { Command } from "effect/cli";
import { HttpClient, HttpClientRequest } from "effect/http";
import { expect } from "vitest";
import { cli } from "../../src/cli";
import { AppConfig, type Environment } from "../../src/config";
import type { RemoteIndex as RemoteIndexService } from "../../src/core/remote-index";
import { NetLayer } from "../../src/platform/net";
import { VERSION } from "../../src/version";
import {
  bundleFile,
  compositionFingerprint,
  entryPath,
  fixture,
  keyId,
  privateKey,
  proof,
  publicKey,
  readBuild,
} from "../fixtures/index/harness";
import { quiet, runCli } from "./cli";
import { writeLedger } from "./ledger";

export const keys = [{ keyId, publicKey }];
export type CommandResult = Awaited<ReturnType<typeof runCli>>;
export function success(result: CommandResult) {
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).not.toBe("");
}

export function execute(command: string, args: string[], cwd: string, env: Environment) {
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(command, args, { cwd, env, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error === null) resolve({ status: 0, stdout, stderr });
      else if (typeof error.code === "number") resolve({ status: error.code, stdout, stderr });
      else reject(error);
    });
  });
}

/** A real loopback server. Holding a response open lets TestClock own the client deadline. */
export async function remoteServer(root: string) {
  const requests: string[] = [];
  let mode: "files" | "not_found" | "hold" | "partial" | "network" = "files";
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://fixture").pathname;
    requests.push(pathname);
    if (mode === "hold") return;
    if (mode === "network") {
      request.socket.destroy();
      return;
    }
    const file = join(root, pathname);
    if (mode === "not_found" || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    const bytes = readFileSync(file);
    if (mode === "partial") {
      response.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
      return;
    }
    response.end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing fixture port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    mode(value: typeof mode) {
      mode = value;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

export type RemoteServer = Awaited<ReturnType<typeof remoteServer>>;

/** Preserve the configured URL/trust decision; replace only HTTP transport with loopback. */
export const localHttp = (url: string) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      client.pipe(
        HttpClient.mapRequest((request) =>
          HttpClientRequest.setUrl(request, `${url}${new URL(request.url).pathname}`),
        ),
      ),
    ),
  ).pipe(Layer.provide(NetLayer));

export const environment = (home: string): Environment => ({
  HOME: home,
  XDG_CACHE_HOME: join(home, "cache"),
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_STATE_HOME: join(home, "state"),
  PATH: process.env.PATH,
  NO_COLOR: "1",
  ...quiet,
});

export const cacheRoot = (home: string) => join(home, "cache/stacks/index");

type RemoteDependencies = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | AppConfig;
async function indexLayer(): Promise<Layer.Layer<RemoteIndexService, never, RemoteDependencies>> {
  const { RemoteIndex } = await import("../../src/core/remote-index");
  return RemoteIndex.layer({ keys, officialUrl: "https://index.example.test/v1/index.json" });
}

// Dynamic imports let every acceptance test execute and report the missing implementation,
// while beforeAll independently validates and builds all of the real fixtures.
export async function remoteLayer(home: string, server: RemoteServer, env: Environment = {}) {
  return (await indexLayer()).pipe(
    Layer.provide(AppConfig.memory({ ...environment(home), ...env })),
    Layer.provide(localHttp(server.url)),
    Layer.provide(NodeServices.layer),
  );
}

export async function remoteCli(
  args: string[],
  options: Parameters<typeof runCli>[1] & { home: string; server: RemoteServer },
) {
  const remote = await indexLayer();
  return runCli(args, {
    ...options,
    env: { ...environment(options.home), ...options.env },
    http: localHttp(options.server.url),
    program: Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provide(remote),
    ),
  });
}

export function named(index: RegistryIndex, kind: IndexEntry["kind"], id: string) {
  const entry = index.entries.find((value) => value.kind === kind && value.id === id);
  if (!entry) throw new Error(`Missing fixture entry ${kind}/${id}`);
  return entry;
}

/** Mutations start with builder output; re-sign only deliberately schema-invalid payloads. */
export function publish(root: string, envelope: SignedIndex, payload?: unknown) {
  const bytes = payload === undefined ? envelope.payload : JSON.stringify(payload);
  const signature = sign(null, Buffer.from(bytes), readFileSync(privateKey)).toString("base64");
  writeFileSync(
    join(root, "v1/index.json"),
    JSON.stringify({ ...envelope, payload: bytes, signature }),
  );
}

/** Build old and new proven snapshots once, including a stack pinned to the old tools. */
export async function buildRemoteFixture(temporary: string) {
  const f = await fixture(temporary);
  const tools = entryPath(f.registry, "fragment", "tools");
  mkdirSync(join(tools, "files"));
  writeFileSync(join(tools, "files/pinned.txt"), "proven old tools\n");
  const record = await proof(f.registry);
  const optional = await proof(f.registry, {
    with: ["extra"],
    fingerprint: await compositionFingerprint(f.registry, { with: ["extra"] }),
  });
  writeLedger(f.registry, [record, optional]);
  const bundled = join(f.root, "bundled");
  cpSync(f.registry, bundled, { recursive: true });
  const previous = join(f.root, "previous");
  success(await f.invoke(["--out", previous, "--previous", "none", "--key", privateKey]));
  const old = await readBuild(previous);
  writeFileSync(join(tools, "files/pinned.txt"), "newer tools, proven with another stack\n");
  // `extra` stays indexed only through a proof over today's content: changing `tools` made the
  // first snapshot's optional proof stale (4.0c's rule for optional fragments).
  writeLedger(f.registry, [
    await proof(f.registry, {
      stack: "never-proven",
      fingerprint: await compositionFingerprint(f.registry, { stack: "never-proven" }),
      date: "2026-10-28",
    }),
    await proof(f.registry, {
      stack: "never-proven",
      with: ["extra"],
      fingerprint: await compositionFingerprint(f.registry, {
        stack: "never-proven",
        with: ["extra"],
      }),
      date: "2026-10-28",
    }),
  ]);
  const server = await remoteServer(previous);
  try {
    success(
      await f.invoke([
        "--out",
        f.out,
        "--previous",
        `${server.url}/v1/index.json`,
        "--key",
        privateKey,
      ]),
    );
  } finally {
    await server.close();
  }
  const built = await readBuild(f.out);
  expect(named(built.index, "stack", "sample").composition).toEqual(
    named(old.index, "stack", "sample").composition,
  );
  expect(named(built.index, "fragment", "tools").digest).not.toBe(
    named(old.index, "fragment", "tools").digest,
  );
  expect(existsSync(bundleFile(f.out, named(old.index, "fragment", "tools")))).toBe(true);
  return { ...f, ...built, old: old.index, bundled };
}

export type RemoteFixture = Awaited<ReturnType<typeof buildRemoteFixture>>;

/** Install the actual tarball offline. Source changes here are confined to the temp copy. */
export async function installRemotePackage(f: RemoteFixture) {
  const repoCli = join(import.meta.dirname, "../..");
  cpSync(join(repoCli, "../../bun.lock"), join(f.root, "bun.lock"));
  for (const path of ["skills", "docs/authoring.md", "LICENSE"])
    cpSync(join(repoCli, path), join(f.cli, path), { recursive: true });
  // The package must obtain sample from the server rather than its bundled registry.
  rmSync(join(f.cli, "registry"), { recursive: true });
  mkdirSync(join(f.cli, "registry"));
  const env = {
    ...environment(join(f.root, "package-home")),
    npm_config_update_notifier: "false",
    npm_config_cache: join(f.root, "npm-cache"),
  };
  success(
    await execute("bun", ["--no-env-file", "--config=/dev/null", "scripts/build.ts"], f.cli, env),
  );
  success(
    await execute("bun", ["--no-env-file", "--config=/dev/null", "scripts/pack.ts"], f.cli, env),
  );
  const { name, version } = JSON.parse(readFileSync(join(f.cli, "package.json"), "utf8"));
  const tarball = join(
    f.cli,
    "dist/pack",
    `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`,
  );
  const installed = join(f.root, "installed");
  mkdirSync(installed);
  writeFileSync(join(installed, "package.json"), '{"private":true}');
  success(
    await execute(
      "npm",
      ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      installed,
      env,
    ),
  );
  return realpathSync(join(installed, "node_modules/.bin/stacks"));
}
