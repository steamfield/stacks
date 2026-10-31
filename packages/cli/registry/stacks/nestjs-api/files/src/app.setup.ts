import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { requestContext } from './common/request-context.js';

export type SetupOptions = {
  /** Requests with a larger JSON body get the 413 envelope. */
  maxBodyBytes: number;
};

/**
 * Everything that must be set on the application rather than in a module.
 * src/main.ts and tests/helpers/app.ts both call it, so tests serve exactly
 * what production serves. The app must be created with `bodyParser: false`.
 */
export function configureApp(app: NestExpressApplication, { maxBodyBytes }: SetupOptions): void {
  // First, so body parser failures and unknown routes carry a request id too.
  app.use(requestContext);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: maxBodyBytes });
  app.enableVersioning({ type: VersioningType.URI });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('API').setVersion('1').build(),
  );
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'openapi.json',
  });
}
