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
    `BlastX Esports API listening on 0.0.0.0:${port} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`,
  );

  // Eagerly verify DB connectivity so bad DATABASE_URL fails fast and loudly.
  await app.get(PrismaService).$connect();
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
