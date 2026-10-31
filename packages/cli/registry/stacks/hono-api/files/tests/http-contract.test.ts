// The HTTP contract, through app.request() on the real app: statuses, envelopes, headers and the
// request log. Extend the tables for every new endpoint.
import { describe, expect, it } from "vitest";
import { ErrorEnvelope, errorTable } from "../src/errors.ts";
import { Note, NotePage } from "../src/schemas/notes.ts";
import type { NotesStore } from "../src/services/notes.ts";
import { jsonBody, testApp } from "./helpers/app.ts";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function expectEnvelope(res: Response, code: keyof typeof errorTable) {
  expect(res.status).toBe(errorTable[code].status);
  expect(res.headers.get("content-type")).toMatch(/^application\/json/);
  const body = ErrorEnvelope.parse(await res.json());
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(errorTable[code].message);
  expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  return body;
}

describe("health and the OpenAPI document", () => {
  it("GET /healthz answers ok with a request id", async () => {
    const { app, requests } = testApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("x-request-id")).toMatch(/^[\w=-]+$/);
    expect(requests()).toMatchObject([{ level: "debug", route: "/healthz", status: 200 }]);
  });

  it("GET /openapi.json documents every route and the error envelope", async () => {
    const { app } = testApp();
    const doc = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths).sort()).toEqual(["/healthz", "/v1/notes", "/v1/notes/{id}"]);
    expect(Object.keys(doc.paths["/v1/notes"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(doc.components.schemas).toHaveProperty("Error");
  });
});

describe("notes", () => {
  it("creates a note: 201, Location, and the logged request id", async () => {
    const { app, requests } = testApp();
    const res = await app.request("/v1/notes", jsonBody({ title: "First", body: "Hello" }));
    expect(res.status).toBe(201);
    const note = Note.parse(await res.json());
    expect(note).toMatchObject({ title: "First", body: "Hello" });
    expect(res.headers.get("location")).toBe(`/v1/notes/${note.id}`);
    expect(requests()).toEqual([
      expect.objectContaining({
        level: "info",
        method: "POST",
        route: "/v1/notes",
        status: 201,
        requestId: res.headers.get("x-request-id"),
      }),
    ]);

    const fetched = await app.request(`/v1/notes/${note.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(note);
  });

  it("pages the list with limit and nextCursor", async () => {
    const { app } = testApp();
    for (const title of ["a", "b", "c"]) await app.request("/v1/notes", jsonBody({ title }));
    const first = NotePage.parse(await (await app.request("/v1/notes?limit=2")).json());
    expect(first.items.map((note) => note.title)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBe(first.items[1]?.id);
    const second = NotePage.parse(
      await (await app.request(`/v1/notes?limit=2&cursor=${first.nextCursor}`)).json(),
    );
    expect(second.items.map((note) => note.title)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps a supplied safe request id and replaces an unsafe one", async () => {
    const { app } = testApp();
    const kept = await app.request("/healthz", { headers: { "x-request-id": "abc-123" } });
    expect(kept.headers.get("x-request-id")).toBe("abc-123");
    const replaced = await app.request("/healthz", {
      headers: { "x-request-id": 'evil" level=fatal' },
    });
    expect(replaced.headers.get("x-request-id")).toMatch(/^[\w=-]+$/);
  });
});

describe("errors", () => {
  it.each([
    ["missing title", { body: "no title" }, "json.title"],
    ["empty title", { title: "  " }, "json.title"],
    ["unknown field", { title: "x", extra: true }, "json"],
    ["wrong type", { title: 42 }, "json.title"],
  ])("POST /v1/notes with %s is the 400 envelope with issues", async (_, body, path) => {
    const { app } = testApp();
    const res = await app.request("/v1/notes", jsonBody(body));
    const envelope = await expectEnvelope(res, "bad_request");
    expect(envelope.error.issues?.map((issue) => issue.path)).toContain(path);
  });

  it.each([
    ["an unknown query key", "/v1/notes?sort=title"],
    ["a limit out of range", "/v1/notes?limit=0"],
    ["a malformed id", "/v1/notes/not-a-uuid"],
  ])("%s is the 400 envelope", async (_, path) => {
    const { app } = testApp();
    await expectEnvelope(await app.request(path), "bad_request");
  });

  it("malformed JSON is the 400 envelope", async () => {
    const { app } = testApp();
    const res = await app.request("/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    await expectEnvelope(res, "bad_request");
  });

  it("a body that isn't JSON is the 415 envelope", async () => {
    const { app } = testApp();
    const res = await app.request("/v1/notes", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "title=x",
    });
    await expectEnvelope(res, "unsupported_media_type");
  });

  it("a body over the limit is the 413 envelope", async () => {
    const { app } = testApp({ maxBodyBytes: 64 });
    const res = await app.request("/v1/notes", jsonBody({ title: "x".repeat(200) }));
    await expectEnvelope(res, "payload_too_large");
  });

  it.each([
    ["an unknown path", "GET", "/nope"],
    ["a missing note", "GET", `/v1/notes/${MISSING_ID}`],
    ["a wrong method", "DELETE", "/v1/notes"],
  ])("%s is the 404 envelope with one request record", async (_, method, path) => {
    const { app, requests } = testApp();
    const res = await app.request(path, { method });
    await expectEnvelope(res, "not_found");
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).toMatchObject({ status: 404 });
  });

  it("a thrown defect is a generic 500; the log has its class, not its message", async () => {
    const failing: NotesStore = {
      list: () => Promise.reject(new TypeError("db password=hunter2")),
      get: () => Promise.reject(new Error("unused")),
      create: () => Promise.reject(new Error("unused")),
    };
    const { app, records } = testApp({ notes: failing });
    const res = await app.request("/v1/notes");
    const envelope = await expectEnvelope(res, "internal");
    expect(JSON.stringify(envelope)).not.toContain("hunter2");
    const logged = records.find((record) => record.msg === "unhandled error");
    expect(logged).toMatchObject({ errorClass: "TypeError", requestId: envelope.error.requestId });
    expect(JSON.stringify(records)).not.toContain("hunter2");
  });
});
