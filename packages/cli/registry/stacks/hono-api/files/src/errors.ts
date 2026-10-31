import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

/**
 * The one status table. Every error response comes from a row here, so a code always means the
 * same status and the same safe message.
 */
export const errorTable = {
  bad_request: { status: 400, message: "Invalid request." },
  not_found: { status: 404, message: "Resource not found." },
  payload_too_large: { status: 413, message: "Request body is too large." },
  unsupported_media_type: { status: 415, message: "Expected a JSON body." },
  internal: { status: 500, message: "Internal server error." },
} as const;

export type ErrorCode = keyof typeof errorTable;
export type ErrorStatus = (typeof errorTable)[ErrorCode]["status"];

/** One field the validator rejected: where it is and why, never the value sent. */
export type Issue = { path: string; message: string };

/** A failure the API reports on purpose. Throw a subclass; app.onError renders it. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly issues: Issue[] | undefined;

  constructor(code: ErrorCode, issues?: Issue[]) {
    super(errorTable[code].message);
    this.name = new.target.name;
    this.code = code;
    this.issues = issues;
  }

  get status(): ErrorStatus {
    return errorTable[this.code].status;
  }
}

export class NotFoundError extends AppError {
  constructor() {
    super("not_found");
  }
}

export class BadRequestError extends AppError {
  constructor(issues?: Issue[]) {
    super("bad_request", issues);
  }
}

export const IssueSchema = z.object({ path: z.string(), message: z.string() });

export const ErrorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(Object.keys(errorTable) as [ErrorCode, ...ErrorCode[]]),
      message: z.string(),
      requestId: z.string(),
      issues: z.array(IssueSchema).optional(),
    }),
  })
  .openapi("Error");

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** The OpenAPI response entry for an error status, so every route documents the same body. */
export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorEnvelope } } };
}

function codeForStatus(status: number): ErrorCode {
  const row = Object.entries(errorTable).find(([, value]) => value.status === status);
  return (row?.[0] as ErrorCode | undefined) ?? "internal";
}

/**
 * Maps anything thrown to an AppError. Hono's own HTTPExceptions (malformed JSON, a missing
 * content type, the body limit) keep their status when the table has a row for it; anything else
 * is an internal error whose message never reaches the client.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof HTTPException) return new AppError(codeForStatus(error.status));
  return new AppError("internal");
}

export function envelope(error: AppError, requestId: string): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.issues ? { issues: error.issues } : {}),
    },
  };
}
