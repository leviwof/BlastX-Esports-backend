import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { TournamentStatus } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import * as net from 'net';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private tournamentQueue?: Queue;
  private tournamentWorker?: Worker;
  private intervalId?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    const redisAvailable = await this.checkRedisConnection(redisUrl);

    if (redisAvailable) {
      try {
        const url = new URL(redisUrl);
        const connection = {
          host: url.hostname || 'localhost',
          port: Number(url.port) || 6379,
          password: url.password || undefined,
          maxRetriesPerRequest: null,
        };

        this.tournamentQueue = new Queue('tournament-lifecycle', { connection });
        this.tournamentWorker = new Worker(
          'tournament-lifecycle',
          async () => {
            await this.checkAndRunLifecycle();
          },
          { connection },
        );

        this.tournamentWorker.on('error', () => {
          // Suppress noise when connection drops
        });

        // Idempotent job scheduler: a fixed ID is upserted (never duplicated), so
        // redeploys cannot accumulate repeatable jobs. Handles Redis offline at boot.
        await this.tournamentQueue.upsertJobScheduler('lifecycle-every-minute', {
          every: 60_000,
        });
        this.logger.log('BullMQ tournament lifecycle scheduler initialized with Redis');
      } catch (err: any) {
        this.logger.warn(`BullMQ initialization skipped: ${err.message}`);
      }
    } else {
      this.logger.log('Redis is offline. Using local timer fallback for tournament lifecycle scheduler.');
      this.intervalId = setInterval(() => {
        void this.checkAndRunLifecycle();
      }, 60000);
    }

    // Initial lifecycle check
    void this.checkAndRunLifecycle();
  }

  onModuleDestroy(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    return (async () => {
      if (this.tournamentWorker) {
        await this.tournamentWorker.close();
        this.tournamentWorker = undefined;
      }
      if (this.tournamentQueue) {
        await this.tournamentQueue.close();
        this.tournamentQueue = undefined;
      }
    })();
  }

  private checkRedisConnection(redisUrl: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const url = new URL(redisUrl);
        const port = Number(url.port) || 6379;
        const host = url.hostname || '127.0.0.1';

        const socket = new net.Socket();
        socket.setTimeout(1500);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, host);
      } catch {
        resolve(false);
      }
    });
  }

  async checkAndRunLifecycle(): Promise<void> {
    if (!this.prisma.isConnected) {
      return;
    }

    try {
      const now = new Date();
      const roomReleaseMinutes = Number(this.config.get<number>('ROOM_RELEASE_MINUTES') || 15);

      // 1. Auto Open Registration: UPCOMING or DRAFT where registrationOpensAt <= now
      const toOpen = await this.prisma.tournament.findMany({
        where: {
          status: { in: [TournamentStatus.UPCOMING, TournamentStatus.DRAFT] },
          registrationOpensAt: { lte: now },
          registrationClosesAt: { gt: now },
        },
      });

    for (const t of toOpen) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.REGISTRATION_OPEN },
      });
      this.logger.log(`[SCHEDULER] Updated tournament "${t.title}" status to REGISTRATION_OPEN`);
      this.eventEmitter.emit('status.changed', {
        tournamentId: t.id,
        oldStatus: t.status,
        newStatus: TournamentStatus.REGISTRATION_OPEN,
      });
    }

    // 2. Auto Close Registration: REGISTRATION_OPEN where registrationClosesAt <= now
    const toClose = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.REGISTRATION_OPEN,
        registrationClosesAt: { lte: now },
      },
    });

    for (const t of toClose) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { status: TournamentStatus.REGISTRATION_CLOSED },
      });
      this.logger.log(`[SCHEDULER] Updated tournament "${t.title}" status to REGISTRATION_CLOSED`);
      this.eventEmitter.emit('status.changed', {
        tournamentId: t.id,
        oldStatus: t.status,
        newStatus: TournamentStatus.REGISTRATION_CLOSED,
      });
    }

    // 3. Auto Release Room Credentials: startsAt - ROOM_RELEASE_MINUTES <= now
    const releaseTimeWindow = new Date(now.getTime() + roomReleaseMinutes * 60 * 1000);
    const toReleaseRoom = await this.prisma.tournament.findMany({
      where: {
        status: { in: [TournamentStatus.REGISTRATION_CLOSED, TournamentStatus.LIVE] },
        roomId: { not: null },
        roomReleasedAt: null,
        startsAt: { lte: releaseTimeWindow },
      },
    });

    for (const t of toReleaseRoom) {
      await this.prisma.tournament.update({
        where: { id: t.id },
        data: { roomReleasedAt: now },
      });
      this.logger.log(`[SCHEDULER] Auto-released room credentials for tournament "${t.title}"`);
      this.eventEmitter.emit('room.released', {
        tournamentId: t.id,
        tournamentTitle: t.title,
        roomId: t.roomId,
        roomPassword: t.roomPassword,
      });
    }
  } catch (err: any) {
    this.logger.error(`[SCHEDULER] Lifecycle check error: ${err.message}`, err.stack);
  }
}
}
