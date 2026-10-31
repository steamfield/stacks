// The process entry: builds the app, applies configureApp and listens.
// ConfigModule validates the environment while the app is created.
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { createLogger } from './common/logging.js';
import { ConfigError, type Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
    // Reject instead of aborting the process, so a bad setting exits 2 below.
    abortOnError: false,
  });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = createLogger(config.get('LOG_LEVEL', { infer: true }));
  app.useLogger(logger);
  configureApp(app, {
    maxBodyBytes: config.get('MAX_BODY_BYTES', { infer: true }),
  });
  const port = config.get('PORT_API', { infer: true });
  await app.listen(port);
  logger.log('listening', { port });
}

try {
  await bootstrap();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
