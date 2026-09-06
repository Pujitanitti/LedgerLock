import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Every request gets a stable correlation ID before anything else runs,
  // so it's available in error responses, audit events, and logs.
  app.use(new RequestIdMiddleware().use);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Reject unknown fields and coerce types at the edge — malformed
  // authorization requests must never reach the decision engine.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Never let a raw stack trace, SQL error, or Redis error reach a client.
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('Ledger-Lock')
    .setDescription('Authorization-as-a-Service — API reference')
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'll_live_<publicId>_<secret>' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Ledger-Lock API listening on port ${port} (Swagger at /docs)`);
}

bootstrap();
