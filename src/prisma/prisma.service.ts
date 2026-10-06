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

      // Run DDL compatibility checks asynchronously in the background so API startup is not delayed
      void this.ensureSchemaCompatibility().catch((err) => {
        this.logger.warn(`Schema compatibility check warning: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (err) {
      this.connected = false;
      this.lastFailure = err instanceof Error ? err.message : String(err);
      healthStatus.db = false;
      healthStatus.dbError = this.lastFailure;
      this.logger.error(`Database connection failed: ${this.lastFailure}`);
    }
  }

  private async ensureSchemaCompatibility(): Promise<void> {
    await this.$executeRawUnsafe(
      'ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "accepting_substitutes" BOOLEAN NOT NULL DEFAULT true;',
    ).catch(() => {});
    await this.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "TournamentSection" AS ENUM ('FREEFIRE_LIVE', 'BLASTX');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `).catch(() => {});
    await this.$executeRawUnsafe(
      'ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "section" "TournamentSection" NOT NULL DEFAULT \'BLASTX\';',
    ).catch(() => {});
    await this.$executeRawUnsafe(`
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "stream_url" TEXT;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "viewers_count" INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "organizer_name" TEXT;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "organizer_verified" BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "accent_color_hex" TEXT;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "per_kill_reward" INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "booyah_bonus" INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "points_system" JSONB;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "schedule" JSONB;
      ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "announcements" JSONB;
      ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "stream_url" TEXT;
      ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "winner_team_name" TEXT;
      ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "top_killer_name" TEXT;
    `).catch(() => {});
    await this.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "PartnerInquiryStatus" AS ENUM ('NEW', 'IN_REVIEW', 'CONTACTED', 'CLOSED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `).catch(() => {});
    await this.$executeRawUnsafe(
      'ALTER TABLE "partner_inquiries" ADD COLUMN IF NOT EXISTS "status" "PartnerInquiryStatus" NOT NULL DEFAULT \'NEW\';',
    ).catch(() => {});
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
