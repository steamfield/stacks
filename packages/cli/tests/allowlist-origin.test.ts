import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DependencyAllowlist } from "@steamfield/stacks-format";
import { Effect, Layer, Schema } from "effect";
import { Command } from "effect/cli";
import { HttpClient, HttpClientRequest } from "effect/http";
import { expect, onTestFinished, test } from "vitest";
import { cli } from "../src/cli";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { NetLayer } from "../src/platform/net";
import { ListResult } from "../src/schemas/list";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { VERSION } from "../src/version";
import { index, remoteTestDirectory, signIndex } from "./fixtures/index/refresh";
import { runCli } from "./helpers/cli";
import {
  type CommandResult,
  environment,
  keys,
  remoteServer,
  success,
} from "./helpers/remote-index";
import {
  registry,
  type TelemetryServer,
  telemetryRoot,
  telemetryServer,
  writeJson,
} from "./helpers/telemetry";
import { decodeResult, splitEvents } from "./helpers/verify";

const dependency = { ecosystem: "go", name: "github.com/a/b", major: "2" };
const allowlist: DependencyAllowlist = {
  formatVersion: 1,
  generatedAt: "2026-11-25T12:34:56.000Z",
  names: { npm: [], pypi: [], go: [dependency.name], crates: [] },
};
const decodeList = Schema.decodeUnknownSync(Schema.fromJsonString(ListResult));

async function serveAllowlist(directory = "v1", validSignature = true) {
  const temporary = remoteTestDirectory();
  const root = join(temporary.path, "published");
  const home = join(realpathSync(temporary.path), "home");
  mkdirSync(home);
  const envelope = signIndex(allowlist);
  writeJson(
    join(root, directory, "allowlist.json"),
    validSignature ? envelope : { ...envelope, signature: Buffer.alloc(64).toString("base64") },
  );
  writeJson(join(root, directory, "index.json"), signIndex(index));
  const server = await temporary.serve(root);
  return {
    server,
    indexUrl: `${server.url}/${directory}/index.json`,
    options: {
      home,
      env: environment(home),
      releaseBuild: true,
      allowlistKeys: keys,
      host: { registry },
    },
  };
}

const allowlistRequests = (paths: readonly string[]) =>
  paths.filter((path) => path.endsWith("/allowlist.json"));

type CliOptions = NonNullable<Parameters<typeof runCli>[1]>;

function runWithIndex(args: string[], options: CliOptions) {
  return runCli(args, {
    ...options,
    program: Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
      Effect.provide(RemoteIndex.layer({ keys })),
    ),
  });
}

function recordHttp(loopback: string) {
  const paths: string[] = [];
  // Capture the original request path before routing even an unexpected hosted URL to loopback.
  const http = Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      client.pipe(
        HttpClient.mapRequest((request) => {
          const url = new URL(request.url);
          paths.push(url.pathname);
          return HttpClientRequest.setUrl(request, `${loopback}${url.pathname}${url.search}`);
        }),
      ),
    ),
  ).pipe(Layer.provide(NetLayer));
  return { http, paths };
}

const indexAndAllowlistRequests = (paths: readonly string[]) =>
  paths.filter((path) => /\/(allowlist|index)\.json$/u.test(path));

function expectCatalog(result: CommandResult) {
  success(result);
  const catalog = decodeList(result.stdout);
  expect(catalog.entries).toContainEqual(expect.objectContaining({ id: "go-cli" }));
  expect(catalog.rejected).toEqual([]);
}

test.each(["list", "show"])(
  "%s skips the allowlist and index when a release build only has an API URL",
  async (command) => {
    const { server, options } = await serveAllowlist();
    const { http, paths } = recordHttp(server.url);
    const invocation = { ...options, apiUrl: server.url, http };
    if (command === "list") {
      expectCatalog(await runWithIndex(["list", "--json"], invocation));
    } else {
      const shown = await runWithIndex(["show", "go-cli", "--json"], invocation);
      success(shown);
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(ShowReport))(shown.stdout).id).toBe(
        "go-cli",
      );
    }
    expect(indexAndAllowlistRequests(paths)).toEqual([]);
  },
);

