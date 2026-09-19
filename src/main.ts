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

  console.log('[DIAG] bootstrap() entered');

  // Diagnostics: surface unhandled rejections instead of dying silently.
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[DIAG] unhandledRejection:', reason instanceof Error ? reason.stack : String(reason));
    logger.error(
      `Unhandled promise rejection: ${reason instanceof Error ? reason.stack : String(reason)}`,
    );
  });
  process.on('uncaughtException', (err: Error) => {
    console.error('[DIAG] uncaughtException:', err.stack ?? err.message);
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
    process.exit(1);
  });

  const build = getBuildInfo();
  console.log(`[DIAG] build info loaded: ${build.commit}`);
  logger.log(
    `Starting build ${build.commit}${build.branch ? ` (${build.branch})` : ''} built ${build.builtAt ?? 'n/a'} on ${process.version}`,
  );

  console.log('[DIAG] calling NestFactory.create(AppModule)...');
  const app = await NestFactory.create(AppModule);
  console.log('[DIAG] NestFactory.create() DONE');

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
  console.log(`[DIAG] calling app.listen(${port}, '0.0.0.0')...`);
  await app.listen(port, '0.0.0.0');
  console.log(`[DIAG] app.listen() DONE - server is up on port ${port}`);
  logger.log(
    `BlastX Esports API listening on 0.0.0.0:${port} (PORT env=${process.env.PORT ?? 'unset'}, NODE_ENV=${process.env.NODE_ENV ?? 'development'})`,
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
