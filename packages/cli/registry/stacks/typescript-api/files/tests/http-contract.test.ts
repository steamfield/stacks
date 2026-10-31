import { spawnSync } from "node:child_process";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { apiErrorTable, errorClasses } from "../src/errors.ts";
import { HealthStatus } from "../src/schemas/index.ts";
import { expectEnvelope } from "./helpers/envelope.ts";
import { sentinel } from "./helpers/failures.ts";
import { target, targets } from "./helpers/targets.ts";

const post = (body: string, contentType = "application/json"): RequestInit => ({
  method: "POST",
  headers: { "content-type": contentType },
  body,
});
const checks = "/v1/health-checks/live";

for (const kind of targets)
  describe(kind, () => {
    it("serves schema-decoded health, ordinary headers, and one correlated debug record", async () => {
      const app = await target(kind);
      const response = await app.request("/healthz", {
        headers: { accept: "application/json", "x-extra": "allowed" },
      });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(Schema.decodeUnknownSync(HealthStatus)(body)).toEqual({ status: "ok" });
      expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({
        level: "debug",
        msg: "request",
        method: "GET",
        path: "/healthz",
        status: 200,
        requestId: response.headers.get("x-request-id"),
        durationMs: expect.any(Number),
        time: expect.any(String),
      });
      expect(app.records[0]?.time).toMatch(/Z$/);
      expect(app.records[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns a supplied safe id and correlates the sanitized defect and request", async () => {
      const app = await target(kind);
      const response = await app.request("/__contract/defect", {
        headers: { "x-request-id": "caller_123-abc" },
      });
      await expectEnvelope(response, "Defect");
      expect(response.headers.get("x-request-id")).toBe("caller_123-abc");
      expect(app.records).toHaveLength(2);
      expect(app.records.filter((r) => r.msg === "defect")).toHaveLength(1);
      expect(app.records.filter((r) => r.msg === "request")).toHaveLength(1);
      for (const record of app.records) expect(record.requestId).toBe("caller_123-abc");
      const defect = app.records.find((r) => r.msg === "defect");
      expect(defect?.error).toMatchObject({
        class: "TypeError",
        stack: expect.arrayContaining([expect.stringMatching(/^at /)]),
      });
      expect(JSON.stringify(app.records)).not.toContain(sentinel);
      expect(JSON.stringify([...response.headers])).not.toContain(sentinel);
    });

    it.each([undefined, "unsafe id", "x".repeat(65), 'id,{"injected":true}'])(
      "replaces unsafe or missing id %j",
      async (id) => {
        const app = await target(kind);
        const response = await app.request(
          "/healthz",
          id === undefined ? {} : { headers: { "x-request-id": id } },
        );
        await response.arrayBuffer();
        const returned = response.headers.get("x-request-id");
        expect(returned).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(returned).not.toBe(id);
        expect(app.records).toHaveLength(1);
        expect(app.records[0]?.requestId).toBe(returned);
        expect(app.records[0]).not.toHaveProperty("injected");
      },
    );

    it.each([
      ["/absent?private=value", {}],
      ["/healthz", { method: "POST" }],
    ])("envelopes route miss %s", async (path, init) => {
      const app = await target(kind);
      const response = await app.request(path, init);
      await expectEnvelope(response, "NotFound");
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({ msg: "request", status: 404, path: "<unmatched>" });
      expect(JSON.stringify(app.records)).not.toContain("private=value");
    });

    it("accepts the proving payload and logs the route pattern without path params", async () => {
      const app = await target(kind);
      const response = await app.request(`${checks}?verbose=true`, post('{"message":"ready"}'));
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(Schema.decodeUnknownSync(HealthStatus)(body)).toEqual({ status: "ok" });
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({
        msg: "request",
        method: "POST",
        path: "/v1/health-checks/:checkId",
        status: 200,
      });
    });

    it.each([
      [`${checks}?verbose=invalid`, post('{"message":"ready"}')],
      [`${checks}?unknown=yes`, post('{"message":"ready"}')],
      ["/healthz?unknown=yes", {}],
      ["/v1/health-checks/absent", post('{"message":"ready"}')],
      [checks, post('{"message":7}')],
      [checks, post('{"message":""}')],
      [checks, post(JSON.stringify({ message: "x".repeat(65) }))],
      [checks, post('{"broken"')],
      ["/__contract/headers", { headers: { "x-proof": "wrong", accept: "application/json" } }],
    ])("envelopes invalid input at %s", async (path, init) => {
      const app = await target(kind);
      await expectEnvelope(await app.request(path, init), "BadInput");
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({ msg: "request", status: 400 });
    });

    it("preserves the framework's unsupported media status and rewrites its response", async () => {
      const app = await target(kind);
      await expectEnvelope(
        await app.request(checks, post("ready", "text/plain")),
        "UnsupportedMediaType",
      );
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({ msg: "request", status: 415 });
    });

    for (const ErrorClass of errorClasses)
      it(`maps declared ${new ErrorClass()._tag} through the error table`, async () => {
        const app = await target(kind);
        const tag = new ErrorClass()._tag;
        await expectEnvelope(await app.request(`/__contract/errors/${tag}`), tag);
        expect(app.records.filter((r) => r.msg === "request")).toHaveLength(1);
        expect(app.records[0]?.status).toBe(apiErrorTable[tag].status);
      });

    it("classifies response encoding failure as a defect, never bad input", async () => {
      const app = await target(kind);
      await expectEnvelope(await app.request("/__contract/encoding"), "Defect");
      expect(app.records).toHaveLength(2);
      expect(app.records.filter((r) => r.msg === "defect")).toHaveLength(1);
      expect(app.records.filter((r) => r.msg === "request")).toHaveLength(1);
    });

    it("serves OpenAPI generated from the health and payload declarations", async () => {
      const app = await target(kind);
      const response = await app.request("/openapi.json");
      expect(response.status).toBe(200);
      const document: unknown = await response.json();
      const decoded = Schema.decodeUnknownSync(
        Schema.Struct({
          paths: Schema.Record(Schema.String, Schema.Unknown),
          components: Schema.Struct({
            schemas: Schema.Record(Schema.String, Schema.Unknown),
          }),
        }),
      )(document);
      expect(decoded.paths).toHaveProperty("/healthz");
      expect(decoded.paths).toHaveProperty("/v1/health-checks/{checkId}");
      const health = Schema.decodeUnknownSync(
        Schema.Struct({
          get: Schema.Struct({
            responses: Schema.Record(Schema.String, Schema.Unknown),
          }),
        }),
      )(decoded.paths["/healthz"]);
      const declared = Schema.decodeUnknownSync(
        Schema.Struct({
          content: Schema.Struct({
            "application/json": Schema.Struct({ schema: Schema.Struct({ $ref: Schema.String }) }),
          }),
        }),
      )(health.get.responses["400"]);
      const key = declared.content["application/json"].schema.$ref.split("/").at(-1);
      if (key === undefined) throw new Error("Missing schema reference");
      const badInput = JSON.stringify(decoded.components.schemas[key]);
      expect(badInput).toContain('"error"');
      expect(badInput).not.toContain('"_tag"');
    });

    it("keeps endpoint caching and leaves a bodyless 304 alone", async () => {
      const app = await target(kind);
      const cached = await app.request("/__contract/cached");
      expect(cached.headers.get("cache-control")).toBe("public, max-age=60");
      expect(await cached.text()).toBe("cached");
      const unchanged = await app.request("/__contract/not-modified");
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("cache-control")).toBeNull();
      expect(await unchanged.text()).toBe("");
      expect(app.records).toHaveLength(2);
    });

    it("treats undeclared HEAD as a route miss, with no wire body", async () => {
      const app = await target(kind);
      const response = await app.request("/healthz", { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(response.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(await response.text()).toBe("");
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({ msg: "request", status: 404, path: "<unmatched>" });
    });

    it("envelopes an oversized real JSON body at the configured byte limit", async () => {
      const app = await target(kind);
      const oversized = `${" ".repeat(2048)}{"message":"ready"}`;
      await expectEnvelope(await app.request(checks, post(oversized)), "PayloadTooLarge");
      expect(app.records).toHaveLength(1);
      expect(app.records[0]).toMatchObject({ msg: "request", status: 413 });
      const boundary = `${" ".repeat(1024 - '{"message":"ready"}'.length)}{"message":"ready"}`;
      const accepted = await app.request(checks, post(boundary));
      expect(accepted.status).toBe(200);
      await accepted.arrayBuffer();
    });

    it("logs even a defect without an error value exactly once", async () => {
      const app = await target(kind);
      await expectEnvelope(await app.request("/__contract/empty-defect"), "Defect");
      expect(app.records).toHaveLength(2);
      expect(app.records.filter((record) => record.msg === "defect")).toHaveLength(1);
    });

    it("allows ordinary headers beside a declared header and accepts the payload length boundary", async () => {
      const app = await target(kind);
      const headers = await app.request("/__contract/headers", {
        headers: { "x-proof": "yes", "x-extra": "allowed", accept: "application/json" },
      });
      expect(headers.status).toBe(200);
      await headers.arrayBuffer();
      const maximum = await app.request(checks, post(JSON.stringify({ message: "x".repeat(64) })));
      expect(maximum.status).toBe(200);
      await maximum.arrayBuffer();
      expect(app.records).toHaveLength(2);
    });
  });

it("invalid live configuration fails startup visibly before listening", () => {
  const result = spawnSync(process.execPath, ["src/platform/node.ts"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, PORT_API: "invalid", LOG_LEVEL: "debug" },
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("PORT_API");
});
