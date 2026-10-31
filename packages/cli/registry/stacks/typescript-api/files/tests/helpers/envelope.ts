import { Schema } from "effect";
import { expect } from "vitest";
import { type ApiErrorTag, apiErrorTable, ErrorEnvelope } from "../../src/errors.ts";

export async function expectEnvelope(response: Response, tag: ApiErrorTag) {
  const row = apiErrorTable[tag];
  expect(response.status).toBe(row.status);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const envelope = Schema.decodeUnknownSync(ErrorEnvelope)(body);
  expect(envelope).toEqual({ error: { tag, message: row.message, retryable: row.retryable } });
  return envelope;
}
