import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  BadRequestError,
  envelope,
  issuesFrom,
  NotFoundError,
  toAppError,
} from './errors.js';

describe('toAppError', () => {
  it('keeps an AppError as it is', () => {
    const error = new NotFoundError();
    expect(toAppError(error)).toBe(error);
    expect(error.status).toBe(404);
  });

  it.each([
    [new BadRequestException(), 'bad_request'],
    [new NotFoundException(), 'not_found'],
  ] as const)("maps Nest's %s to %s", (exception, code) => {
    expect(toAppError(exception).code).toBe(code);
  });

  it("maps the body parser's errors by status", () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    expect(toAppError(tooLarge).code).toBe('payload_too_large');
  });

  it('hides anything else behind the internal row', () => {
    const error = toAppError(new Error('secret detail'));
    expect(error.code).toBe('internal');
    expect(error.message).toBe('Internal server error.');
  });
});

describe('issuesFrom', () => {
  it('flattens nested constraints into dotted paths', () => {
    const issues = issuesFrom([
      { property: 'title', constraints: { isNotEmpty: 'title is empty' } },
      {
        property: 'meta',
        children: [{ property: 'tag', constraints: { isString: 'bad tag' } }],
      },
    ]);
    expect(issues).toEqual([
      { path: 'title', message: 'title is empty' },
      { path: 'meta.tag', message: 'bad tag' },
    ]);
  });
});

describe('envelope', () => {
  it('carries issues only when there are some', () => {
    expect(envelope(new AppError('not_found'), 'r1')).toEqual({
      error: { code: 'not_found', message: 'Resource not found.', requestId: 'r1' },
    });
    const issues = [{ path: 'title', message: 'Required' }];
    expect(envelope(new BadRequestError(issues), 'r2').error.issues).toEqual(issues);
  });
});
