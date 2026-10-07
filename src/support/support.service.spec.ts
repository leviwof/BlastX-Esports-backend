import { Test, TestingModule } from '@nestjs/testing';
import { SupportService } from './support.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssueReportStatus, SupportTicketStatus } from '@prisma/client';
import { QuerySupportIssuesDto } from './dto/query-support.dto';

describe('SupportService', () => {
  let service: SupportService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
      },
      issueReport: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      supportTicket: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  describe('reportIssue', () => {
    it('creates an issue report and returns the required JSON response format', async () => {
      prismaMock.issueReport.count.mockResolvedValue(0);
      prismaMock.issueReport.create.mockResolvedValue({
        id: 'ISS-20261007-001',
        status: IssueReportStatus.PENDING,
      });

      const res = await service.reportIssue(
        {
          issue_type: 'Bug / Glitch',
          description: 'App crashed during tournament room entry.',
          tournament_name: 'BlastX Arena FF Cup Season 1',
          device_model: 'Samsung Galaxy S24 Ultra',
          app_version: '1.0.0',
          os_version: 'Android 14',
          device_type: 'ANDROID',
        },
        {
          'x-device-model': 'Samsung Galaxy S24 Ultra',
          'x-os-version': 'Android 14',
          'x-app-version': '1.0.0',
          'x-device-type': 'ANDROID',
        },
      );

      expect(res).toEqual({
        status: 'success',
        message: 'Issue report submitted successfully',
        data: {
          issue_id: 'ISS-20261007-001',
          status: IssueReportStatus.PENDING,
        },
      });
      expect(prismaMock.issueReport.create).toHaveBeenCalled();
    });
  });

  describe('contactSupport', () => {
    it('creates a support ticket and returns ticket_id and OPEN status', async () => {
      prismaMock.supportTicket.count.mockResolvedValue(41);
      prismaMock.supportTicket.create.mockResolvedValue({
        id: 'TKT-20261007-042',
        status: SupportTicketStatus.OPEN,
      });

      const res = await service.contactSupport(
        {
          subject: 'Prize Money Payout Delay',
          category: 'Prize & Wallet Payouts',
          message: 'I won 2nd position yesterday.',
        },
        {},
      );

      expect(res).toEqual({
        status: 'success',
        message: 'Support message sent successfully',
        data: {
          ticket_id: 'TKT-20261007-042',
          status: SupportTicketStatus.OPEN,
        },
      });
    });
  });

  describe('admin operations', () => {
    it('lists admin issues with pagination', async () => {
      prismaMock.issueReport.count.mockResolvedValue(1);
      prismaMock.issueReport.findMany.mockResolvedValue([
        {
          id: 'ISS-20261007-001',
          issueType: 'Bug / Glitch',
          description: 'Crashed',
          tournamentName: 'Season 1',
          deviceModel: 'S24',
          appVersion: '1.0.0',
          osVersion: 'Android 14',
          deviceType: 'ANDROID',
          userId: 'usr_1',
          userName: 'ProGamer',
          userEmail: 'pro@test.com',
          userPhone: '+919999999999',
          freeFireUid: '12345',
          inGameName: 'KING',
          status: IssueReportStatus.PENDING,
          adminNotes: null,
          submittedAt: new Date('2026-10-07T15:30:00Z'),
          createdAt: new Date('2026-10-07T15:30:00Z'),
          updatedAt: new Date('2026-10-07T15:30:00Z'),
        },
      ]);

      const query = Object.assign(new QuerySupportIssuesDto(), { page: 1, limit: 20 });
      const res = await service.listAdminIssues(query);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].issue_id).toBe('ISS-20261007-001');
    });

    it('updates issue status and admin notes', async () => {
      prismaMock.issueReport.findUnique.mockResolvedValue({ id: 'ISS-20261007-001' });
      prismaMock.issueReport.update.mockResolvedValue({
        id: 'ISS-20261007-001',
        status: IssueReportStatus.RESOLVED,
        adminNotes: 'Fixed in build v1.0.1',
        updatedAt: new Date(),
      });

      const res = await service.updateIssueReport('ISS-20261007-001', {
        status: IssueReportStatus.RESOLVED,
        admin_notes: 'Fixed in build v1.0.1',
      });

      expect(res.status).toBe('success');
      expect(res.data.status).toBe(IssueReportStatus.RESOLVED);
      expect(res.data.admin_notes).toBe('Fixed in build v1.0.1');
    });
  });
});
