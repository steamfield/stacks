import { Schema } from "effect";
import { expect, it } from "vitest";
import {
  apiErrors,
  apiErrorTable,
  ErrorEnvelope,
  errorClasses,
  errorEnvelope,
  tagForStatus,
} from "./errors.ts";

it("every tagged error has a fixed safe message and one exhaustive status row", () => {
  expect(errorClasses.map((ErrorClass) => new ErrorClass()._tag).sort()).toEqual(
    Object.keys(apiErrorTable).sort(),
  );
  for (const ErrorClass of errorClasses) {
    const error = new ErrorClass();
    const row = apiErrorTable[error._tag];
    expect(error.message).toBe(row.message);
    expect(tagForStatus(row.status)).toBe(error._tag);
    expect(Schema.decodeUnknownSync(ErrorEnvelope)(errorEnvelope(error._tag))).toEqual({
      error: { tag: error._tag, message: row.message, retryable: row.retryable },
    });
  }
  expect(tagForStatus(599)).toBe("Defect");
});

it("declared error codecs encode the public envelope and decode back to tagged errors", () => {
  for (const [index, schema] of apiErrors.entries()) {
    const ErrorClass = errorClasses[index];
    if (ErrorClass === undefined) throw new Error("Missing error class");
    const error = new ErrorClass();
    const encoded = Schema.encodeUnknownSync(schema)(error);
    expect(encoded).toEqual(errorEnvelope(error._tag));
    expect(Schema.decodeUnknownSync(schema)(encoded)).toMatchObject({ _tag: error._tag });
  }
});
