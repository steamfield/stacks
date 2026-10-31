import { HttpException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/**
 * The one status table. Every error response comes from a row here, so a code
 * always means the same status and the same safe message.
 */
export const errorTable = {
  bad_request: { status: 400, message: 'Invalid request.' },
  not_found: { status: 404, message: 'Resource not found.' },
  payload_too_large: { status: 413, message: 'Request body is too large.' },
  internal: { status: 500, message: 'Internal server error.' },
} as const;

export type ErrorCode = keyof typeof errorTable;
export type ErrorStatus = (typeof errorTable)[ErrorCode]['status'];

/** One field the validator rejected: where it is and why, never the value sent. */
export type Issue = { path: string; message: string };

/**
 * A failure the API reports on purpose. Services throw a subclass; the global
 * ErrorEnvelopeFilter renders it. Services never throw HttpException.
 */
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
    super('not_found');
  }
}

export class BadRequestError extends AppError {
  constructor(issues?: Issue[]) {
    super('bad_request', issues);
  }
}

/** Flattens class-validator errors into issues, nested paths joined with dots. */
export function issuesFrom(errors: ValidationError[], parent = ''): Issue[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      path,
      message,
    }));
    return [...own, ...issuesFrom(error.children ?? [], path)];
  });
}

function codeForStatus(status: number): ErrorCode {
  const row = Object.entries(errorTable).find(([, v]) => v.status === status);
  return (row?.[0] as ErrorCode | undefined) ?? 'internal';
}

/** Express's body parser reports a malformed or oversized body with a status. */
function parserStatus(error: unknown): number | undefined {
  if (!(error instanceof Error) || !('type' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Maps anything thrown to an AppError. Nest's HttpExceptions (an unknown route,
 * a ParseUUIDPipe failure) and the body parser's errors keep their status when
 * the table has a row for it; anything else is an internal error whose message
 * never reaches the client.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof HttpException) {
    return new AppError(codeForStatus(error.getStatus()));
  }
  const status = parserStatus(error);
  if (status !== undefined) return new AppError(codeForStatus(status));
  return new AppError('internal');
}

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    issues?: Issue[];
  };
};

export function envelope(error: AppError, requestId: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.issues ? { issues: error.issues } : {}),
    },
  };
}
