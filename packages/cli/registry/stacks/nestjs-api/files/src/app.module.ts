import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';
import { BadRequestError, issuesFrom } from './common/errors.js';
import { validateEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { NotesModule } from './notes/notes.module.js';

/**
 * The root module: settings, the global validation pipe and error filter, and
 * one import per feature module. Tests import it whole.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    HealthModule,
    NotesModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => new BadRequestError(issuesFrom(errors)),
      }),
    },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
