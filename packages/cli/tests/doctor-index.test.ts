import { Schema } from "effect";
import { expect, test } from "vitest";
import { DoctorReport } from "../src/schemas/doctor";
import { ListResult } from "../src/schemas/list";
import { index, indexEtag, indexPath, serveIndex } from "./fixtures/index/refresh";
import { newRegistry } from "./helpers/registry";
import { remoteCli, success } from "./helpers/remote-index";

const decodeDoctor = Schema.decodeUnknownSync(Schema.fromJsonString(DoctorReport), {
  onExcessProperty: "error",
});

test.each([
  { name: "with an ETag", etag: indexEtag },
  { name: "without an ETag", etag: undefined },
])("doctor reports the cached index header after a fetch $name", async ({ etag }) => {
  const { home, server } = await serveIndex();
  if (etag !== undefined) server.setEtag(etag);
  const options = { home, server, host: { registry: newRegistry } };
  const listed = await remoteCli(["list", "--json"], options);
  success(listed);
  Schema.decodeUnknownSync(Schema.fromJsonString(ListResult))(listed.stdout);
  expect([...server.requests].sort()).toEqual(["/v1/allowlist.json", indexPath]);

  const doctor = await remoteCli(["doctor", "--json"], options);
  success(doctor);
  const { remoteIndex } = decodeDoctor(doctor.stdout);
  expect(remoteIndex).toMatchObject({
    isDefaultUrl: true,
    lastOutcome: "ok",
    commit: index.commit,
    generatedAt: index.generatedAt,
    minCli: index.minCli,
  });
  if (etag === undefined) expect(remoteIndex).not.toHaveProperty("etag");
  else expect(remoteIndex).toHaveProperty("etag", etag);
  expect([...server.requests].sort()).toEqual(["/v1/allowlist.json", indexPath]);
});

test("doctor omits all four index metadata keys before any fetch", async () => {
  const { home, server } = await serveIndex();
  const doctor = await remoteCli(["doctor", "--json"], {
    home,
    server,
    host: { registry: newRegistry },
  });
  success(doctor);
  const { remoteIndex } = decodeDoctor(doctor.stdout);
  expect(remoteIndex).toEqual({
    url: expect.any(String),
    isDefaultUrl: true,
    offline: false,
    cachedAt: null,
    lastAttempt: null,
    lastOutcome: null,
    backoffUntil: null,
  });
  expect(server.requests).toEqual([]);
});
