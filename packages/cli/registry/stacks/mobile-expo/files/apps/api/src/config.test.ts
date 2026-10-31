import { expect, test } from 'bun:test';
import { config } from './config';

test('validates required config and port bounds without exposing values', () => {
  expect(config({ DATABASE_URL: 'postgres://localhost/app' }).PORT_API).toBe(3000);
  expect(() => config({})).toThrow('DATABASE_URL');
  expect(config({ DATABASE_URL: 'postgresql://localhost/app' }).DATABASE_URL).toBe(
    'postgresql://localhost/app',
  );
  for (const DATABASE_URL of ['https://example.com', 'mysql://localhost/app', 'invalid']) {
    expect(() => config({ DATABASE_URL })).toThrow('DATABASE_URL');
  }
  expect(() => config({ DATABASE_URL: 'postgres://localhost/app', PORT_API: '70000' })).toThrow(
    'PORT_API',
  );
});
