import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { envelope, toAppError } from './errors.js';
import { requestIdOf } from './request-context.js';

/**
 * The global filter (APP_FILTER in AppModule): everything thrown while
 * handling a request leaves as `{ error: { code, message, requestId, issues? } }`
 * with the status from errorTable.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestIdOf(res);
    const error = toAppError(exception);
    if (error.code === 'internal') {
      // The class and stack go to the log; the message may hold secrets.
      const cause = exception instanceof Error ? exception : undefined;
      this.logger.error('unhandled error', {
        requestId,
        errorClass: cause?.constructor.name ?? typeof exception,
        stack: cause?.stack?.split('\n').slice(1).join('\n'),
      });
    }
    res.status(error.status).json(envelope(error, requestId));
  }
}
