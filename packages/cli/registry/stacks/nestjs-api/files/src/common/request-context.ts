import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// A client's id is kept when it can't break a log line or a header.
const SAFE_ID = /^[\w=-]{1,128}$/;

const logger = new Logger('Http');

/** The request id RequestContext gave this response. */
export function requestIdOf(res: Response): string {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : '';
}

/** The route pattern that matched (never the URL, whose query may hold secrets). */
function routeOf(req: Request): string {
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? path : '(unmatched)';
}

/**
 * Express middleware registered first in configureApp, so every response
 * (body parser failures and unknown routes too) carries an X-Request-Id and
 * writes one `request` record: method, route pattern, status, duration and
 * request id. Health probes log at debug.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const given = req.get('x-request-id');
  const id = given !== undefined && SAFE_ID.test(given) ? given : randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  const started = performance.now();
  res.on('finish', () => {
    const route = routeOf(req);
    const record = {
      requestId: id,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
    };
    if (route === '/healthz') logger.debug('request', record);
    else logger.log('request', record);
  });
  next();
}
