import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { RegistrationStatus } from '@prisma/client';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';

export interface SquadRegisteredPayload {
  captainUserId: string;
  teamName: string;
  tournamentId: string;
  tournamentTitle: string;
}

export interface SquadInvitationReceivedPayload {
  invitationId: string;
  userId: string;
  leaderName: string;
  squadName: string;
  tournamentId: string;
  tournamentTitle: string;
}

export interface SquadInvitationRespondedPayload {
  userId: string;
  playerName: string;
  squadId: string;
  tournamentId: string;
  tournamentTitle: string;
  action: 'ACCEPT' | 'REJECT';
}

export interface RoomReleasedPayload {
  tournamentId: string;
  tournamentTitle: string;
}

export interface TournamentPublishedPayload {
  tournamentId: string;
  tournamentTitle: string;
  prizePool: number;
  entryFee: number;
}

export interface MatchStartingSoonPayload {
  matchId: string;
  tournamentId: string;
  tournamentTitle: string;
  startsAt: Date;
}

export interface WalletCreditedPayload {
  userId: string;
  amount: number;
  tournamentTitle: string;
  tournamentId?: string;
}

export interface WithdrawalUpdatedPayload {
  userId: string;
  amount: number;
  status: string;
  withdrawalId: string;
}

export interface BroadcastNotificationInput {
  title: string;
  body: string;
}

export interface NotificationSendResult {
  targeted: number;
  sent: number;
  failed: number;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private messaging: Messaging | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const serviceAccountJson = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim();
    if (!serviceAccountJson) {
      this.logger.warn('Firebase Admin is not configured; push notifications are disabled');
      return;
    }

