import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { getBuildInfo } from './common/build-info';
import { healthStatus } from './common/health-status';
import { PrismaService } from './prisma/prisma.service';

export interface HealthResponse {
  healthy: boolean;
  uptime: number;
  commit: string;
  db: boolean;
  redis: boolean;
}

/** Healthchecks must answer fast even when a dependency is hanging. */
async function withTimeout(promise: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  // Railway probes this path directly (no global prefix).
  //
  // `healthy` only means "this process is up and serving" — that is what keeps the
  // deployment routable instead of the platform answering every request with 502.
  // A broken dependency therefore shows up in the `db`/`redis` fields (and in the
  // logs) rather than as an invisible crash loop.
  @Get('health')
  async health(): Promise<HealthResponse> {
    return {
      healthy: true,
      uptime: process.uptime(),
      commit: getBuildInfo().commit,
      db: await withTimeout(this.prisma.ping(), 3000),
      redis: healthStatus.redis,
    };
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
