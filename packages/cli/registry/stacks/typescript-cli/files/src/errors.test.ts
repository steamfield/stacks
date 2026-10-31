import { Cause, Schema } from "effect";
import { expect, it } from "vitest";
import {
  ErrorEnvelope,
  errorClasses,
  errorEnvelope,
  errorTable,
  exitCodeFor,
  failure,
} from "./errors";

it("maps every declared tag to its stable code and safe envelope", () => {
  expect(errorClasses.map((Class) => new Class()._tag)).toEqual(Object.keys(errorTable));
  expect(errorClasses.map((Class) => exitCodeFor(new Class()))).toEqual([2, 3, 6, 0, 130, 1]);
  for (const Class of errorClasses) {
    const error = new Class();
    expect(Schema.decodeUnknownSync(ErrorEnvelope)(errorEnvelope(error))).toEqual({
      error: { tag: error._tag, message: errorTable[error._tag].message, retryable: false },
    });
    expect(failure(Cause.fail(error))).toBeInstanceOf(Class);
  }
});
it("keeps defects and interruptions distinct", () => {
  expect(failure(Cause.die(new Error("private")))._tag).toBe("Defect");
  expect(failure(Cause.interrupt())._tag).toBe("Interrupted");
});
