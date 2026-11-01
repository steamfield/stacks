import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, levelsFrom } from './logging.js';

function captureStdout() {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    for (const line of String(chunk).split('\n').filter(Boolean)) {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('levelsFrom', () => {
  it('keeps the named level and every level above it', () => {
    expect(levelsFrom('warn')).toEqual(['warn', 'error', 'fatal']);
    expect(levelsFrom('verbose')).toHaveLength(6);
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line with fields at the top level', () => {
    const lines = captureStdout();
    const logger = new Logger('Http');
    Logger.overrideLogger(createLogger('debug'));
    logger.log('request', { requestId: 'r1', status: 201 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'log',
      message: 'request',
      context: 'Http',
      requestId: 'r1',
      status: 201,
    });
  });

  it('redacts secret-shaped keys at any depth', () => {
    const lines = captureStdout();
    const logger = createLogger('log');
    logger.log('event', { password: 'p1', user: { token: 't1', name: 'ada' } });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('p1');
    expect(text).not.toContain('t1');
    expect(text).toContain('ada');
  });

  it('drops levels below the one configured', () => {
    const lines = captureStdout();
    const logger = createLogger('warn');
    logger.log('quiet');
    logger.debug('quieter');
    expect(lines).toEqual([]);
  });
});
