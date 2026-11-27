import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { Command } from "effect/cli";
import { expect, test } from "vitest";
import { CLI_BUILD, SOURCE_BUILD } from "../src/build";
import { cli } from "../src/cli";
import { HOSTED_API_URL, OFFICIAL_INDEX_URL } from "../src/constants";
import { RemoteIndex } from "../src/core/registry/remote/service";
import { DoctorReport } from "../src/schemas/doctor";
import { ListResult } from "../src/schemas/list";
import { VERSION } from "../src/version";
import { index, remoteTestDirectory, signIndex } from "./fixtures/index/refresh";
import { runCli } from "./helpers/cli";
import { environment, execute, keys, success } from "./helpers/remote-index";
import { registry, writeJson } from "./helpers/telemetry";

test("only STACKS_PUBLISH=1 defines a published build", async () => {
  const { path: cwd } = remoteTestDirectory();
  const environments: Parameters<typeof import("../scripts/build").buildDefines>[0][] = [
    { STACKS_PUBLISH: "1" },
    {},
    { STACKS_PUBLISH: "0" },
  ];
  const buildScript = join(import.meta.dirname, "../scripts/build.ts");
  // Native module linking reports a missing export before the current build entry point can run.
  const probe = `
    import { buildDefines } from ${JSON.stringify(buildScript)};
    console.log(JSON.stringify(${JSON.stringify(environments)}.map((env) => buildDefines(env))));
  `;
  const result = await execute(
    "bun",
    ["--no-env-file", "--config=/dev/null", "--eval", probe],
    cwd,
    environment(cwd),
  );
  success(result);
  expect(JSON.parse(result.stdout)).toMatchObject([
    { STACKS_PUBLISHED_BUILD: "true", STACKS_RELEASE_BUILD: "true" },
    { STACKS_PUBLISHED_BUILD: "false", STACKS_RELEASE_BUILD: "true" },
    { STACKS_PUBLISHED_BUILD: "false", STACKS_RELEASE_BUILD: "true" },
  ]);
});

test("bundled CLIs enable the official index only with the published define set to true", async () => {
  const { path: cwd } = remoteTestDirectory();
  const cliBuild = join(import.meta.dirname, "../src/build.ts");
  const probe = `
    import { CLI_BUILD } from ${JSON.stringify(cliBuild)};
    console.log(JSON.stringify(CLI_BUILD.officialIndexUrl ?? null));
  `;
  for (const published of [false, true]) {
    const result = await execute(
      "bun",
      [
        "--no-env-file",
        "--config=/dev/null",
        "--define",
        "STACKS_RELEASE_BUILD:true",
        "--define",
        `STACKS_PUBLISHED_BUILD:${published}`,
        "--eval",
        probe,
      ],
      cwd,
      environment(cwd),
    );
    success(result);
    expect(JSON.parse(result.stdout)).toBe(
      published ? new URL("v1/index.json", `${HOSTED_API_URL}/`).href : null,
    );
  }
});

test("the official index URL is under the hosted API and source runs leave it disabled", () => {
  expect(SOURCE_BUILD.officialIndexUrl).toBeUndefined();
  expect(CLI_BUILD.officialIndexUrl).toBeUndefined();
  expect(OFFICIAL_INDEX_URL).toBe(new URL("v1/index.json", `${HOSTED_API_URL}/`).href);
});

test("a published build reports its trusted default index and fetches the adjacent allowlist", async () => {
  const temporary = remoteTestDirectory();
  const home = join(temporary.path, "home");
  const root = join(temporary.path, "published");
  mkdirSync(home);
  writeJson(join(root, "v1/index.json"), signIndex(index));
  writeJson(
    join(root, "v1/allowlist.json"),
    signIndex({
      formatVersion: 1,
      generatedAt: index.generatedAt,
      names: { npm: [], pypi: [], go: [], crates: [] },
    }),
  );
  const server = await temporary.serve(root);
  const indexUrl = `${server.url}/v1/index.json`;
  const options = {
    home,
    env: environment(home),
    releaseBuild: true,
    build: { officialIndexUrl: indexUrl },
    allowlistKeys: keys,
    host: { registry },
  };
  const remote = RemoteIndex.layer({ keys });
  const run = (args: string[]) =>
    runCli(args, {
      ...options,
      program: Command.runWith(cli, { version: VERSION, renderErrors: false })(args).pipe(
        Effect.provide(remote),
      ),
    });
  const doctor = await run(["doctor", "--json"]);
  success(doctor);
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(DoctorReport))(doctor.stdout);
  expect(report.remoteIndex).toMatchObject({ url: indexUrl, isDefaultUrl: true });

  const beforeList = server.requests.length;
  const list = await run(["list", "--json"]);
  success(list);
  const catalog = Schema.decodeUnknownSync(Schema.fromJsonString(ListResult))(list.stdout);
  expect(catalog.entries).toContainEqual(expect.objectContaining({ id: "go-cli" }));
  expect(catalog.rejected).toEqual([]);
  expect(server.requests.slice(beforeList)).toEqual(
    expect.arrayContaining(["/v1/index.json", "/v1/allowlist.json"]),
  );
});
