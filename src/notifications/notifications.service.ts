import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { RegistrationStatus } from '@prisma/client';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';

export interface SquadRegisteredPayload {
  captainUserId: string;
  captainName?: string;
  teamName: string;
  tournamentId: string;
  tournamentTitle: string;
  memberUserIds?: string[];
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
  groupName?: string;
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

export interface CommonNotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

function stringifyData(obj: Record<string, unknown> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private messaging: Messaging | null = null;
  private readonly CHANNEL_ID = 'blastix_high_importance_channel';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    let serviceAccountJson = '';

    // 1. Try Base64 variable first (Railway recommended)
    const b64 = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64')?.trim();
    if (b64) {
      try {
        serviceAccountJson = Buffer.from(b64, 'base64').toString('utf8');
      } catch (err) {
        this.logger.error(`Failed to decode FIREBASE_SERVICE_ACCOUNT_BASE64: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Fallback to raw JSON variable if Base64 was not provided
    if (!serviceAccountJson) {
      serviceAccountJson = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim() || '';
    }

    if (!serviceAccountJson) {
      this.logger.warn('Firebase Admin is not configured; push notifications are disabled');
      return;
    }

    try {
      let serviceAccount: {
        project_id: string;
        client_email: string;
        private_key: string;
      };

      try {
        serviceAccount = JSON.parse(serviceAccountJson);
      } catch {
        // Fix unescaped newlines/carriage returns in private_key (common in Railway/env vars)
        try {
          const sanitized = serviceAccountJson.replace(
            /"private_key"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/g,
            (_m, key) => {
              const escaped = key.replace(/\r/g, '').replace(/\n/g, '\\n');
              return `"private_key": "${escaped}"`;
            },
          );
          serviceAccount = JSON.parse(sanitized);
        } catch {
          const cleaned = serviceAccountJson.replace(/[\x00-\x1F]/g, (c) => {
            if (c === '\n') return '\\n';
            if (c === '\r') return '';
            if (c === '\t') return '\\t';
            return '';
          });
          serviceAccount = JSON.parse(cleaned);
        }
      }

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
      this.logger.log(`Firebase Admin initialized successfully for project ${serviceAccount.project_id}`);
    } catch (error) {
      this.logger.error(
        `Invalid Firebase service account credentials: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ==========================================================================
  // DEVICE TOKEN MANAGEMENT
  // ==========================================================================

  /**
   * Save or transfer a device FCM token to the current user.
   * If the token was previously tied to another user (shared phone/re-login), it gets reassigned.
   */
  async saveDeviceToken(
    userId: string,
    token: string,
    platform: 'android' | 'ios' = 'android',
  ): Promise<{ ok: boolean }> {
    // 1. Upsert into dedicated device_tokens table
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform,
      },
      update: {
        userId,
        platform,
        updatedAt: new Date(),
      },
    });

    // 2. Keep User.fcmToken in sync for backward compatibility
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fcmToken: token,
        fcmUpdatedAt: new Date(),
        deviceType: platform,
      },
    }).catch((err) => {
      this.logger.warn(`Could not sync User.fcmToken for ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    });

    return { ok: true };
  }

  /**
   * Delete device token on user logout.
   */
  async deleteDeviceToken(userId: string, token: string): Promise<{ ok: boolean }> {
    await this.prisma.deviceToken.deleteMany({
      where: { userId, token },
    });

    // Clear user table if it matches current active token
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });

    if (user?.fcmToken === token) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmToken: null, fcmUpdatedAt: null, deviceType: null },
      }).catch(() => undefined);
    }

    return { ok: true };
  }

  /**
   * Legacy method for backward compatibility with existing controller route.
   */
  async registerFcmToken(
    userId: string,
    fcmToken: string,
    deviceType?: 'android' | 'ios' | string,
  ): Promise<{ status: true; message: string }> {
    const platform = deviceType === 'ios' ? 'ios' : 'android';
    await this.saveDeviceToken(userId, fcmToken, platform);
    return { status: true, message: 'FCM Token updated successfully' };
  }

  // ==========================================================================
  // CORE SENDER FUNCTIONS
  // ==========================================================================

  /**
   * Send notification to a single user:
   * 1. Creates an in-app notification record in DB.
   * 2. Finds user's active device tokens.
   * 3. Sends FCM multicast with high priority and proper channelId.
   * 4. Automatically purges dead/unregistered tokens.
   * 5. Never throws to ensure business workflows never fail because of notifications.
   */
  async sendToUser(userId: string, payload: CommonNotificationPayload): Promise<void> {
    try {
      // 1. Insert in-app notification
      const record = await this.prisma.notification.create({
        data: {
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data ? (payload.data as any) : {},
          pushStatus: 'PENDING',
        },
      });

      if (!this.messaging) {
        await this.prisma.notification.update({
          where: { id: record.id },
          data: { pushStatus: 'NO_CONFIG' },
        });
        return;
      }

      // 2. Fetch device tokens
      const dbTokens = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true },
      });

      let tokens = dbTokens.map((t) => t.token);

      // Fallback: Check user table if device_tokens table has none yet
      if (tokens.length === 0) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { fcmToken: true },
        });
        if (user?.fcmToken) {
          tokens = [user.fcmToken];
        }
      }

      if (tokens.length === 0) {
        await this.prisma.notification.update({
          where: { id: record.id },
          data: { pushStatus: 'NO_TOKEN' },
        });
        return;
      }

      // 3. Send via FCM sendEachForMulticast
      const fcmMessage = {
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: stringifyData({
          type: payload.type,
          notificationId: record.id,
          ...payload.data,
        }),
        android: {
          priority: 'high' as const,
          notification: {
            channelId: this.CHANNEL_ID,
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const resp = await this.messaging.sendEachForMulticast(fcmMessage);

      // 4. Purge dead tokens
      const deadTokens: string[] = [];
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code;
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            deadTokens.push(tokens[idx]);
          } else {
            this.logger.error(`FCM error code [${code}]: ${r.error?.message}`);
          }
        }
      });

      if (deadTokens.length > 0) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: deadTokens } },
        });
        await this.prisma.user.updateMany({
          where: { fcmToken: { in: deadTokens } },
          data: { fcmToken: null, fcmUpdatedAt: null, deviceType: null },
        });
        this.logger.log(`Purged ${deadTokens.length} dead FCM tokens for user ${userId}`);
      }

      // 5. Update push status in DB
      const status =
        resp.failureCount === 0
          ? 'SENT'
          : resp.successCount > 0
            ? 'PARTIAL'
            : 'FAILED';

      await this.prisma.notification.update({
        where: { id: record.id },
        data: { pushStatus: status },
      });
    } catch (err) {
      this.logger.error(
        `Failed to deliver notification to user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Send notification to multiple users concurrently without failing the caller.
   */
  async sendToUsers(userIds: string[], payload: CommonNotificationPayload): Promise<void> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    await Promise.allSettled(uniqueIds.map((id) => this.sendToUser(id, payload)));
  }

  // ==========================================================================
  // IN-APP NOTIFICATIONS QUERY & UPDATE
  // ==========================================================================

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = Math.max(0, (page - 1) * limit);
    const take = Math.min(Math.max(1, limit), 100);

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      total,
      page,
      limit: take,
      unreadCount,
    };
  }

  async markAsRead(userId: string, notificationId: string): Promise<{ ok: boolean }> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
    return { ok: true };
  }

  async markAllAsRead(userId: string): Promise<{ ok: boolean }> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }

  // ==========================================================================
  // BROADCAST ADMIN FUNCTION
  // ==========================================================================

  async broadcast(input: BroadcastNotificationInput): Promise<NotificationSendResult> {
    if (!this.messaging) {
      throw new ServiceUnavailableException('Push notifications are not configured');
    }

    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    const userIds = users.map((u) => u.id);
    await this.sendToUsers(userIds, {
      type: 'announcement',
      title: input.title,
      body: input.body,
    });

    return { targeted: userIds.length, sent: userIds.length, failed: 0 };
  }

  // ==========================================================================
  // EVENT LISTENERS (Matrix from Section 8)
  // ==========================================================================

  // --- 1. Squad Registration & Invitations ---
  @OnEvent('squad.registered')
  async handleSquadRegistered(payload: SquadRegisteredPayload): Promise<void> {
    // 1. Notify Captain
    await this.sendToUser(payload.captainUserId, {
      type: 'registration_submitted',
      title: '🛡️ Squad Registration Complete!',
      body: `Booyah! Your squad "${payload.teamName}" is registered for ${payload.tournamentTitle}.`,
      data: {
        tournamentId: payload.tournamentId,
        action: 'squad_complete',
      },
    });

    // 2. Notify team members
    if (payload.memberUserIds && payload.memberUserIds.length > 0) {
      const otherMemberIds = payload.memberUserIds.filter((id) => id !== payload.captainUserId);
      if (otherMemberIds.length > 0) {
        const leaderName = payload.captainName || 'Your team captain';
        await this.sendToUsers(otherMemberIds, {
          type: 'registration_submitted',
          title: '🎮 Registered for Tournament!',
          body: `${leaderName} has registered your team "${payload.teamName}" for ${payload.tournamentTitle}.`,
          data: {
            tournamentId: payload.tournamentId,
            action: 'squad_registered_by_leader',
          },
        });
      }
    }
  }

  @OnEvent('squad.invitation.received')
  async handleSquadInvitationReceived(payload: SquadInvitationReceivedPayload): Promise<void> {
    await this.sendToUser(payload.userId, {
      type: 'squad_invite',
      title: `Tournament Invite from ${payload.leaderName}`,
      body: `You have been invited to join ${payload.tournamentTitle} with ${payload.squadName}.`,
      data: {
        tournamentId: payload.tournamentId,
        invitationId: payload.invitationId,
        action: 'tournament_invite',
      },
    });
  }

  @OnEvent('squad.invitation.responded')
  async handleSquadInvitationResponded(payload: SquadInvitationRespondedPayload): Promise<void> {
    const accepted = payload.action === 'ACCEPT';
    await this.sendToUser(payload.userId, {
      type: 'roster_approval_response',
      title: accepted ? 'Squad invite accepted' : 'Squad invite declined',
      body: `${payload.playerName} ${accepted ? 'accepted' : 'declined'} your invitation to ${payload.tournamentTitle}.`,
      data: {
        tournamentId: payload.tournamentId,
        squadId: payload.squadId,
        action: accepted ? 'invitation_accepted' : 'invitation_rejected',
      },
    });
  }

  // --- 2. Slot & Registration Status Events ---
  @OnEvent('tournament.slot_confirmed')
  async handleSlotConfirmed(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; slotNumber: number }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'slot_confirmed',
      title: '🎯 Slot Confirmed!',
      body: `Your slot (#${payload.slotNumber}) is confirmed for ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId, slotNumber: payload.slotNumber },
    });
  }

  @OnEvent('tournament.waitlisted')
  async handleWaitlisted(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'waitlisted',
      title: 'Added to Waitlist',
      body: `All slots are currently filled. Your team is on the waitlist for ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId },
    });
  }

  @OnEvent('tournament.waitlist_promoted')
  async handleWaitlistPromoted(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; slotNumber: number }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'waitlist_promoted',
      title: '🚀 Promoted to Main Roster!',
      body: `A slot opened up! You are now confirmed in Slot #${payload.slotNumber} for ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId, slotNumber: payload.slotNumber },
    });
  }

  // --- 3. Stage & Room Credentials Events ---
  @OnEvent('tournament.group_allocated')
  async handleGroupAllocated(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; groupName: string; stageNumber: number }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'group_allocated',
      title: `Stage ${payload.stageNumber}: Group Assigned!`,
      body: `Your team has been placed in ${payload.groupName} for ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId, stageNumber: payload.stageNumber, groupName: payload.groupName },
    });
  }

  @OnEvent('room.released')
  @OnEvent('tournament.room_published')
  async handleRoomReleased(payload: RoomReleasedPayload): Promise<void> {
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId: payload.tournamentId, status: RegistrationStatus.CONFIRMED },
      select: {
        userId: true,
        team: { select: { members: { select: { userId: true } } } },
      },
    });

    const userIds = registrations.flatMap((reg) => [
      reg.userId,
      ...(reg.team?.members.map((m) => m.userId) ?? []),
    ]);

    // SECURITY RULE: Never include Room ID or Room Password in notification body or payload!
    await this.sendToUsers(userIds, {
      type: 'room_published',
      title: '🔑 Room Credentials Published!',
      body: `Room details for ${payload.tournamentTitle} are ready. Open the app to view them securely.`,
      data: {
        tournamentId: payload.tournamentId,
        action: 'room_details',
      },
    });
  }

  // --- 4. Progression & Final Outcome Events (After Result Verification) ---
  @OnEvent('tournament.stage_qualified')
  async handleStageQualified(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; nextStageName: string }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'qualified',
      title: '🎉 BOOYAH! You Qualified!',
      body: `Awesome game! Your team has advanced to ${payload.nextStageName} in ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId },
    });
  }

  @OnEvent('tournament.stage_eliminated')
  async handleStageEliminated(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; stageName: string }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'eliminated',
      title: 'Tournament Run Ended',
      body: `GG! Your squad has been eliminated from ${payload.tournamentTitle} in ${payload.stageName}. Check final standings in app.`,
      data: { tournamentId: payload.tournamentId },
    });
  }

  @OnEvent('tournament.wildcard_selected')
  async handleWildCardSelected(payload: { userIds: string[]; tournamentTitle: string; tournamentId: string; stageName: string }): Promise<void> {
    await this.sendToUsers(payload.userIds, {
      type: 'wildcard_selected',
      title: '⭐ Wild Card Qualification!',
      body: `Congratulations! Your team was selected as a Wild Card for ${payload.stageName} in ${payload.tournamentTitle}.`,
      data: { tournamentId: payload.tournamentId },
    });
  }

  // --- 5. Tournament Publishing & Reminders ---
  @OnEvent('tournament.published')
  async handleTournamentPublished(payload: TournamentPublishedPayload): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    await this.sendToUsers(
      users.map((u) => u.id),
      {
        type: 'tournament_published',
        title: `🔥 New Tournament Open: ${payload.tournamentTitle}`,
        body: `Prize Pool: ₹${this.formatRupees(payload.prizePool)} | Entry: ₹${this.formatRupees(payload.entryFee)}. Register now!`,
        data: {
          tournamentId: payload.tournamentId,
          action: 'new_tournament',
        },
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

    await this.sendToUsers(userIds, {
      type: 'match_reminder',
      title: '⏰ Match Starting in 15 Minutes!',
      body: `Get ready! ${payload.tournamentTitle} begins soon. Be in the room on time.`,
      data: {
        tournamentId: payload.tournamentId,
        matchId: payload.matchId,
        action: 'match_reminder',
      },
    });
  }

  // --- 6. Wallet Events ---
  @OnEvent('wallet.credited')
  async handleWalletCredited(payload: WalletCreditedPayload): Promise<void> {
    await this.sendToUser(payload.userId, {
      type: 'payment_success',
      title: '💰 Wallet Credited - Prize Money',
      body: `Congratulations! ₹${this.formatRupees(payload.amount)} prize money credited to your wallet for ${payload.tournamentTitle}.`,
      data: {
        amount: this.formatRupees(payload.amount),
        action: 'wallet_credit',
        ...(payload.tournamentId ? { tournamentId: payload.tournamentId } : {}),
      },
    });
  }

  @OnEvent('wallet.withdrawal.updated')
  async handleWithdrawalUpdated(payload: WithdrawalUpdatedPayload): Promise<void> {
    await this.sendToUser(payload.userId, {
      type: 'withdrawal_update',
      title: '💳 Withdrawal Update',
      body: `Your withdrawal request for ₹${this.formatRupees(payload.amount)} is ${payload.status.toLowerCase()}.`,
      data: {
        amount: this.formatRupees(payload.amount),
        withdrawalId: payload.withdrawalId,
        status: payload.status,
        action: 'withdrawal_update',
      },
    });
  }

  private formatRupees(amountInPaise: number): string {
    return (amountInPaise / 100).toFixed(2);
  }
}
