import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IssueReportStatus, SupportTicketStatus } from '@prisma/client';
import { CreateIssueReportDto } from './dto/create-issue-report.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { UpdateIssueReportDto } from './dto/update-issue-report.dto';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto';
import { QuerySupportContactsDto, QuerySupportIssuesDto } from './dto/query-support.dto';
import { createPaginatedResponse } from '../common/pagination.dto';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async reportIssue(
    dto: CreateIssueReportDto,
    headers: Record<string, string | string[] | undefined>,
    jwtUserId?: string,
  ) {
    const userId = dto.user_id || jwtUserId;
    let userDetails: {
      name?: string;
      email?: string;
      phone?: string;
      freeFireUid?: string;
      inGameName?: string;
    } = {};

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { gameProfiles: true },
      });
      if (user) {
        const profile = user.gameProfiles[0];
        userDetails = {
          name: user.name,
          email: user.email,
          phone: user.phone ?? undefined,
          freeFireUid: profile?.inGameUid ?? undefined,
          inGameName: profile?.inGameName ?? undefined,
        };
      }
    }

    const deviceType =
      dto.device_type || this.getHeaderValue(headers, 'x-device-type') || undefined;
    const deviceModel =
      dto.device_model || this.getHeaderValue(headers, 'x-device-model') || undefined;
    const osVersion =
      dto.os_version || this.getHeaderValue(headers, 'x-os-version') || undefined;
    const appVersion =
      dto.app_version || this.getHeaderValue(headers, 'x-app-version') || undefined;

    const issueId = await this.generateCustomId('ISS');

    const issue = await this.prisma.issueReport.create({
      data: {
        id: issueId,
        issueType: dto.issue_type.trim(),
        description: dto.description.trim(),
        tournamentName: dto.tournament_name?.trim() || null,
        deviceModel: deviceModel || null,
        appVersion: appVersion || null,
        osVersion: osVersion || null,
        deviceType: deviceType || null,
        userId: userId || null,
        userName: dto.user_name?.trim() || userDetails.name || null,
        userEmail: dto.user_email?.trim() || userDetails.email || null,
        userPhone: dto.user_phone?.trim() || userDetails.phone || null,
        freeFireUid: dto.free_fire_uid?.trim() || userDetails.freeFireUid || null,
        inGameName: dto.in_game_name?.trim() || userDetails.inGameName || null,
        status: IssueReportStatus.PENDING,
        submittedAt: dto.submitted_at ? new Date(dto.submitted_at) : new Date(),
      },
    });

    return {
      status: 'success',
      message: 'Issue report submitted successfully',
      data: {
        issue_id: issue.id,
        status: issue.status,
      },
    };
  }

  async contactSupport(
    dto: CreateSupportTicketDto,
    headers: Record<string, string | string[] | undefined>,
    jwtUserId?: string,
  ) {
    const userId = dto.user_id || jwtUserId;
    let userDetails: {
      name?: string;
      email?: string;
      phone?: string;
      freeFireUid?: string;
      inGameName?: string;
    } = {};

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { gameProfiles: true },
      });
      if (user) {
        const profile = user.gameProfiles[0];
        userDetails = {
          name: user.name,
          email: user.email,
          phone: user.phone ?? undefined,
          freeFireUid: profile?.inGameUid ?? undefined,
          inGameName: profile?.inGameName ?? undefined,
        };
      }
    }

    const deviceType =
      dto.device_type || this.getHeaderValue(headers, 'x-device-type') || undefined;
    const deviceModel =
      dto.device_model || this.getHeaderValue(headers, 'x-device-model') || undefined;
    const osVersion =
      dto.os_version || this.getHeaderValue(headers, 'x-os-version') || undefined;
    const appVersion =
      dto.app_version || this.getHeaderValue(headers, 'x-app-version') || undefined;

    const ticketId = await this.generateCustomId('TKT');

    const ticket = await this.prisma.supportTicket.create({
      data: {
        id: ticketId,
        subject: dto.subject.trim(),
        category: dto.category.trim(),
        message: dto.message.trim(),
        userId: userId || null,
        userName: dto.user_name?.trim() || userDetails.name || null,
        userEmail: dto.user_email?.trim() || userDetails.email || null,
        userPhone: dto.user_phone?.trim() || userDetails.phone || null,
        freeFireUid: dto.free_fire_uid?.trim() || userDetails.freeFireUid || null,
        inGameName: dto.in_game_name?.trim() || userDetails.inGameName || null,
        deviceModel: deviceModel || null,
        appVersion: appVersion || null,
        osVersion: osVersion || null,
        deviceType: deviceType || null,
        status: SupportTicketStatus.OPEN,
        submittedAt: dto.submitted_at ? new Date(dto.submitted_at) : new Date(),
      },
    });

    return {
      status: 'success',
      message: 'Support message sent successfully',
      data: {
        ticket_id: ticket.id,
        status: ticket.status,
      },
    };
  }

  async listAdminIssues(query: QuerySupportIssuesDto) {
    const where: any = {};
    if (query.status) {
      where.status = query.status.toUpperCase();
    }
    if (query.issue_type) {
      where.issueType = { contains: query.issue_type, mode: 'insensitive' };
    }
    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { userName: { contains: q, mode: 'insensitive' } },
        { userEmail: { contains: q, mode: 'insensitive' } },
        { userPhone: { contains: q, mode: 'insensitive' } },
        { freeFireUid: { contains: q, mode: 'insensitive' } },
        { inGameName: { contains: q, mode: 'insensitive' } },
        { tournamentName: { contains: q, mode: 'insensitive' } },
        { id: { contains: q, mode: 'insensitive' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, issues] = await Promise.all([
      this.prisma.issueReport.count({ where }),
      this.prisma.issueReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    const mapped = issues.map((issue) => ({
      issue_id: issue.id,
      id: issue.id,
      issue_type: issue.issueType,
      description: issue.description,
      tournament_name: issue.tournamentName,
      device_model: issue.deviceModel,
      app_version: issue.appVersion,
      os_version: issue.osVersion,
      device_type: issue.deviceType,
      user_id: issue.userId,
      user_name: issue.userName,
      user_email: issue.userEmail,
      user_phone: issue.userPhone,
      free_fire_uid: issue.freeFireUid,
      in_game_name: issue.inGameName,
      status: issue.status,
      admin_notes: issue.adminNotes,
      submitted_at: issue.submittedAt,
      created_at: issue.createdAt,
      updated_at: issue.updatedAt,
    }));

    return createPaginatedResponse(mapped, page, limit, total);
  }

  async listAdminContacts(query: QuerySupportContactsDto) {
    const where: any = {};
    if (query.status) {
      where.status = query.status.toUpperCase();
    }
    if (query.category) {
      where.category = { contains: query.category, mode: 'insensitive' };
    }
    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
        { userName: { contains: q, mode: 'insensitive' } },
        { userEmail: { contains: q, mode: 'insensitive' } },
        { userPhone: { contains: q, mode: 'insensitive' } },
        { freeFireUid: { contains: q, mode: 'insensitive' } },
        { inGameName: { contains: q, mode: 'insensitive' } },
        { id: { contains: q, mode: 'insensitive' } },
      ];
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { submittedAt: 'desc' },
      }),
    ]);

    const mapped = tickets.map((ticket) => ({
      ticket_id: ticket.id,
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      message: ticket.message,
      user_id: ticket.userId,
      user_name: ticket.userName,
      user_email: ticket.userEmail,
      user_phone: ticket.userPhone,
      free_fire_uid: ticket.freeFireUid,
      in_game_name: ticket.inGameName,
      device_model: ticket.deviceModel,
      app_version: ticket.appVersion,
      os_version: ticket.osVersion,
      device_type: ticket.deviceType,
      status: ticket.status,
      admin_response: ticket.adminResponse,
      submitted_at: ticket.submittedAt,
      created_at: ticket.createdAt,
      updated_at: ticket.updatedAt,
    }));

    return createPaginatedResponse(mapped, page, limit, total);
  }

  async updateIssueReport(id: string, dto: UpdateIssueReportDto) {
    const existing = await this.prisma.issueReport.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Issue report with ID '${id}' not found`);
    }

    const updated = await this.prisma.issueReport.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.admin_notes !== undefined ? { adminNotes: dto.admin_notes } : {}),
      },
    });

    return {
      status: 'success',
      message: 'Issue report updated successfully',
      data: {
        issue_id: updated.id,
        id: updated.id,
        status: updated.status,
        admin_notes: updated.adminNotes,
        updated_at: updated.updatedAt,
      },
    };
  }

  async updateSupportTicket(id: string, dto: UpdateSupportTicketDto) {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Support ticket with ID '${id}' not found`);
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.admin_response !== undefined ? { adminResponse: dto.admin_response } : {}),
      },
    });

    return {
      status: 'success',
      message: 'Support ticket updated successfully',
      data: {
        ticket_id: updated.id,
        id: updated.id,
        status: updated.status,
        admin_response: updated.adminResponse,
        updated_at: updated.updatedAt,
      },
    };
  }

  private getHeaderValue(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | null {
    const val = headers[key] || headers[key.toLowerCase()];
    if (!val) return null;
    return Array.isArray(val) ? val[0] : val;
  }

  private async generateCustomId(prefix: 'ISS' | 'TKT'): Promise<string> {
    const now = new Date();
    const dateStr =
      now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0');

    let count = 0;
    if (prefix === 'ISS') {
      count = await this.prisma.issueReport.count({
        where: {
          submittedAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          },
        },
      });
    } else {
      count = await this.prisma.supportTicket.count({
        where: {
          submittedAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          },
        },
      });
    }

    const seq = (count + 1).toString().padStart(3, '0');
    return `${prefix}-${dateStr}-${seq}`;
  }
}
