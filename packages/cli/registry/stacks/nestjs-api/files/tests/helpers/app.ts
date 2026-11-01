import type { LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { NotesService } from '../../src/notes/notes.service.js';

export type LogRecord = Record<string, unknown> & {
  level: string;
  message: unknown;
  context?: string;
};

/** A LoggerService that keeps records: the message, its fields and context. */
export class CaptureLogger implements LoggerService {
  readonly records: LogRecord[] = [];

  private push(level: string, message: unknown, params: unknown[]): void {
    const fields = params.filter(
      (param): param is Record<string, unknown> => typeof param === 'object' && param !== null,
    );
    const context = params.findLast((param) => typeof param === 'string');
    this.records.push(Object.assign({ level, message, context }, ...fields));
  }

  log(message: unknown, ...params: unknown[]) {
    this.push('log', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.push('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.push('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.push('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.push('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.push('fatal', message, params);
  }
}

export type TestAppOptions = {
  maxBodyBytes?: number;
  /** Stands in for NotesService, for failures the real one can't produce. */
  notes?: Partial<NotesService>;
};

/**
 * The real AppModule with configureApp applied, as src/main.ts builds it, and a
 * logger whose records the test can read. Close it in afterEach.
 */
export async function testApp(options: TestAppOptions = {}) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.notes) {
    builder.overrideProvider(NotesService).useValue(options.notes);
  }
  const moduleRef = await builder.compile();
  const logs = new CaptureLogger();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: logs,
  });
  configureApp(app, { maxBodyBytes: options.maxBodyBytes ?? 65_536 });
  await app.init();
  const requests = () => logs.records.filter((record) => record.message === 'request');
  return { app, server: app.getHttpServer(), logs, requests };
}
