import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { SearchResponse } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { afterAll, beforeAll, expect, test } from "vitest";
import { NewResult } from "../src/schemas/new";
import { ShowReport } from "../src/schemas/show";
import { tempDir } from "./helpers/cli";
import {
  buildRemoteFixture,
  type RemoteServer,
  remoteCli,
  remoteServer,
} from "./helpers/remote-index";
import { apiOptions, decoded, officialHit, response, validResponse } from "./helpers/search-api";
import { put } from "./helpers/search-metadata";

const scratch = tempDir();
const apiRoot = join(scratch.path, "search-api");
let api: RemoteServer;
let index: RemoteServer;
beforeAll(async () => {
  const fixture = await buildRemoteFixture(scratch.path);
  api = await remoteServer(apiRoot);
  index = await remoteServer(fixture.out);
}, 90_000);
afterAll(async () => {
  await api?.close();
  await index?.close();
  scratch.cleanup();
});

test("an API-only stack is discoverable and show/new resolve it through the signed index [4.5e#15]", async () => {
  const home = realpathSync(scratch.path);
  // The host changes at the loopback boundary. The prefix still distinguishes the API route.
  const options = apiOptions(home, `${api.url}/api/`);
  const invoke = (server: RemoteServer, args: string[]) =>
    remoteCli(args, { ...options, home, server });
  // Above every bundled stack's local score, so the API's own hit leads the merged list.
  const hit = officialHit("sample", { score: 1 });
  const body = response([hit]);
  const wire = response([{ ...hit, evidence: { lastRun: null } }]);
  put(
    join(apiRoot, "api/v1/search"),
    JSON.stringify(Schema.encodeUnknownSync(SearchResponse)(wire)),
  );
  const local = decoded(
    await invoke(api, ["search", "sample", "--local", "--limit", "20", "--json"]),
  );
  expect(local.stacks.some(({ id }) => id === "sample")).toBe(false);
  const found = decoded(await invoke(api, ["search", "sample", "--json"]));
  expect(found).toMatchObject({ ranking: "api", remote: "used" });
  expect(found.stacks[0]).toEqual(body.stacks[0]);
  expect(index.requests).toEqual([]);
  const shown = await invoke(index, ["show", "sample", "--json"]);
  expect(shown.status, shown.stderr).toBe(0);
  expect(shown.stderr).toBe("");
  expect(Schema.decodeUnknownSync(ShowReport)(JSON.parse(shown.stdout))).toMatchObject({
    id: "sample",
    origin: "index",
    trusted: true,
  });
  expect(index.requests).toContain("/v1/index.json");
  expect(index.requests.some((path) => path.startsWith("/v1/entries/stack/sample/"))).toBe(true);
  const target = join(scratch.path, "new-project");
  const created = await invoke(index, [
    "new",
    "sample",
    target,
    "--sandbox",
    "--no-launch",
    "--json",
  ]);
  expect(created.status, created.stderr).toBe(0);
  expect(created.stderr).toBe("");
  const result = Schema.decodeUnknownSync(NewResult)(JSON.parse(created.stdout));
  expect(result).toMatchObject({ stack: "sample", untrusted: [], handoff: { untrusted: [] } });
  expect(existsSync(join(target, ".stacks/manifest.json"))).toBe(true);
  expect(JSON.parse(readFileSync(join(target, ".stacks/manifest.json"), "utf8"))).toMatchObject({
    stack: { id: "sample", origin: "index", trusted: true },
  });
  expect(api.requests).toEqual(["/api/v1/search"]);
  expect(index.requests).not.toContain("/api/v1/search");
  await validResponse(body);
});
