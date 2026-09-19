import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { healthStatus } from '../common/health-status';

/**
 * Singleton PrismaClient provider.
 *
 * Connection failures are deliberately NON-FATAL. When this threw during module
 * init, Nest bootstrap aborted, the process exited and Railway had no instance to
 * route to — every request then failed with an opaque 502 ("Application failed to
 * respond") and the real error was buried in a crash loop. Instead the API stays
 * up, logs loudly, retries quietly in the background and reports the truth through
 * /health (`db: false`).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private retryTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastFailure: string | null = null;

  async onModuleInit(): Promise<void> {
    await this.tryConnect();
    if (!this.connected) this.scheduleRetry();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get connectionError(): string | null {
    return this.lastFailure;
  }

  private async tryConnect(): Promise<void> {
    try {
      await this.$connect();
      if (!this.connected) this.logger.log('Database connection established');
      this.connected = true;
      this.lastFailure = null;
      healthStatus.db = true;
      healthStatus.dbError = null;
    } catch (err) {
      this.connected = false;
      this.lastFailure = err instanceof Error ? err.message : String(err);
      healthStatus.db = false;
      healthStatus.dbError = this.lastFailure;
      this.logger.error(`Database connection failed: ${this.lastFailure}`);
    }
  }

  /** Keep retrying until the database answers, then stop the timer. */
  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.tryConnect().then(() => {
        if (this.connected && this.retryTimer) {
          clearInterval(this.retryTimer);
          this.retryTimer = null;
        }
      });
    }, 10_000);
    this.retryTimer.unref?.();
  }

  /** Never-throwing liveness probe used by GET /health. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      if (!this.connected) this.logger.log('Database connection restored');
      this.connected = true;
      this.lastFailure = null;
      healthStatus.db = true;
      healthStatus.dbError = null;
      return true;
    } catch (err) {
      this.connected = false;
      this.lastFailure = err instanceof Error ? err.message : String(err);
      healthStatus.db = false;
      healthStatus.dbError = this.lastFailure;
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.retryTimer) clearInterval(this.retryTimer);
    await this.$disconnect();
  }
}
