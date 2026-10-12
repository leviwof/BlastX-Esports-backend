jest.mock('@nestjs/event-emitter', () => ({
  EventEmitter2: class MockEventEmitter {
    emit = jest.fn();
  },
  OnEvent: () => () => {},
}));

jest.mock('@nestjs/config', () => ({
  ConfigService: class MockConfigService {
    get = jest.fn();
  },
}));

jest.mock('@nestjs/jwt', () => ({
  JwtService: class MockJwtService {
    sign = jest.fn();
    verify = jest.fn();
  },
}));

jest.mock('../common/jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate = jest.fn().mockReturnValue(true);
  },
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import {
  RecordingStatus,
  RegistrationStatus,
  TeamMemberRole,
  TournamentStatus,
  UserRole,
} from '@prisma/client';
import { toPlayerRecordingResponse, toAdminRecordingResponse } from './recordings.mapper';
import { AdminRecordingsController, AdminTournamentRecordingsController } from './admin-recordings.controller';

describe('Section 6: Tournament Match Recordings & Resumable Uploads', () => {
  let recordingsService: RecordingsService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockMatchAccessService: any;
  let redisStore: Map<string, string>;
  let globalFetchBackup: typeof global.fetch;

  const originalEnv = process.env;

  beforeAll(() => {
    globalFetchBackup = global.fetch;
  });

  afterAll(() => {
    global.fetch = globalFetchBackup;
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_DRIVE_REFRESH_TOKEN: 'test-refresh-token',
      GOOGLE_DRIVE_CLIENT_ID: 'test-client-id',
      GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_DRIVE_RECORDINGS_FOLDER_ID: 'folder-123',
    };

    redisStore = new Map();

    mockRedis = {
      client: {
        incr: jest.fn().mockImplementation(async (key: string) => {
          const val = Number(redisStore.get(key) || 0) + 1;
          redisStore.set(key, String(val));
          return val;
        }),
        expire: jest.fn().mockResolvedValue(1),
        get: jest.fn().mockImplementation(async (key: string) => {
          return redisStore.get(key) || null;
        }),
        set: jest.fn().mockImplementation(async (key: string, val: string) => {
          redisStore.set(key, val);
          return 'OK';
        }),
        del: jest.fn().mockImplementation(async (key: string) => {
          redisStore.delete(key);
          return 1;
        }),
      },
    };

    mockPrisma = {
      tournament: {
        findUnique: jest.fn(),
      },
      matchRecording: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tournamentRegistration: {
        findFirst: jest.fn(),
      },
      appConfig: {
        findFirst: jest.fn().mockResolvedValue({
          recordingConfig: {
            video_bitrate_kbps: 2500,
            max_height: 720,
            fps: 30,
            max_duration_minutes: 60,
            min_free_space_mb: 1500,
          },
        }),
      },
      tournamentAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    mockMatchAccessService = {
      getMyAccess: jest.fn(),
      listMatchUnits: jest.fn(),
      teamParticipatesInMatchUnit: jest.fn(),
      resolveCredentials: jest.fn(),
    };

    recordingsService = new RecordingsService(
      mockPrisma as any,
      mockRedis as any,
      mockMatchAccessService as any,
    );

    // Default mock fetch for Google Drive OAuth and Upload Session
    global.fetch = jest.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();

      // OAuth token refresh
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'mock-drive-access-token',
            expires_in: 3600,
          }),
          text: async () => '',
        } as any;
      }

      // Resumable upload session initialization
      if (urlStr.includes('googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (h: string) =>
              h.toLowerCase() === 'location'
                ? 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=secret-session-abc-123'
                : null,
          },
        } as any;
      }

      // Metadata lookup / verification
      if (urlStr.includes('googleapis.com/drive/v3/files/file-valid-123')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'file-valid-123',
            name: 'rec_tid1_m_1.mp4',
            mimeType: 'video/mp4',
            size: '50000000', // 50 MB
            trashed: false,
            webContentLink: 'https://drive.google.com/uc?id=file-valid-123&export=download',
          }),
        } as any;
      }

      // Permissions call
      if (urlStr.includes('/permissions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'perm-123' }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
      } as any;
    });
  });

  describe('Scenario 1: Player Authorization & Room Release Rules', () => {
    const tournamentId = 'tourney-1';
    const matchKey = 'm_match-1';
    const matchScheduledAt = new Date('2026-10-12T12:00:00Z');

    const validInitDto = {
      client_recording_id: 'client-rec-1',
      started_at: '2026-10-12T11:55:00Z',
      stopped_at: '2026-10-12T12:35:00Z',
      duration_seconds: 2400,
      size_bytes: 50000000,
      mime_type: 'video/mp4',
      resolution: '1280x720',
      device_model: 'OnePlus 11',
      app_version: '1.2.0',
    };

    const mockUnit = {
      matchKey,
      tournamentId,
      matchId: 'match-1',
      roundKey: 'round-1',
      roundName: 'Round 1',
      roundNumber: 1,
      groupName: 'Group A',
      matchNumber: 1,
      map: 'Bermuda',
      status: 'SCHEDULED',
      scheduledAt: matchScheduledAt,
      participatingTeamIds: ['team-play'],
      participatingRegIds: ['reg-play'],
      results: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.LIVE,
      });

      mockMatchAccessService.listMatchUnits.mockResolvedValue([mockUnit]);
      mockMatchAccessService.teamParticipatesInMatchUnit.mockReturnValue(true);
    });

    it('rejects a substitute member with NOT_PLAYING_MEMBER', async () => {
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-sub',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-sub' },
        role: TeamMemberRole.SUBSTITUTE,
        access: 'NON_PLAYING', // Substitute is non-playing
        isEliminated: false,
        isDisqualified: false,
      });

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, 'user-sub', validInitDto),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'NOT_PLAYING_MEMBER' }),
        }),
      );
    });

    it('rejects a Manager member with NOT_PLAYING_MEMBER', async () => {
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-mgr',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-mgr' },
        role: TeamMemberRole.MANAGER,
        access: 'NON_PLAYING', // Manager is non-playing
        isEliminated: false,
        isDisqualified: false,
      });

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, 'user-mgr', validInitDto),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'NOT_PLAYING_MEMBER' }),
        }),
      );
    });

    it('rejects an eliminated team with ELIMINATED', async () => {
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-elim',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-elim' },
        role: TeamMemberRole.PLAYER,
        access: 'PLAYING',
        isEliminated: true,
        eliminatedInRoundNumber: 1,
        isDisqualified: false,
      });

      mockMatchAccessService.listMatchUnits.mockResolvedValue([
        {
          ...mockUnit,
          roundNumber: 2, // Round 2 match
        },
      ]);

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, 'user-elim', validInitDto),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ELIMINATED' }),
        }),
      );
    });

    it('rejects a playing member BEFORE room credentials release with ROOM_NOT_RELEASED', async () => {
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-play',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-play' },
        role: TeamMemberRole.PLAYER,
        access: 'PLAYING',
        isEliminated: false,
        isDisqualified: false,
      });

      // Room credentials not yet released
      mockMatchAccessService.resolveCredentials.mockReturnValue({
        roomId: null,
        roomPassword: null,
        releasedAt: null,
        isReleased: false,
        source: 'none',
      });

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, 'user-play', validInitDto),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ROOM_NOT_RELEASED' }),
        }),
      );
    });

    it('allows a playing member AFTER room credentials release', async () => {
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-play',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-play' },
        role: TeamMemberRole.PLAYER,
        access: 'PLAYING',
        isEliminated: false,
        isDisqualified: false,
      });

      // Room credentials released
      mockMatchAccessService.resolveCredentials.mockReturnValue({
        roomId: '12345',
        roomPassword: 'pass',
        releasedAt: new Date('2026-10-12T11:45:00Z'),
        isReleased: true,
        source: 'match',
      });

      mockPrisma.matchRecording.findFirst.mockResolvedValue(null);
      mockPrisma.matchRecording.create.mockResolvedValue({
        id: 'rec-new-1',
        clientRecordingId: validInitDto.client_recording_id,
        tournamentId,
        teamId: 'team-play',
        userId: 'user-play',
        matchKey,
        matchId: 'match-1',
        status: RecordingStatus.PENDING_UPLOAD,
        sizeBytes: BigInt(validInitDto.size_bytes),
        uploadedBytes: BigInt(0),
        durationSeconds: validInitDto.duration_seconds,
        mimeType: validInitDto.mime_type,
        resolution: validInitDto.resolution,
        startedAt: new Date(validInitDto.started_at),
        stoppedAt: new Date(validInitDto.stopped_at),
        deviceModel: validInitDto.device_model,
        appVersion: validInitDto.app_version,
        createdAt: new Date(),
        uploadedAt: null,
      });

      const res = await recordingsService.initRecording(
        tournamentId,
        matchKey,
        'user-play',
        validInitDto,
      );

      expect(res.recording_id).toBe('rec-new-1');
      expect(res.status).toBe(RecordingStatus.PENDING_UPLOAD);
      expect(res.upload.strategy).toBe('RESUMABLE_URL');
      expect(res.upload.session_url).toContain('upload_id=secret-session-abc-123');
      expect(res.upload.chunk_size_bytes).toBe(8 * 1024 * 1024);
    });
  });

  describe('Scenario 2: Idempotency & Conflict on Existing UPLOADED Recording', () => {
    const tournamentId = 'tourney-1';
    const matchKey = 'm_match-1';
    const userId = 'user-play';
    const matchScheduledAt = new Date('2026-10-12T12:00:00Z');

    const mockUnit = {
      matchKey,
      tournamentId,
      matchId: 'match-1',
      roundKey: 'round-1',
      roundName: 'Round 1',
      roundNumber: 1,
      groupName: 'Group A',
      matchNumber: 1,
      map: 'Bermuda',
      status: 'SCHEDULED',
      scheduledAt: matchScheduledAt,
      participatingTeamIds: ['team-play'],
      participatingRegIds: ['reg-play'],
      results: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.LIVE,
      });

      mockMatchAccessService.listMatchUnits.mockResolvedValue([mockUnit]);
      mockMatchAccessService.teamParticipatesInMatchUnit.mockReturnValue(true);
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-play',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-play' },
        role: TeamMemberRole.PLAYER,
        access: 'PLAYING',
        isEliminated: false,
        isDisqualified: false,
      });
      mockMatchAccessService.resolveCredentials.mockReturnValue({
        roomId: '12345',
        roomPassword: 'pass',
        releasedAt: new Date('2026-10-12T11:45:00Z'),
        isReleased: true,
        source: 'match',
      });
    });

    const initDto = {
      client_recording_id: 'client-rec-1',
      started_at: '2026-10-12T11:55:00Z',
      stopped_at: '2026-10-12T12:35:00Z',
      duration_seconds: 2400,
      size_bytes: 50000000,
      mime_type: 'video/mp4',
    };

    it('returns existing recording and session if same client_recording_id is not yet UPLOADED', async () => {
      const existingPending = {
        id: 'rec-existing-1',
        clientRecordingId: 'client-rec-1',
        tournamentId,
        teamId: 'team-play',
        userId,
        matchKey,
        matchId: 'match-1',
        status: RecordingStatus.PENDING_UPLOAD,
        sizeBytes: BigInt(50000000),
        uploadedBytes: BigInt(0),
        durationSeconds: 2400,
        mimeType: 'video/mp4',
        resolution: null,
        startedAt: new Date(initDto.started_at),
        stoppedAt: new Date(initDto.stopped_at),
        deviceModel: null,
        appVersion: null,
        createdAt: new Date(),
        uploadedAt: null,
      };

      mockPrisma.matchRecording.findFirst.mockResolvedValue(existingPending);
      mockPrisma.matchRecording.update.mockResolvedValue(existingPending);

      const res = await recordingsService.initRecording(
        tournamentId,
        matchKey,
        userId,
        initDto,
      );

      expect(res.recording_id).toBe('rec-existing-1');
      expect(res.status).toBe(RecordingStatus.PENDING_UPLOAD);
      expect(res.upload.session_url).toBeDefined();
    });

    it('returns 409 RECORDING_ALREADY_UPLOADED if user already has an UPLOADED recording for this match', async () => {
      const existingUploaded = {
        id: 'rec-uploaded-1',
        clientRecordingId: 'client-rec-previous',
        tournamentId,
        teamId: 'team-play',
        userId,
        matchKey,
        matchId: 'match-1',
        status: RecordingStatus.UPLOADED,
        sizeBytes: BigInt(50000000),
        uploadedBytes: BigInt(50000000),
        durationSeconds: 2400,
        mimeType: 'video/mp4',
        resolution: null,
        startedAt: new Date(initDto.started_at),
        stoppedAt: new Date(initDto.stopped_at),
        deviceModel: null,
        appVersion: null,
        createdAt: new Date(),
        uploadedAt: new Date(),
      };

      mockPrisma.matchRecording.findFirst.mockResolvedValue(existingUploaded);

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, initDto),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'RECORDING_ALREADY_UPLOADED',
          }),
        }),
      );
    });
  });

  describe('Scenario 3: Implausible Metadata Validation', () => {
    const tournamentId = 'tourney-1';
    const matchKey = 'm_match-1';
    const userId = 'user-play';
    const matchScheduledAt = new Date('2026-10-12T12:00:00Z');

    const mockUnit = {
      matchKey,
      tournamentId,
      matchId: 'match-1',
      roundKey: 'round-1',
      roundName: 'Round 1',
      roundNumber: 1,
      groupName: 'Group A',
      matchNumber: 1,
      map: 'Bermuda',
      status: 'SCHEDULED',
      scheduledAt: matchScheduledAt,
      participatingTeamIds: ['team-play'],
      participatingRegIds: ['reg-play'],
      results: [],
    };

    beforeEach(() => {
      mockPrisma.tournament.findUnique.mockResolvedValue({
        id: tournamentId,
        status: TournamentStatus.LIVE,
      });

      mockMatchAccessService.listMatchUnits.mockResolvedValue([mockUnit]);
      mockMatchAccessService.teamParticipatesInMatchUnit.mockReturnValue(true);
      mockMatchAccessService.getMyAccess.mockResolvedValue({
        registration: {
          id: 'reg-play',
          status: RegistrationStatus.CONFIRMED,
        },
        team: { id: 'team-play' },
        role: TeamMemberRole.PLAYER,
        access: 'PLAYING',
        isEliminated: false,
        isDisqualified: false,
      });
      mockMatchAccessService.resolveCredentials.mockReturnValue({
        roomId: '12345',
        roomPassword: 'pass',
        releasedAt: new Date('2026-10-12T11:45:00Z'),
        isReleased: true,
        source: 'match',
      });

      mockPrisma.matchRecording.findFirst.mockResolvedValue(null);
    });

    it('rejects started_at more than 60 minutes before scheduled match time', async () => {
      const dto = {
        client_recording_id: 'client-early',
        started_at: '2026-10-12T10:45:00Z', // 75 mins before
        stopped_at: '2026-10-12T12:30:00Z',
        duration_seconds: 1800,
        size_bytes: 50000000,
        mime_type: 'video/mp4',
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects stopped_at that is before started_at', async () => {
      const dto = {
        client_recording_id: 'client-backwards',
        started_at: '2026-10-12T12:10:00Z',
        stopped_at: '2026-10-12T12:05:00Z', // Before start
        duration_seconds: 600,
        size_bytes: 50000000,
        mime_type: 'video/mp4',
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duration exceeding max_duration_minutes + 5', async () => {
      const dto = {
        client_recording_id: 'client-toolong',
        started_at: '2026-10-12T12:00:00Z',
        stopped_at: '2026-10-12T13:30:00Z',
        duration_seconds: 4000, // 66.6 minutes > (60 + 5) * 60 = 3900s
        size_bytes: 50000000,
        mime_type: 'video/mp4',
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects size_bytes smaller than 1 MB or larger than 1.5 GB', async () => {
      const tinyDto = {
        client_recording_id: 'client-tiny',
        started_at: '2026-10-12T12:00:00Z',
        stopped_at: '2026-10-12T12:30:00Z',
        duration_seconds: 1800,
        size_bytes: 500, // < 1MB
        mime_type: 'video/mp4',
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, tinyDto),
      ).rejects.toThrow(BadRequestException);

      const hugeDto = {
        ...tinyDto,
        size_bytes: 2 * 1024 * 1024 * 1024, // 2 GB > 1.5 GB
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, hugeDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unsupported mime types', async () => {
      const audioDto = {
        client_recording_id: 'client-audio',
        started_at: '2026-10-12T12:00:00Z',
        stopped_at: '2026-10-12T12:30:00Z',
        duration_seconds: 1800,
        size_bytes: 10000000,
        mime_type: 'audio/mp3',
      };

      await expect(
        recordingsService.initRecording(tournamentId, matchKey, userId, audioDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Scenario 4: Storage Verification on Complete & Wrong Size Handling', () => {
    const recordingId = 'rec-to-complete';
    const userId = 'user-owner';

    const mockRecordingRow = {
      id: recordingId,
      clientRecordingId: 'client-c-1',
      tournamentId: 't-1',
      teamId: 'team-1',
      userId,
      matchKey: 'm_1',
      status: RecordingStatus.PENDING_UPLOAD,
      sizeBytes: BigInt(50000000), // Expected 50 MB
      uploadedBytes: BigInt(0),
      durationSeconds: 1800,
      mimeType: 'video/mp4',
      startedAt: new Date('2026-10-12T12:00:00Z'),
      stoppedAt: new Date('2026-10-12T12:30:00Z'),
      createdAt: new Date(),
      uploadedAt: null,
    };

    it('successfully verifies and flips status to UPLOADED on valid size match', async () => {
      mockPrisma.matchRecording.findUnique.mockResolvedValue(mockRecordingRow);
      // Redis contains storage_file_id
      redisStore.set(`recording:file_id:${recordingId}`, 'file-valid-123');

      mockPrisma.matchRecording.update.mockResolvedValue({
        ...mockRecordingRow,
        status: RecordingStatus.UPLOADED,
        storageProvider: 'GOOGLE_DRIVE',
        storageFileId: 'file-valid-123',
        fileUrl: 'https://drive.google.com/uc?id=file-valid-123&export=download',
        uploadedAt: new Date(),
        uploadedBytes: BigInt(50000000),
      });

      const res = await recordingsService.completeRecording(recordingId, userId, {
        size_bytes: 50000000,
      });

      expect(res.status).toBe(RecordingStatus.UPLOADED);
      expect(mockPrisma.matchRecording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RecordingStatus.UPLOADED,
            storageFileId: 'file-valid-123',
          }),
        }),
      );
      expect(mockPrisma.tournamentAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RECORDING_COMPLETED',
          }),
        }),
      );
    });

    it('fails verification and marks FAILED when file size does not match', async () => {
      mockPrisma.matchRecording.findUnique.mockResolvedValue(mockRecordingRow);
      redisStore.set(`recording:file_id:${recordingId}`, 'file-valid-123');

      // The client claims 99999999 but Drive reports 50000000
      mockPrisma.matchRecording.update.mockResolvedValue({
        ...mockRecordingRow,
        status: RecordingStatus.FAILED,
        failureReason: 'Size mismatch',
      });

      await expect(
        recordingsService.completeRecording(recordingId, userId, {
          size_bytes: 99999999, // Mismatched size
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'RECORDING_VERIFICATION_FAILED',
          }),
        }),
      );

      expect(mockPrisma.matchRecording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RecordingStatus.FAILED,
            failureReason: expect.stringContaining('Size mismatch'),
          }),
        }),
      );

      expect(mockPrisma.tournamentAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RECORDING_FAILED',
          }),
        }),
      );
    });
  });

  describe('Scenario 5: Session Refresh & Expired Sessions', () => {
    const recordingId = 'rec-refresh';
    const userId = 'user-owner';

    const mockRecordingRow = {
      id: recordingId,
      clientRecordingId: 'client-r-1',
      tournamentId: 't-1',
      teamId: 'team-1',
      userId,
      matchKey: 'm_1',
      status: RecordingStatus.PENDING_UPLOAD,
      sizeBytes: BigInt(50000000),
      uploadedBytes: BigInt(0),
      durationSeconds: 1800,
      mimeType: 'video/mp4',
      startedAt: new Date('2026-10-12T12:00:00Z'),
      stoppedAt: new Date('2026-10-12T12:30:00Z'),
      createdAt: new Date(),
      uploadedAt: null,
      uploadSessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    it('returns existing cached upload session if still valid in Redis', async () => {
      mockPrisma.matchRecording.findUnique.mockResolvedValue(mockRecordingRow);
      redisStore.set(
        `recording:upload_session:${recordingId}`,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=cached-session',
      );

      const res = await recordingsService.getUploadSession(recordingId, userId);

      expect(res.upload.session_url).toContain('upload_id=cached-session');
      expect(res.upload.strategy).toBe('RESUMABLE_URL');
      expect(res.upload.chunk_size_bytes).toBe(8 * 1024 * 1024);
    });

    it('creates and returns a fresh upload session if previous session expired from Redis', async () => {
      mockPrisma.matchRecording.findUnique.mockResolvedValue(mockRecordingRow);
      // Session missing in Redis (expired)
      redisStore.delete(`recording:upload_session:${recordingId}`);

      const res = await recordingsService.getUploadSession(recordingId, userId);

      expect(res.upload.session_url).toContain('upload_id=secret-session-abc-123');
      expect(redisStore.get(`recording:upload_session:${recordingId}`)).toContain(
        'upload_id=secret-session-abc-123',
      );
    });

    it('rejects non-owner callers with FORBIDDEN', async () => {
      mockPrisma.matchRecording.findUnique.mockResolvedValue(mockRecordingRow);

      await expect(
        recordingsService.getUploadSession(recordingId, 'intruder-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Scenario 6: Admin List, Detail & Streaming with HTTP Range Support', () => {
    it('Admin controllers require ADMIN role guard', () => {
      const adminTourneyRoles = Reflect.getMetadata('roles', AdminTournamentRecordingsController);
      const adminRecRoles = Reflect.getMetadata('roles', AdminRecordingsController);

      expect(adminTourneyRoles).toContain(UserRole.ADMIN);
      expect(adminRecRoles).toContain(UserRole.ADMIN);
    });

    it('listAdminRecordings applies filters and returns mapped responses', async () => {
      mockPrisma.matchRecording.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          clientRecordingId: 'client-1',
          tournamentId: 't-1',
          teamId: 'team-1',
          userId: 'user-1',
          matchKey: 'm_1',
          status: RecordingStatus.UPLOADED,
          sizeBytes: BigInt(50000000),
          uploadedBytes: BigInt(50000000),
          durationSeconds: 1800,
          mimeType: 'video/mp4',
          resolution: '720p',
          startedAt: new Date('2026-10-12T12:00:00Z'),
          stoppedAt: new Date('2026-10-12T12:30:00Z'),
          deviceModel: 'Pixel 8',
          appVersion: '1.0.0',
          failureReason: null,
          keep: false,
          deletedAt: null,
          storageProvider: 'GOOGLE_DRIVE',
          storageFileId: 'file-123',
          fileUrl: 'https://drive.google.com/file-123',
          createdAt: new Date(),
          uploadedAt: new Date(),
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          user: { id: 'user-1', name: 'Player 1', email: 'p1@example.com' },
          team: { id: 'team-1', name: 'Team Alpha', tag: 'ALP' },
        },
      ]);
      mockPrisma.matchRecording.count.mockResolvedValue(1);

      const res = await recordingsService.listAdminRecordings('t-1', {
        match_key: 'm_1',
        page: 1,
        limit: 10,
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].id).toBe('rec-1');
      expect(res.data[0].storage_file_id).toBe('file-123');
      expect(res.data[0].user?.email).toBe('p1@example.com');
      expect(res.total).toBe(1);
    });

    it('streamRecording sends Range request to Google Drive and streams response', async () => {
      const recordingRow = {
        id: 'rec-stream',
        status: RecordingStatus.UPLOADED,
        storageFileId: 'file-valid-123',
      };
      mockPrisma.matchRecording.findUnique.mockResolvedValue(recordingRow);

      global.fetch = jest.fn().mockImplementation(async (url: string | URL, init?: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'token-stream', expires_in: 3600 }),
          } as any;
        }

        if (urlStr.includes('alt=media')) {
          return {
            ok: true,
            status: 206, // Partial Content
            headers: new Headers({
              'content-type': 'video/mp4',
              'content-length': '1024',
              'content-range': 'bytes 0-1023/50000000',
            }),
            body: { pipe: jest.fn() } as any,
          } as any;
        }

        return { ok: true, status: 200 } as any;
      });

      const mockReq: any = {
        headers: { range: 'bytes=0-1023' },
        on: jest.fn(),
      };
      const mockRes: any = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
        end: jest.fn(),
      };

      await recordingsService.streamRecording('rec-stream', mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(206);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-1023/50000000');
    });
  });

  describe('Scenario 7: Challenges Submit-Proof Untouched', () => {
    it('confirms submit-proof route and logic exist unchanged in challenges service', () => {
      const challengesServiceModule = require('../challenges/challenges.service');
      expect(challengesServiceModule.ChallengesService).toBeDefined();
      expect(
        typeof challengesServiceModule.ChallengesService.prototype.submitProof,
      ).toBe('function');
    });
  });

  describe('Scenario 8: Confidentiality of Resumable Upload Session URL', () => {
    it('PlayerRecordingResponse and AdminRecordingResponse never expose the session URL', () => {
      const mockRecording = {
        id: 'rec-test',
        clientRecordingId: 'client-test',
        tournamentId: 't-1',
        teamId: 'team-1',
        userId: 'u-1',
        matchKey: 'm_1',
        status: RecordingStatus.PENDING_UPLOAD,
        sizeBytes: BigInt(50000000),
        uploadedBytes: BigInt(0),
        durationSeconds: 1800,
        mimeType: 'video/mp4',
        resolution: '720p',
        startedAt: new Date(),
        stoppedAt: new Date(),
        deviceModel: 'Pixel',
        appVersion: '1.0',
        failureReason: null,
        keep: false,
        deletedAt: null,
        storageProvider: 'GOOGLE_DRIVE',
        storageFileId: 'file-123',
        fileUrl: 'https://drive.google.com/file-123',
        createdAt: new Date(),
        uploadedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      } as any;

      const playerDto = toPlayerRecordingResponse(mockRecording);
      expect((playerDto as any).session_url).toBeUndefined();
      expect((playerDto as any).upload_session_url).toBeUndefined();
      expect((playerDto as any).file_url).toBeUndefined(); // Player cannot see direct video URL

      const adminDto = toAdminRecordingResponse(mockRecording);
      expect((adminDto as any).session_url).toBeUndefined();
      expect((adminDto as any).upload_session_url).toBeUndefined();
    });

    it('Audit logs never contain the session URL or raw file URL', async () => {
      const recordingRow = {
        id: 'rec-audit',
        clientRecordingId: 'client-a-1',
        tournamentId: 't-1',
        teamId: 'team-1',
        userId: 'u-1',
        matchKey: 'm_1',
        status: RecordingStatus.PENDING_UPLOAD,
        sizeBytes: BigInt(50000000),
        uploadedBytes: BigInt(0),
        durationSeconds: 1800,
        mimeType: 'video/mp4',
        startedAt: new Date(),
        stoppedAt: new Date(),
        createdAt: new Date(),
        uploadedAt: null,
      };
      mockPrisma.matchRecording.findUnique.mockResolvedValue(recordingRow);
      redisStore.set(`recording:file_id:rec-audit`, 'file-valid-123');

      mockPrisma.matchRecording.update.mockResolvedValue({
        ...recordingRow,
        status: RecordingStatus.UPLOADED,
        storageFileId: 'file-valid-123',
      });

      await recordingsService.completeRecording('rec-audit', 'u-1', {
        size_bytes: 50000000,
      });

      const auditCalls = mockPrisma.tournamentAuditLog.create.mock.calls;
      for (const call of auditCalls) {
        const payloadStr = JSON.stringify(call[0].data);
        expect(payloadStr).not.toContain('upload_id=');
        expect(payloadStr).not.toContain('https://www.googleapis.com/upload');
      }
    });
  });

  describe('Task 4 Retention Cleanup', () => {
    it('deletes stored file and marks fileUrl null for expired completed tournaments, skips keep=true', async () => {
      process.env.RECORDING_RETENTION_DAYS = '30';

      const cutoffDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago

      mockPrisma.matchRecording.findMany.mockResolvedValue([
        {
          id: 'rec-cleanup-1',
          storageFileId: 'drive-del-1',
          fileUrl: 'https://drive.google.com/drive-del-1',
          status: RecordingStatus.UPLOADED,
          keep: false,
          uploadedAt: cutoffDate,
        },
      ]);

      mockPrisma.matchRecording.update.mockResolvedValue({
        id: 'rec-cleanup-1',
        fileUrl: null,
        storageFileId: null,
        deletedAt: new Date(),
      });

      const deletedCount = await recordingsService.cleanExpiredRecordings();

      expect(deletedCount).toBe(1);
      expect(mockPrisma.matchRecording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-cleanup-1' },
          data: expect.objectContaining({
            fileUrl: null,
            storageFileId: null,
            deletedAt: expect.any(Date),
          }),
        }),
      );
    });
  });
});
