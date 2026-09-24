import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { getBuildInfo } from './common/build-info';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Diagnostics: surface unhandled rejections instead of dying silently.
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      `Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`,
    );
  });
  process.on('uncaughtException', (err: Error) => {
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
    process.exit(1);
  });

  const build = getBuildInfo();
  logger.log(
    `Starting build ${build.commit}${build.branch ? ` (${build.branch})` : ''} built ${build.builtAt ?? 'n/a'} on ${process.version}`,
  );

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('v1', { exclude: ['health'] }); // /health stays unprefixed for Railway healthchecks
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // Railway (and most PaaS) inject PORT; it is NOT prefixed with the global prefix.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(
    `BlastiX Esports API listening on 0.0.0.0:${port} (PORT env=${process.env.PORT ?? 'unset'}, NODE_ENV=${process.env.NODE_ENV ?? 'development'})`,
  );

  // Connectivity is reported, never fatal: an unreachable database must not stop the
  // process, otherwise Railway has no instance to route to and answers every request
  // with an opaque 502 instead of telling us what broke.
  const prisma = app.get(PrismaService);
  if (prisma.isConnected) {
    logger.log('Database connection verified at startup');
  } else {
    logger.warn(
      `Database is NOT reachable (${prisma.connectionError ?? 'unknown error'}) - ` +
        'retrying in the background; /health reports "db": false',
    );
  }
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
