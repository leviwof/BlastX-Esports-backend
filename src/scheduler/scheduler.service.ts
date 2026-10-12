import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { MatchStatus, RegistrationSubmissionKind, RegistrationSubmissionStatus, TournamentInvitationStatus, TournamentStatus, WaitlistEntryStatus } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import * as net from 'net';
import { RecordingsService } from '../recordings/recordings.service';

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
    private readonly recordingsService?: RecordingsService,
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

      const expiredInvitations = await this.prisma.tournamentInvitation.updateMany({
        where: {
          status: TournamentInvitationStatus.PENDING,
          tournament: {
            is: {
              status: { not: TournamentStatus.LIVE },
            },
          },
        },
        data: { status: TournamentInvitationStatus.EXPIRED },
      });
      if (expiredInvitations.count > 0) {
        this.logger.log(`[SCHEDULER] Expired ${expiredInvitations.count} closed tournament invitations`);
      }

    // Legacy registrations are closed on their configured deadline. New
    // tournaments stay UPCOMING until startsAt and accept registrations only
    // after transitioning to LIVE.
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

    // Auto Release Room Credentials: startsAt - ROOM_RELEASE_MINUTES <= now
    const releaseTimeWindow = new Date(now.getTime() + roomReleaseMinutes * 60 * 1000);
    const toReleaseRoom = await this.prisma.tournament.findMany({
      where: {
        status: {
          in: [
            TournamentStatus.UPCOMING,
            TournamentStatus.REGISTRATION_OPEN,
            TournamentStatus.REGISTRATION_CLOSED,
            TournamentStatus.LIVE,
          ],
        },
        roomId: { not: null },
        roomReleasedAt: null,
        startsAt: { lte: releaseTimeWindow },
      },
    });

    for (const t of toReleaseRoom) {
      const claimed = await this.prisma.tournament.updateMany({
        where: { id: t.id, roomReleasedAt: null },
        data: { roomReleasedAt: now },
      });
      if (claimed.count === 0) continue;
      this.logger.log(`[SCHEDULER] Auto-released room credentials for tournament "${t.title}"`);
      await this.prisma.tournamentAuditLog.create({
        data: {
          tournamentId: t.id,
          action: 'ROOM_CREDENTIALS_AUTO_RELEASED',
          details: {
            roomId: t.roomId,
            autoReleasedAt: now.toISOString(),
          },
          adminUserId: 'scheduler',
        },
      });
      this.eventEmitter.emit('room.released', {
        tournamentId: t.id,
        tournamentTitle: t.title,
      });
    }

    // Auto Release Match Room Credentials
    const toReleaseMatchRooms = await this.prisma.match.findMany({
      where: {
        status: { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] },
        roomId: { not: null },
        roomReleasedAt: null,
        scheduledAt: { lte: releaseTimeWindow },
      },
      include: { tournament: { select: { id: true, title: true } } },
    });

    for (const m of toReleaseMatchRooms) {
      const claimed = await this.prisma.match.updateMany({
        where: { id: m.id, roomReleasedAt: null },
        data: { roomReleasedAt: now },
      });
      if (claimed.count === 0) continue;
      this.logger.log(`[SCHEDULER] Auto-released room credentials for match #${m.matchNumber}`);
      await this.prisma.tournamentAuditLog.create({
        data: {
          tournamentId: m.tournamentId,
          action: 'ROOM_CREDENTIALS_AUTO_RELEASED',
          details: {
            matchId: m.id,
            matchKey: `m_${m.id}`,
            roomId: m.roomId,
            autoReleasedAt: now.toISOString(),
          },
          adminUserId: 'scheduler',
        },
      });
      this.eventEmitter.emit('room.released', {
        tournamentId: m.tournamentId,
        tournamentTitle: m.tournament.title,
        matchId: m.id,
        matchKey: `m_${m.id}`,
      });
    }

    const reminderWindowStart = new Date(now.getTime() + 14 * 60 * 1000);
    const reminderWindowEnd = new Date(now.getTime() + 15 * 60 * 1000);
    const upcomingMatches = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.SCHEDULED,
        reminderSentAt: null,
        scheduledAt: { gt: reminderWindowStart, lte: reminderWindowEnd },
      },
      include: { tournament: { select: { id: true, title: true } } },
    });

    for (const match of upcomingMatches) {
      const claimed = await this.prisma.match.updateMany({
        where: {
          id: match.id,
          status: MatchStatus.SCHEDULED,
          reminderSentAt: null,
        },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      this.eventEmitter.emit('match.starting_soon', {
        matchId: match.id,
        matchKey: `m_${match.id}`,
        tournamentId: match.tournament.id,
        tournamentTitle: match.tournament.title,
        startsAt: match.scheduledAt,
      });
    }

    // A tournament becomes live at its scheduled start. It is completed
    // only once it has matches and every match has been completed.
    const toGoLive = await this.prisma.tournament.findMany({
      where: {
        status: { in: [TournamentStatus.UPCOMING, TournamentStatus.REGISTRATION_OPEN, TournamentStatus.REGISTRATION_CLOSED] },
        startsAt: { lte: now },
      },
    });
    for (const t of toGoLive) {
      await this.prisma.tournament.update({ where: { id: t.id }, data: { status: TournamentStatus.LIVE } });
      this.eventEmitter.emit('status.changed', { tournamentId: t.id, oldStatus: t.status, newStatus: TournamentStatus.LIVE });
    }

    const completed = await this.prisma.tournament.findMany({
      where: { status: TournamentStatus.LIVE, matches: { some: {}, every: { status: MatchStatus.COMPLETED } } },
    });
    for (const t of completed) {
      await this.prisma.tournament.update({ where: { id: t.id }, data: { status: TournamentStatus.COMPLETED } });
      this.eventEmitter.emit('status.changed', { tournamentId: t.id, oldStatus: t.status, newStatus: TournamentStatus.COMPLETED });
    }

    // Expire ACTIVE ROSTER_CHANGE submissions when the lock time is reached
    const activeRosterChanges = await this.prisma.registrationSubmission.findMany({
      where: {
        status: RegistrationSubmissionStatus.ACTIVE,
        kind: RegistrationSubmissionKind.ROSTER_CHANGE,
      },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            rosterLockAt: true,
            matches: {
              take: 1,
              orderBy: { scheduledAt: 'asc' },
              select: { scheduledAt: true, status: true },
            },
          },
        },
        team: {
          select: { id: true, name: true, captainId: true },
        },
      },
    });

    for (const sub of activeRosterChanges) {
      let lockTime = sub.tournament.rosterLockAt;
      if (!lockTime && sub.tournament.matches?.[0]?.scheduledAt) {
        lockTime = sub.tournament.matches[0].scheduledAt;
      }
      const hasCompetitionStarted = sub.tournament.matches?.some(
        (m) => m.status === MatchStatus.LIVE || m.status === MatchStatus.COMPLETED,
      );
      const isLocked = (lockTime && now >= lockTime) || hasCompetitionStarted;
      if (isLocked) {
        await this.prisma.registrationSubmission.update({
          where: { id: sub.id },
          data: { status: RegistrationSubmissionStatus.EXPIRED },
        });

        await this.prisma.tournamentAuditLog.create({
          data: {
            tournamentId: sub.tournament.id,
            action: 'ROSTER_CHANGE_EXPIRED',
            details: {
              submissionId: sub.id,
              teamId: sub.team.id,
              reason: 'Lock time reached',
            },
            adminUserId: 'SYSTEM',
          },
        });

        this.eventEmitter.emit('team.roster_change_expired', {
          ownerUserId: sub.ownerUserId || sub.team.captainId,
          tournamentId: sub.tournament.id,
          tournamentTitle: sub.tournament.title,
          teamId: sub.team.id,
          teamName: sub.team.name,
          submissionId: sub.id,
        });
      }
    }

    // Safety net: check for LIVE tournaments that have WAITING entries and free slots
    const liveWithWaitlist = await this.prisma.tournament.findMany({
      where: {
        status: TournamentStatus.LIVE,
        waitlistEntries: { some: { status: WaitlistEntryStatus.WAITING } },
      },
      select: { id: true, maxSlots: true, registeredCount: true },
    });
    for (const t of liveWithWaitlist) {
      if (t.registeredCount < t.maxSlots) {
        this.eventEmitter.emit('tournament.slot_freed', { tournamentId: t.id });
      }
    }

    // Task 4: Clean up expired match recordings for completed tournaments
    if (this.recordingsService) {
      await this.recordingsService.cleanExpiredRecordings();
    }
  } catch (err: any) {
    this.logger.error(`[SCHEDULER] Lifecycle check error: ${err.message}`, err.stack);
  }
}
}
