import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULTS, validateEnv } from './env.js';

describe('validateEnv', () => {
  it('uses defaults for an empty environment', () => {
    expect(validateEnv({})).toEqual(DEFAULTS);
  });

  it('prefers PORT_API, falls back to PORT, and treats empty values as unset', () => {
    expect(validateEnv({ PORT_API: '8080', PORT: '9000' }).PORT_API).toBe(8080);
    expect(validateEnv({ PORT: '9000' }).PORT_API).toBe(9000);
    expect(validateEnv({ PORT_API: '', PORT: '' }).PORT_API).toBe(3000);
  });

  it('reads LOG_LEVEL case-insensitively', () => {
    expect(validateEnv({ LOG_LEVEL: 'DEBUG' }).LOG_LEVEL).toBe('debug');
  });

  it('ignores variables it does not own', () => {
    expect(validateEnv({ HOME: '/home/someone' })).toEqual(DEFAULTS);
  });

  it.each([
    ['PORT_API', 'eighty'],
    ['PORT_API', '70000'],
    ['LOG_LEVEL', 'loud'],
    ['MAX_BODY_BYTES', '0'],
  ])('rejects %s=%s naming the variable, not the value', (key, value) => {
    const run = () => validateEnv({ [key]: value });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(key);
    expect(run).not.toThrow(value);
  });
});