    try {
      const serviceAccount = JSON.parse(serviceAccountJson) as {
        project_id: string;
        client_email: string;
        private_key: string;
      };
      if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
        throw new Error('service account JSON must include project_id, client_email, and private_key');
      }
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      const app =
        getApps()[0] ??
        initializeApp({
          credential: cert({
            projectId: serviceAccount.project_id,
            clientEmail: serviceAccount.client_email,
            privateKey: serviceAccount.private_key,
          }),
          projectId: serviceAccount.project_id,
        });
      this.messaging = getMessaging(app);
      this.logger.log(`Firebase Admin initialized for project ${serviceAccount.project_id}`);
    } catch (error) {
      throw new Error(
        `Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async registerFcmToken(
    userId: string,
    fcmToken: string,
    deviceType?: string,
  ): Promise<{ status: true; message: string }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fcmToken,
        fcmUpdatedAt: new Date(),
        deviceType: deviceType ?? null,
      },
    });
    return { status: true, message: 'FCM Token updated successfully' };
  }

  async broadcast(input: BroadcastNotificationInput): Promise<NotificationSendResult> {
    if (!this.messaging) {
      throw new ServiceUnavailableException('Push notifications are not configured');
    }
    const users = await this.prisma.user.findMany({
      where: { isActive: true, fcmToken: { not: null } },
      select: { id: true },
    });
    return this.sendToUserIds(
      users.map(({ id }) => id),
      { title: input.title, body: input.body },
      { type: 'system', action: 'announcement' },
    );
  }

  @OnEvent('squad.registered')
  async handleSquadRegistered(payload: SquadRegisteredPayload): Promise<void> {
    await this.sendEventToUsers(
      [payload.captainUserId],
      {
        title: '🛡️ Squad Registration Complete!',
        body: `Booyah! Your squad "${payload.teamName}" is 4/4 complete and registered for ${payload.tournamentTitle}.`,
      },
      {
        type: 'tournament',
        tournamentId: payload.tournamentId,
        action: 'squad_complete',
      },
    );
  }

  @OnEvent('squad.invitation.received')
  async handleSquadInvitationReceived(payload: SquadInvitationReceivedPayload): Promise<void> {
    await this.sendEventToUsers(
      [payload.userId],
      {
        title: `Tournament Invite from ${payload.leaderName}`,
        body: `You have been invited to join ${payload.tournamentTitle} with ${payload.squadName}.`,
      },
      {
        type: 'tournament',
        tournamentId: payload.tournamentId,
        invitationId: payload.invitationId,
        action: 'tournament_invite',
      },
    );
  }

  @OnEvent('squad.invitation.responded')
  async handleSquadInvitationResponded(payload: SquadInvitationRespondedPayload): Promise<void> {
    const accepted = payload.action === 'ACCEPT';
    await this.sendEventToUsers(
      [payload.userId],
      {
        title: accepted ? 'Squad invite accepted' : 'Squad invite declined',
        body: `${payload.playerName} ${accepted ? 'accepted' : 'declined'} your invitation to ${payload.tournamentTitle}.`,
      },
      {
        type: 'tournament',
        tournamentId: payload.tournamentId,
        squadId: payload.squadId,
        action: accepted ? 'invitation_accepted' : 'invitation_rejected',
      },
    );
  }

  @OnEvent('room.released')
  async handleRoomReleased(payload: RoomReleasedPayload): Promise<void> {
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId: payload.tournamentId, status: RegistrationStatus.CONFIRMED },
      select: {
        userId: true,
        team: { select: { members: { select: { userId: true } } } },
      },
    });
    const userIds = registrations.flatMap((registration) => [
      registration.userId,
      ...(registration.team?.members.map((member) => member.userId) ?? []),
    ]);

    await this.sendEventToUsers(
      userIds,
      {
        title: '🔑 Room ID & Password Released!',
        body: `Room details for ${payload.tournamentTitle} are ready. Open the app to view them securely.`,
      },
      {
        type: 'tournament',
        tournamentId: payload.tournamentId,
        action: 'room_details',
      },
    );
  }

  @OnEvent('tournament.published')
  async handleTournamentPublished(payload: TournamentPublishedPayload): Promise<void> {
    await this.sendEventBroadcast(
      {
        title: `🔥 New Tournament Open: ${payload.tournamentTitle}`,
        body: `Prize Pool: ₹${this.formatRupees(payload.prizePool)} | Entry: ₹${this.formatRupees(payload.entryFee)}. Limited slots available, register now!`,
      },
      {
        type: 'tournament',
        tournamentId: payload.tournamentId,
        action: 'new_tournament',
      },
    );
  }

  @OnEvent('match.starting_soon')
  async handleMatchStartingSoon(payload: MatchStartingSoonPayload): Promise<void> {
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId: payload.tournamentId, status: RegistrationStatus.CONFIRMED },
      select: {
        userId: true,
        team: { select: { members: { select: { userId: true } } } },
      },
    });
    const userIds = registrations.flatMap((registration) => [
      registration.userId,
      ...(registration.team?.members.map((member) => member.userId) ?? []),
    ]);

    await this.sendEventToUsers(
      userIds,
      {
        title: '⏰ Match Starting in 15 Minutes!',
        body: `Get ready! ${payload.tournamentTitle} begins at ${payload.startsAt.toISOString()}. Be in the room on time.`,
      },
      {
        type: 'match',
        tournamentId: payload.tournamentId,
        matchId: payload.matchId,
        action: 'match_reminder',
      },
    );
  }

  @OnEvent('wallet.credited')
  async handleWalletCredited(payload: WalletCreditedPayload): Promise<void> {
    await this.sendEventToUsers(
      [payload.userId],
      {
        title: '💰 Wallet Credited - Prize Money',
        body: `Congratulations! ₹${this.formatRupees(payload.amount)} prize money credited to your wallet for ${payload.tournamentTitle}.`,
      },
      {
        type: 'wallet',
        amount: this.formatRupees(payload.amount),
        action: 'wallet_credit',
        ...(payload.tournamentId ? { tournamentId: payload.tournamentId } : {}),
      },
    );
  }

  @OnEvent('wallet.withdrawal.updated')
  async handleWithdrawalUpdated(payload: WithdrawalUpdatedPayload): Promise<void> {
    await this.sendEventToUsers(
      [payload.userId],
      {
        title: '💳 Withdrawal Update',
        body: `Your withdrawal request for ₹${this.formatRupees(payload.amount)} is ${payload.status.toLowerCase()}.`,
      },
      {
        type: 'wallet',
        amount: this.formatRupees(payload.amount),
        withdrawalId: payload.withdrawalId,
        status: payload.status,
        action: 'withdrawal_update',
      },
    );
  }

  private formatRupees(amountInPaise: number): string {
    return (amountInPaise / 100).toFixed(2);
  }

  private async sendEventBroadcast(
    notification: { title: string; body: string },
    data: Record<string, string>,
  ): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, fcmToken: { not: null } },
      select: { id: true },
    });
    await this.sendEventToUsers(users.map(({ id }) => id), notification, data);
  }

  private async sendEventToUsers(
    userIds: string[],
    notification: { title: string; body: string },
    data: Record<string, string>,
  ): Promise<void> {
    try {
      await this.sendToUserIds(userIds, notification, data);
    } catch (error) {
      this.logger.error(
        `Push event delivery failed (${data.action}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async sendToUserIds(
    userIds: string[],
    notification: { title: string; body: string },
    data: Record<string, string>,
  ): Promise<NotificationSendResult> {
    if (!this.messaging) {
      throw new ServiceUnavailableException('Push notifications are not configured');
    }
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) {
      return { targeted: 0, sent: 0, failed: 0 };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueUserIds }, isActive: true, fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = [...new Set(users.flatMap((user) => (user.fcmToken ? [user.fcmToken] : [])))];
    let sent = 0;
    let failed = 0;

    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      try {
        const result = await this.messaging.sendEachForMulticast({
          tokens: batch,
          notification,
          data,
          android: {
            priority: 'high',
            notification: {
              channelId: 'blastix_high_importance_channel',
              sound: 'default',
            },
          },
        });
        sent += result.successCount;
        failed += result.failureCount;

        const invalidTokens = result.responses.flatMap((response, index) => {
          const code = response.error?.code;
          return code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
            ? [batch[index]]
            : [];
        });
        if (invalidTokens.length > 0) {
          await this.prisma.user.updateMany({
            where: { fcmToken: { in: invalidTokens } },
            data: { fcmToken: null, fcmUpdatedAt: null, deviceType: null },
          });
        }
      } catch (error) {
        failed += batch.length;
        this.logger.error(
          `FCM multicast failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failed > 0) {
      this.logger.warn(`Push delivery result: ${sent} sent, ${failed} failed`);
    }
    return { targeted: tokens.length, sent, failed };
  }
}