test.each([
  { directory: "v1", published: false },
  { directory: "other", published: true },
])(
  "list fetches the allowlist next to the explicit index under /$directory",
  async ({ directory, published }) => {
    const { server, options, indexUrl } = await serveAllowlist(directory);
    const api = await remoteServer(options.home);
    onTestFinished(api.close);
    const result = await runWithIndex(["list", "--json"], {
      ...options,
      apiUrl: api.url,
      build: published ? { officialIndexUrl: `${api.url}/v1/index.json` } : undefined,
      env: { ...options.env, STACKS_INDEX_URL: indexUrl },
    });
    expectCatalog(result);
    expect({
      index: allowlistRequests(server.requests),
      api: allowlistRequests(api.requests),
    }).toEqual({ index: [`/${directory}/allowlist.json`], api: [] });
  },
);

test("offline list skips index and allowlist requests with an index configured", async () => {
  const { server, options, indexUrl } = await serveAllowlist();
  const { http, paths } = recordHttp(server.url);
  const result = await runWithIndex(["list", "--json", "--offline"], {
    ...options,
    apiUrl: server.url,
    env: { ...options.env, STACKS_INDEX_URL: indexUrl },
    http,
  });
  expectCatalog(result);
  expect(indexAndAllowlistRequests(paths)).toEqual([]);
});

async function scaffold(invocation: CliOptions & { home: string }) {
  writeJson(join(telemetryRoot(invocation.home), "notice.json"), {
    noticeShownAt: "2026-11-25T12:34:56.000Z",
    noticeVersion: 2,
  });
  const created = await runWithIndex(["new", "go-cli", "project", "--json"], invocation);
  success(created);
  const { project, git } = Schema.decodeUnknownSync(Schema.fromJsonString(NewResult))(
    created.stdout,
  );
  expect(git).toBe("fresh");
  writeFileSync(
    join(project, "go.mod"),
    "module example.com/project\nrequire github.com/a/b/v2 v2.3.1\n",
  );
  return project;
}

async function verifyDeps(invocation: CliOptions, project: string, telemetry: TelemetryServer) {
  const result = await runWithIndex(["verify", "--json"], {
    ...invocation,
    host: { ...invocation.host, cwd: project },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(decodeResult(result.stdout).outcome).toBe("green");
  expect(splitEvents(result.stderr).rest).toBe("");
  expect(telemetry.errors).toEqual([]);
  const verifies = telemetry.events().filter((event) => event.type === "verify");
  expect(verifies).toHaveLength(1);
  return verifies.map((event) => ("deps" in event ? event.deps : undefined));
}

test.each([
  { signature: "valid", valid: true, expectedDeps: [dependency] },
  { signature: "bad", valid: false, expectedDeps: undefined },
])("verify respects a $signature allowlist signature at the index URL", async (scenario) => {
  const { server, options, indexUrl } = await serveAllowlist("other", scenario.valid);
  const telemetry = await telemetryServer();
  onTestFinished(telemetry.close);
  const invocation = {
    ...options,
    env: { ...options.env, STACKS_INDEX_URL: indexUrl, STACKS_TELEMETRY_URL: telemetry.url },
  };
  const project = await scaffold(invocation);
  expect(await verifyDeps(invocation, project, telemetry)).toEqual([scenario.expectedDeps]);
  expect(allowlistRequests(server.requests)).toEqual(["/other/allowlist.json"]);
});

test("verify ignores a cached allowlist after the index is removed", async () => {
  const { server, options, indexUrl } = await serveAllowlist();
  const telemetry = await telemetryServer();
  onTestFinished(telemetry.close);
  const withApi = {
    ...options,
    apiUrl: server.url,
    env: { ...options.env, STACKS_TELEMETRY_URL: telemetry.url },
  };
  const project = await scaffold({
    ...withApi,
    env: { ...withApi.env, STACKS_INDEX_URL: indexUrl },
  });
  expect(allowlistRequests(server.requests)).toEqual(["/v1/allowlist.json"]);
  expect(await verifyDeps(withApi, project, telemetry)).toEqual([undefined]);
});
