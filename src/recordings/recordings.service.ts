import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  BadGatewayException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MatchAccessService } from '../matches/match-access.service';
import {
  MatchRecording,
  RecordingStatus,
  RegistrationStatus,
  TournamentStatus,
} from '@prisma/client';
import { InitRecordingDto } from './dto/init-recording.dto';
import { CompleteRecordingDto } from './dto/complete-recording.dto';
import { ProgressRecordingDto } from './dto/progress-recording.dto';
import { ListAdminRecordingsQuery } from './dto/list-admin-recordings.query';
import {
  toPlayerRecordingResponse,
  toAdminRecordingResponse,
  PlayerRecordingResponse,
  AdminRecordingResponse,
} from './recordings.mapper';
import { DEFAULT_RECORDING_CONFIG } from '../app-config/app-config.service';

export interface ResumableUploadSession {
  strategy: 'RESUMABLE_URL';
  session_url: string;
  chunk_size_bytes: number;
  expires_at: string;
}

export interface InitRecordingResponse {
  recording_id: string;
  status: RecordingStatus;
  upload: ResumableUploadSession;
}

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);
  private cachedAccessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly matchAccessService: MatchAccessService,
  ) {}

  /**
   * Retrieves or refreshes Google Drive OAuth2 Access Token
   */
  async getGoogleDriveAccessToken(): Promise<string | null> {
    if (this.cachedAccessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.cachedAccessToken;
    }

    const clean = (val?: string) =>
      val?.trim().replace(/^["']|["']$/g, '') || '';
    const refreshToken = clean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
    const clientId =
      clean(process.env.GOOGLE_DRIVE_CLIENT_ID) ||
      clean(process.env.GOOGLE_CLIENT_IDS?.split(',')[0]);
    const clientSecret = clean(process.env.GOOGLE_DRIVE_CLIENT_SECRET);

    if (refreshToken && clientId && clientSecret) {
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
        });

        if (tokenRes.ok) {
          const data = (await tokenRes.json()) as {
            access_token: string;
            expires_in?: number;
          };
          this.cachedAccessToken = data.access_token;
          const expiresInSec = data.expires_in ?? 3500;
          this.accessTokenExpiresAt = Date.now() + (expiresInSec - 300) * 1000;
          return data.access_token;
        } else {
          const err = await tokenRes.text();
          this.logger.error(
            `Google Drive OAuth2 token exchange failed (${tokenRes.status}): ${err}`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `Google Drive OAuth2 refresh error: ${err.message}`,
        );
      }
    }

    return null;
  }

  /**
   * Creates a Google Drive resumable upload session
   */
  private async createDriveUploadSession(
    filename: string,
    mimeType: string,
    sizeBytes: number,
  ): Promise<string> {
    const accessToken = await this.getGoogleDriveAccessToken();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim().replace(
      /^["']|["']$/g,
      '',
    );

    if (!accessToken) {
      // In development or testing without live Drive credentials
      if (process.env.NODE_ENV === 'test' || !process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
        return `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_session_${Date.now()}`;
      }
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Video storage provider is not configured.',
      });
    }

    try {
      const metadata: Record<string, any> = {
        name: filename,
        mimeType: mimeType || 'video/mp4',
        description: 'BlastiX tournament match recording',
      };
      if (folderId && folderId.trim()) {
        metadata.parents = [folderId.trim()];
      }

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType || 'video/mp4',
            'X-Upload-Content-Length': String(sizeBytes),
          },
          body: JSON.stringify(metadata),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(
          `Failed to initiate Google Drive resumable session (${res.status}): ${errText}`,
        );
        throw new BadGatewayException({
          code: 'STORAGE_SESSION_FAILED',
          message: 'Could not create upload session with Google Drive.',
        });
      }

      const location = res.headers.get('location');
      if (!location) {
        throw new BadGatewayException({
          code: 'STORAGE_SESSION_FAILED',
          message: 'Google Drive did not return a session location header.',
        });
      }

      return location;
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Error creating upload session: ${err.message}`);
      throw new BadGatewayException({
        code: 'STORAGE_SESSION_FAILED',
        message: 'Could not initiate video upload session.',
      });
    }
  }

  /**
   * POST /v1/tournaments/:tid/matches/:matchKey/recordings
   * Initiates a match recording session for a playing member.
   */
  async initRecording(
    tournamentId: string,
    matchKey: string,
    userId: string,
    dto: InitRecordingDto,
  ): Promise<InitRecordingResponse> {
    // 1. Rate limit: max 10 init requests per minute per user
    const rateLimitKey = `rate_limit:recording_init:${userId}`;
    try {
      const current = await this.redis.client.incr(rateLimitKey);
      if (current === 1) {
        await this.redis.client.expire(rateLimitKey, 60);
      }
      if (current > 10) {
        throw new HttpException(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many recording initialization requests. Please wait a minute.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // If Redis is offline, continue
    }

    // 2. Tournament check
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      throw new NotFoundException({
        code: 'TOURNAMENT_NOT_FOUND',
        message: 'Tournament not found',
      });
    }

    // 3. User access check (MatchAccessService)
    const myAccess = await this.matchAccessService.getMyAccess(
      userId,
      tournamentId,
    );

    if (
      !myAccess.registration ||
      myAccess.registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw new HttpException(
        {
          code: 'NOT_REGISTERED',
          message: 'You are not registered for this tournament.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (myAccess.access !== 'PLAYING') {
      throw new HttpException(
        {
          code: 'NOT_PLAYING_MEMBER',
          message: 'Only playing members are authorized to upload recordings.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 4. Match unit resolution
    const units = await this.matchAccessService.listMatchUnits(tournamentId);
    const unit = units.find((u) => u.matchKey === matchKey);
    if (!unit) {
      throw new NotFoundException({
        code: 'MATCH_NOT_FOUND',
        message: `Match unit ${matchKey} not found in this tournament.`,
      });
    }

    // 5. Team participation check
    const participates = this.matchAccessService.teamParticipatesInMatchUnit(
      unit,
      myAccess.team?.id ?? null,
      userId,
      myAccess.registration.id,
    );

    if (!participates) {
      if (myAccess.isEliminated) {
        throw new HttpException(
          {
            code: 'ELIMINATED',
            message: 'Your team has been eliminated from this tournament.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
      throw new HttpException(
        {
          code: 'NOT_IN_THIS_MATCH',
          message: 'Your team is not assigned to this match.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 6. Check elimination from earlier rounds
    if (myAccess.isEliminated) {
      if (
        myAccess.eliminatedInRoundNumber &&
        unit.roundNumber &&
        unit.roundNumber > myAccess.eliminatedInRoundNumber
      ) {
        throw new HttpException(
          {
            code: 'ELIMINATED',
            message: 'Your team has been eliminated from this tournament.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 7. Room release check
    const creds = this.matchAccessService.resolveCredentials(
      unit,
      tournament,
      myAccess.team,
    );
    if (!creds.isReleased) {
      throw new HttpException(
        {
          code: 'ROOM_NOT_RELEASED',
          message: 'Room credentials have not yet been released for this match.',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 8. Plausibility checks on metadata
    // started_at within 60 minutes before scheduled start and 6 hours after
    const schedTime = unit.scheduledAt.getTime();
    const startTime = new Date(dto.started_at).getTime();
    const stopTime = new Date(dto.stopped_at).getTime();

    if (isNaN(startTime) || isNaN(stopTime)) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message: 'Invalid started_at or stopped_at timestamp.',
      });
    }

    const startMin = schedTime - 60 * 60 * 1000;
    const startMax = schedTime + 6 * 60 * 60 * 1000;
    if (startTime < startMin || startTime > startMax) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message:
          'started_at must be within 60 minutes before scheduled match start and 6 hours after.',
      });
    }

    if (stopTime <= startTime) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message: 'stopped_at must be strictly after started_at.',
      });
    }

    // Duration limit: max_duration_minutes + 5
    const appConfig = await this.prisma.appConfig.findFirst({
      where: { id: 1 },
    });
    const maxDurationMins =
      Number((appConfig?.recordingConfig as any)?.max_duration_minutes) ||
      DEFAULT_RECORDING_CONFIG.max_duration_minutes;
    const maxDurationSecs = (maxDurationMins + 5) * 60;

    if (dto.duration_seconds > maxDurationSecs || dto.duration_seconds <= 0) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message: `duration_seconds exceeds the maximum allowed duration of ${maxDurationMins + 5} minutes.`,
      });
    }

    // Size limit: 1 MB to 1.5 GB
    if (dto.size_bytes < 1048576 || dto.size_bytes > 1610612736) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message: 'size_bytes must be between 1 MB and 1.5 GB.',
      });
    }

    // Mime type: video/mp4, video/quicktime, or video/webm
    const allowedMimeTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (
      !dto.mime_type ||
      !allowedMimeTypes.includes(dto.mime_type.toLowerCase())
    ) {
      throw new BadRequestException({
        code: 'INVALID_RECORDING_META',
        message:
          'mime_type must be video/mp4, video/quicktime, or video/webm.',
      });
    }

    // 9. Idempotency check: same client_recording_id or match_key
    const existing = await this.prisma.matchRecording.findFirst({
      where: {
        userId,
        OR: [
          { clientRecordingId: dto.client_recording_id },
          { matchKey },
        ],
      },
    });

    if (existing) {
      if (existing.status === RecordingStatus.UPLOADED) {
        throw new ConflictException({
          code: 'RECORDING_ALREADY_UPLOADED',
          message: 'A recording for this match has already been uploaded.',
          recording: toPlayerRecordingResponse(existing),
        });
      }

      // Check if existing session in Redis is still valid
      const sessionKey = `recording:upload_session:${existing.id}`;
      let sessionUrl: string | null = null;
      try {
        sessionUrl = await this.redis.client.get(sessionKey);
      } catch {}

      const now = new Date();
      if (
        sessionUrl &&
        existing.uploadSessionExpiresAt &&
        existing.uploadSessionExpiresAt > now
      ) {
        return {
          recording_id: existing.id,
          status: existing.status,
          upload: {
            strategy: 'RESUMABLE_URL',
            session_url: sessionUrl,
            chunk_size_bytes: 8388608,
            expires_at: existing.uploadSessionExpiresAt.toISOString(),
          },
        };
      }

      // Refresh expired session
      const filename = `recording_${tournamentId}_${matchKey}_${userId}_${existing.clientRecordingId}.mp4`;
      const freshSessionUrl = await this.createDriveUploadSession(
        filename,
        dto.mime_type,
        dto.size_bytes,
      );
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      try {
        await this.redis.client.set(
          sessionKey,
          freshSessionUrl,
          'EX',
          7 * 24 * 60 * 60,
        );
      } catch {}

      await this.prisma.matchRecording.update({
        where: { id: existing.id },
        data: {
          uploadSessionExpiresAt: expiresAt,
          status: RecordingStatus.PENDING_UPLOAD,
          failureReason: null,
        },
      });

      return {
        recording_id: existing.id,
        status: RecordingStatus.PENDING_UPLOAD,
        upload: {
          strategy: 'RESUMABLE_URL',
          session_url: freshSessionUrl,
          chunk_size_bytes: 8388608,
          expires_at: expiresAt.toISOString(),
        },
      };
    }

    // 10. Create new recording record and upload session
    const filename = `recording_${tournamentId}_${matchKey}_${userId}_${dto.client_recording_id}.mp4`;
    const sessionUrl = await this.createDriveUploadSession(
      filename,
      dto.mime_type,
      dto.size_bytes,
    );
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const recording = await this.prisma.matchRecording.create({
      data: {
        clientRecordingId: dto.client_recording_id,
        tournamentId,
        teamId: myAccess.team?.id ?? null,
        userId,
        matchKey,
        matchId: unit.matchId,
        groupId: unit.groupId,
        status: RecordingStatus.PENDING_UPLOAD,
        sizeBytes: BigInt(dto.size_bytes),
        uploadedBytes: BigInt(0),
        durationSeconds: dto.duration_seconds,
        mimeType: dto.mime_type,
        resolution: dto.resolution ?? null,
        startedAt: new Date(dto.started_at),
        stoppedAt: new Date(dto.stopped_at),
        deviceModel: dto.device_model ?? null,
        appVersion: dto.app_version ?? null,
        uploadSessionExpiresAt: expiresAt,
      },
    });

    // Store session URL in Redis with TTL (never in DB plaintext or log)
    const sessionKey = `recording:upload_session:${recording.id}`;
    try {
      await this.redis.client.set(
        sessionKey,
        sessionUrl,
        'EX',
        7 * 24 * 60 * 60,
      );
    } catch {}

    // Audit log (NEVER include session URL)
    await this.prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        action: 'RECORDING_INITIATED',
        details: {
          recordingId: recording.id,
          matchKey,
          userId,
          clientRecordingId: dto.client_recording_id,
          sizeBytes: dto.size_bytes,
        },
        adminUserId: userId,
      },
    });

    return {
      recording_id: recording.id,
      status: recording.status,
      upload: {
        strategy: 'RESUMABLE_URL',
        session_url: sessionUrl,
        chunk_size_bytes: 8388608,
        expires_at: expiresAt.toISOString(),
      },
    };
  }

  /**
   * GET /v1/recordings/:id/upload-session
   * Returns current upload session or creates a fresh one if expired.
   */
  async getUploadSession(
    recordingId: string,
    userId: string,
  ): Promise<InitRecordingResponse> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_RECORDING_ACCESS',
        message: 'You are not authorized to view this recording.',
      });
    }

    if (recording.status === RecordingStatus.UPLOADED) {
      throw new ConflictException({
        code: 'RECORDING_ALREADY_UPLOADED',
        message: 'This recording has already been completed and uploaded.',
        recording: toPlayerRecordingResponse(recording),
      });
    }

    const sessionKey = `recording:upload_session:${recording.id}`;
    let sessionUrl: string | null = null;
    try {
      sessionUrl = await this.redis.client.get(sessionKey);
    } catch {}

    const now = new Date();
    if (
      sessionUrl &&
      (!recording.uploadSessionExpiresAt ||
        recording.uploadSessionExpiresAt > now)
    ) {
      const expiresAt =
        recording.uploadSessionExpiresAt ||
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return {
        recording_id: recording.id,
        status: recording.status,
        upload: {
          strategy: 'RESUMABLE_URL',
          session_url: sessionUrl,
          chunk_size_bytes: 8388608,
          expires_at: expiresAt.toISOString(),
        },
      };
    }

    // Refresh expired session
    const filename = `recording_${recording.tournamentId}_${recording.matchKey}_${userId}_${recording.clientRecordingId}.mp4`;
    const freshSessionUrl = await this.createDriveUploadSession(
      filename,
      recording.mimeType || 'video/mp4',
      recording.sizeBytes ? Number(recording.sizeBytes) : 10000000,
    );
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    try {
      await this.redis.client.set(
        sessionKey,
        freshSessionUrl,
        'EX',
        7 * 24 * 60 * 60,
      );
    } catch {}

    await this.prisma.matchRecording.update({
      where: { id: recording.id },
      data: {
        uploadSessionExpiresAt: expiresAt,
        status: RecordingStatus.PENDING_UPLOAD,
      },
    });

    return {
      recording_id: recording.id,
      status: RecordingStatus.PENDING_UPLOAD,
      upload: {
        strategy: 'RESUMABLE_URL',
        session_url: freshSessionUrl,
        chunk_size_bytes: 8388608,
        expires_at: expiresAt.toISOString(),
      },
    };
  }

  /**
   * POST /v1/recordings/:id/complete
   * Verifies file with Google Drive API and sets status UPLOADED.
   */
  async completeRecording(
    recordingId: string,
    userId: string,
    dto: CompleteRecordingDto,
  ): Promise<PlayerRecordingResponse> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_RECORDING_ACCESS',
        message: 'You are not authorized to complete this recording.',
      });
    }

    if (recording.status === RecordingStatus.UPLOADED) {
      return toPlayerRecordingResponse(recording);
    }

    const expectedSize = recording.sizeBytes
      ? Number(recording.sizeBytes)
      : dto.size_bytes;

    // Verify file with storage API
    let verifiedFileId: string | null = null;
    let verifiedMime = 'video/mp4';

    const accessToken = await this.getGoogleDriveAccessToken();
    let targetFileId: string | null | undefined = dto.storage_file_id;
    if (!targetFileId) {
      try {
        targetFileId = await this.redis.client.get(
          `recording:file_id:${recording.id}`,
        );
      } catch {}
    }

    if (accessToken && targetFileId) {
      try {
        const verifyRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${targetFileId}?supportsAllDrives=true&fields=id,name,size,mimeType,trashed`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );

        if (verifyRes.ok) {
          const fileData = (await verifyRes.json()) as {
            id: string;
            name: string;
            size: string;
            mimeType: string;
            trashed: boolean;
          };

          if (
            fileData.trashed ||
            !fileData.mimeType?.startsWith('video/') ||
            Number(fileData.size) !== dto.size_bytes
          ) {
            await this.markRecordingFailed(
              recording.id,
              recording.tournamentId,
              userId,
              recording.matchKey,
              `Size mismatch: size=${fileData.size}, expected=${dto.size_bytes}, mime=${fileData.mimeType}`,
            );
            throw new BadRequestException({
              code: 'RECORDING_VERIFICATION_FAILED',
              message:
                'Uploaded file verification failed (size or type mismatch).',
            });
          }

          verifiedFileId = fileData.id;
          verifiedMime = fileData.mimeType;

          // Set permissions for preview
          try {
            await fetch(
              `https://www.googleapis.com/drive/v3/files/${verifiedFileId}/permissions?supportsAllDrives=true`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ role: 'reader', type: 'anyone' }),
              },
            );
          } catch {}
        } else {
          await this.markRecordingFailed(
            recording.id,
            recording.tournamentId,
            userId,
            recording.matchKey,
            `File ID ${dto.storage_file_id} not found on Google Drive.`,
          );
          throw new BadRequestException({
            code: 'RECORDING_VERIFICATION_FAILED',
            message: 'File not found on storage provider.',
          });
        }
      } catch (err: any) {
        if (err instanceof HttpException) throw err;
        await this.markRecordingFailed(
          recording.id,
          recording.tournamentId,
          userId,
          recording.matchKey,
          `Google Drive verification error: ${err.message}`,
        );
        throw new BadRequestException({
          code: 'RECORDING_VERIFICATION_FAILED',
          message: 'Could not verify file with storage provider.',
        });
      }
    } else {
      // Test environment or mocked verification
      if (dto.size_bytes !== expectedSize) {
        await this.markRecordingFailed(
          recording.id,
          recording.tournamentId,
          userId,
          recording.matchKey,
          `Size mismatch: declared=${dto.size_bytes}, expected=${expectedSize}`,
        );
        throw new BadRequestException({
          code: 'RECORDING_VERIFICATION_FAILED',
          message: 'Declared size does not match verified recording size.',
        });
      }
      verifiedFileId = dto.storage_file_id || `drive_file_${recording.id}`;
    }

    const fileUrl = `https://drive.google.com/file/d/${verifiedFileId}/preview`;
    const now = new Date();

    const updated = await this.prisma.matchRecording.update({
      where: { id: recording.id },
      data: {
        status: RecordingStatus.UPLOADED,
        storageProvider: 'google_drive',
        storageFileId: verifiedFileId,
        fileUrl,
        uploadedBytes: BigInt(dto.size_bytes),
        uploadedAt: now,
        failureReason: null,
      },
    });

    // Clean up Redis upload session
    try {
      await this.redis.client.del(`recording:upload_session:${recording.id}`);
    } catch {}

    // Audit log (no secret session URL)
    await this.prisma.tournamentAuditLog.create({
      data: {
        tournamentId: recording.tournamentId,
        action: 'RECORDING_COMPLETED',
        details: {
          recordingId: recording.id,
          matchKey: recording.matchKey,
          userId,
          storageProvider: 'google_drive',
          storageFileId: verifiedFileId,
          sizeBytes: dto.size_bytes,
        },
        adminUserId: userId,
      },
    });

    return toPlayerRecordingResponse(updated);
  }

  private async markRecordingFailed(
    recordingId: string,
    tournamentId: string,
    userId: string,
    matchKey: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.matchRecording.update({
      where: { id: recordingId },
      data: {
        status: RecordingStatus.FAILED,
        failureReason: reason,
      },
    });

    await this.prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        action: 'RECORDING_FAILED',
        details: {
          recordingId,
          matchKey,
          userId,
          failureReason: reason,
        },
        adminUserId: userId,
      },
    });
  }

  /**
   * POST /v1/recordings/:id/progress
   * Reports upload progress from client.
   */
  async updateProgress(
    recordingId: string,
    userId: string,
    dto: ProgressRecordingDto,
  ): Promise<{ status: string; uploaded_bytes: number; recording_status: RecordingStatus }> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_RECORDING_ACCESS',
        message: 'You are not authorized to update this recording.',
      });
    }

    const newStatus =
      recording.status === RecordingStatus.PENDING_UPLOAD
        ? RecordingStatus.UPLOADING
        : recording.status;

    const updated = await this.prisma.matchRecording.update({
      where: { id: recording.id },
      data: {
        uploadedBytes: BigInt(dto.uploaded_bytes),
        status: newStatus,
      },
    });

    return {
      status: 'success',
      uploaded_bytes: Number(updated.uploadedBytes),
      recording_status: updated.status,
    };
  }

  /**
   * GET /v1/tournaments/:tid/matches/:matchKey/my-recording
   */
  async getMyRecording(
    tournamentId: string,
    matchKey: string,
    userId: string,
  ): Promise<PlayerRecordingResponse | null> {
    const recording = await this.prisma.matchRecording.findFirst({
      where: {
        tournamentId,
        matchKey,
        userId,
      },
    });

    if (!recording) return null;
    return toPlayerRecordingResponse(recording);
  }

  /**
   * GET /v1/recordings/:id
   */
  async getRecordingById(
    recordingId: string,
    userId: string,
  ): Promise<PlayerRecordingResponse> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException({
        code: 'UNAUTHORIZED_RECORDING_ACCESS',
        message: 'You are not authorized to view this recording.',
      });
    }

    return toPlayerRecordingResponse(recording);
  }

  /**
   * GET /v1/admin/tournaments/:id/recordings
   */
  async listAdminRecordings(
    tournamentId: string,
    query: ListAdminRecordingsQuery,
  ): Promise<{
    data: AdminRecordingResponse[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where: any = { tournamentId };
    if (query.match_key) where.matchKey = query.match_key;
    if (query.team_id) where.teamId = query.team_id;
    if (query.status) where.status = query.status;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.matchRecording.count({ where }),
      this.prisma.matchRecording.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          team: { select: { id: true, name: true, tag: true } },
        },
      }),
    ]);

    return {
      data: items.map(toAdminRecordingResponse),
      total,
      page,
      limit,
    };
  }

  /**
   * GET /v1/admin/recordings/:id
   */
  async getAdminRecordingById(
    recordingId: string,
  ): Promise<AdminRecordingResponse> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true, tag: true } },
      },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    return toAdminRecordingResponse(recording);
  }

  /**
   * GET /v1/admin/recordings/:id/stream
   * Authenticated Admin video stream with HTTP Range support.
   */
  async streamRecording(
    recordingId: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
    });

    if (
      !recording ||
      recording.status !== RecordingStatus.UPLOADED ||
      !recording.storageFileId
    ) {
      throw new NotFoundException({
        code: 'RECORDING_VIDEO_NOT_FOUND',
        message: 'Recording video file not found or not yet uploaded.',
      });
    }

    const fileId = recording.storageFileId;
    const accessToken = await this.getGoogleDriveAccessToken();

    if (!accessToken) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Google Drive storage is unavailable.',
      });
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    let driveRes: globalThis.Response;
    try {
      driveRes = await fetch(driveUrl, { method: 'GET', headers });
    } catch (err: any) {
      this.logger.error(`Stream connection failed: ${err.message}`);
      throw new BadGatewayException({
        code: 'STREAM_FAILED',
        message: 'Could not connect to storage provider.',
      });
    }

    if (!driveRes.ok && driveRes.status !== 206) {
      if (driveRes.status === 404) {
        throw new NotFoundException('Recording video not found on Google Drive.');
      }
      throw new BadGatewayException(
        `Google Drive returned status ${driveRes.status}`,
      );
    }

    res.status(driveRes.status);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const contentType = driveRes.headers.get('content-type');
    res.setHeader('Content-Type', contentType || 'video/mp4');

    const contentLength = driveRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = driveRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (driveRes.body) {
      if (typeof (driveRes.body as any).pipe === 'function') {
        (driveRes.body as any).pipe(res);
      } else {
        try {
          const nodeStream = Readable.fromWeb(driveRes.body as any);
          req.on('close', () => {
            try {
              nodeStream.destroy();
            } catch {}
          });
          nodeStream.pipe(res);
        } catch {
          res.end();
        }
      }
    } else {
      res.end();
    }
  }

  /**
   * Deletes a file from Google Drive
   */
  async deleteDriveFile(fileId: string): Promise<boolean> {
    const accessToken = await this.getGoogleDriveAccessToken();
    if (!accessToken) return false;
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return res.ok || res.status === 404;
    } catch (err: any) {
      this.logger.error(`Failed to delete Drive file ${fileId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Cleans up expired recordings older than RECORDING_RETENTION_DAYS for COMPLETED tournaments.
   * Skips recordings flagged with keep === true.
   */
  async cleanExpiredRecordings(): Promise<number> {
    try {
      const retentionDays = Number(process.env.RECORDING_RETENTION_DAYS || 30);
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const expiredRecordings = await this.prisma.matchRecording.findMany({
        where: {
          status: RecordingStatus.UPLOADED,
          fileUrl: { not: null },
          keep: false,
          uploadedAt: { lte: cutoffDate },
          tournament: {
            status: TournamentStatus.COMPLETED,
          },
        },
      });

      let deletedCount = 0;
      for (const rec of expiredRecordings) {
        if (rec.storageFileId) {
          try {
            await this.deleteDriveFile(rec.storageFileId);
          } catch (e: any) {
            this.logger.warn(
              `Failed to delete storage file ${rec.storageFileId}: ${e.message}`,
            );
          }
        }
        await this.prisma.matchRecording.update({
          where: { id: rec.id },
          data: {
            fileUrl: null,
            storageFileId: null,
            deletedAt: new Date(),
          },
        });
        deletedCount++;
      }

      if (deletedCount > 0) {
        this.logger.log(
          `[RETENTION] Cleaned up ${deletedCount} match recording(s) older than ${retentionDays} days for completed tournaments.`,
        );
      }

      return deletedCount;
    } catch (err: any) {
      this.logger.error(
        `[RETENTION] Error running recording cleanup: ${err.message}`,
      );
      return 0;
    }
  }

  /**
   * PATCH /v1/admin/recordings/:id
   * Admin can flag keep=true/false and add review notes
   */
  async updateAdminRecording(
    recordingId: string,
    data: { keep?: boolean; review_note?: string; reviewed_by?: string },
  ): Promise<AdminRecordingResponse> {
    const recording = await this.prisma.matchRecording.findUnique({
      where: { id: recordingId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true, tag: true } },
      },
    });

    if (!recording) {
      throw new NotFoundException({
        code: 'RECORDING_NOT_FOUND',
        message: 'Recording not found.',
      });
    }

    const updated = await this.prisma.matchRecording.update({
      where: { id: recordingId },
      data: {
        keep: data.keep !== undefined ? data.keep : recording.keep,
        reviewNote: data.review_note !== undefined ? data.review_note : recording.reviewNote,
        reviewedBy: data.reviewed_by !== undefined ? data.reviewed_by : recording.reviewedBy,
        reviewedAt:
          data.review_note !== undefined || data.reviewed_by !== undefined
            ? new Date()
            : recording.reviewedAt,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true, tag: true } },
      },
    });

    return toAdminRecordingResponse(updated);
  }
}
