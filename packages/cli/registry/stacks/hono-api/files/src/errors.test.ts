import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { AppError, BadRequestError, envelope, NotFoundError, toAppError } from "./errors.ts";

describe("toAppError", () => {
  it("keeps an AppError as it is", () => {
    const error = new NotFoundError();
    expect(toAppError(error)).toBe(error);
    expect(error.status).toBe(404);
  });

  it.each([
    [400, "bad_request"],
    [413, "payload_too_large"],
    [415, "unsupported_media_type"],
    [401, "internal"],
  ] as const)("maps Hono's HTTPException %i to %s", (status, code) => {
    expect(toAppError(new HTTPException(status)).code).toBe(code);
  });

  it("hides anything else behind the internal row", () => {
    const error = toAppError(new Error("secret detail"));
    expect(error.code).toBe("internal");
    expect(error.message).toBe("Internal server error.");
  });
});

describe("envelope", () => {
  it("carries issues only when there are some", () => {
    expect(envelope(new AppError("not_found"), "r1")).toEqual({
      error: { code: "not_found", message: "Resource not found.", requestId: "r1" },
    });
    const issues = [{ path: "json.title", message: "Required" }];
    expect(envelope(new BadRequestError(issues), "r2").error.issues).toEqual(issues);
  });
});
