import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TournamentAuditLog } from '@prisma/client';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    params: {
      tournamentId: string;
      action: string;
      actorUserId: string;
      details: Record<string, any>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<TournamentAuditLog> {
    const sanitizedDetails = { ...params.details };

    // Redact secrets strictly: room passwords, session URLs, tokens
    delete sanitizedDetails.roomPassword;
    delete sanitizedDetails.room_password;
    delete sanitizedDetails.sessionUrl;
    delete sanitizedDetails.session_url;
    delete sanitizedDetails.uploadUrl;
    delete sanitizedDetails.upload_url;
    delete sanitizedDetails.password;
    delete sanitizedDetails.token;

    const db = tx ?? this.prisma;
    return db.tournamentAuditLog.create({
      data: {
        tournamentId: params.tournamentId,
        action: params.action,
        adminUserId: params.actorUserId,
        details: sanitizedDetails,
      },
    });
  }
}
