import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min, validateSync } from 'class-validator';
import { type AppLogLevel, LOG_LEVELS } from '../common/logging.js';

/** The validated settings ConfigService serves (`ConfigService<Env, true>`). */
export type Env = {
  PORT_API: number;
  LOG_LEVEL: AppLogLevel;
  /** Requests with a larger JSON body get the 413 envelope. */
  MAX_BODY_BYTES: number;
};

export const DEFAULTS: Env = {
  PORT_API: 3000,
  LOG_LEVEL: 'log',
  MAX_BODY_BYTES: 65_536,
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;

class RawEnv {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65_535)
  PORT_API?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65_535)
  PORT?: number;

  @IsOptional()
  @Transform(lower)
  @IsIn(LOG_LEVELS)
  LOG_LEVEL?: AppLogLevel;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MAX_BODY_BYTES?: number;
}

/**
 * ConfigModule's `validate`: parses the environment once at boot and throws
 * ConfigError naming each bad variable (never its value). An empty value means
 * "use the default", the same as leaving the line out of .env. PORT is the
 * fallback when PORT_API is unset.
 */
export function validateEnv(env: Record<string, unknown>): Env {
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const raw = plainToInstance(RawEnv, set);
  const errors = validateSync(raw, { whitelist: true });
  if (errors.length > 0) {
    const names = errors.map((error) => error.property).join(', ');
    throw new ConfigError(`Invalid configuration: ${names}`);
  }
  return {
    PORT_API: raw.PORT_API ?? raw.PORT ?? DEFAULTS.PORT_API,
    LOG_LEVEL: raw.LOG_LEVEL ?? DEFAULTS.LOG_LEVEL,
    MAX_BODY_BYTES: raw.MAX_BODY_BYTES ?? DEFAULTS.MAX_BODY_BYTES,
  };
}
