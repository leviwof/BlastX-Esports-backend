import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ChallengeType, ChallengeStatus } from '@prisma/client';
import {
  toChallengeResponse,
  ChallengeResponse,
  SubmitProofResponse,
  AdminChallengeResponse,
  AdminProofResponse,
  toAdminChallengeResponse,
  toAdminProofResponse,
} from './challenge.mapper';
import { UploadedProofFile } from './dto/submit-proof.dto';
import { ListChallengesQuery } from './dto/list-challenges.query';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { ListProofsQuery } from './dto/list-proofs.query';
import { RejectProofDto } from './dto/reject-proof.dto';
import { calculateRank, ClaimChallengeResponseData } from '../common/rank-system';
import { PaginatedResult, createPaginatedResponse } from '../common/pagination.dto';
import * as fs from 'fs';
import * as path from 'path';
import { JWT } from 'google-auth-library';


@Injectable()
export class ChallengesService implements OnModuleInit {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultChallenges();
  }

  async seedDefaultChallenges() {
    try {
      const count = await this.prisma.challenge.count();
      if (count > 0) return;

      const defaultChallenges = [
        {
          id: 'c1',
          title: 'First Blood',
          description: 'Get 5 kills in Battle Royale mode.',
          rewardXp: 100,
          targetProgress: 5.0,
          game: 'Free Fire',
          type: ChallengeType.DAILY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/kill.png',
          isActive: true,
        },
        {
          id: 'c2',
          title: 'Booyah Hunter',
          description: 'Win 1 match in Battle Royale / Clash Squad.',
          rewardXp: 500,
          targetProgress: 1.0,
          game: 'Free Fire',
          type: ChallengeType.WEEKLY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/trophy.png',
          isActive: true,
        },
        {
          id: 'c3',
          title: 'Clutch King',
          description: 'Eliminate 3 squads in ranked matches.',
          rewardXp: 300,
          targetProgress: 3.0,
          game: 'Free Fire',
          type: ChallengeType.DAILY,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/kill.png',
          isActive: true,
        },
        {
          id: 'c4',
          title: 'Survival Master',
          description: 'Survive until top 3 without being eliminated.',
          rewardXp: 200,
          targetProgress: 1.0,
          game: 'Free Fire',
          type: ChallengeType.SPECIAL,
          requiresRecording: true,
          gamePackage: 'com.dts.freefireth',
          iconAsset: 'assets/icons/trophy.png',
          isActive: true,
        },
      ];

      for (const ch of defaultChallenges) {
        await this.prisma.challenge.upsert({
          where: { id: ch.id },
          update: ch,
          create: ch,
        });
      }
      this.logger.log('Default esports challenges seeded successfully');
    } catch (err: any) {
      this.logger.warn(`Could not seed default challenges: ${err.message}`);
    }
  }

  async getChallenges(userId: string): Promise<ChallengeResponse[]> {
    const challenges = await this.prisma.challenge.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const userProgressList = await this.prisma.userChallenge.findMany({
      where: { userId },
    });

    const progressMap = new Map(userProgressList.map((up) => [up.challengeId, up]));

    return challenges.map((ch) => toChallengeResponse(ch, progressMap.get(ch.id)));
  }

  async claimChallenge(userId: string, challengeId: string): Promise<{ success: true; data: ClaimChallengeResponseData }> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException({
        code: 'CHALLENGE_NOT_FOUND',
        message: 'Challenge does not exist.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, xp: true, rank: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User does not exist.',
      });
    }

    const userChallenge = await this.prisma.userChallenge.findUnique({
      where: { unique_user_challenge: { userId, challengeId } },
    });

    // Check if already claimed
    if (userChallenge?.isClaimed || userChallenge?.status === ChallengeStatus.CLAIMED) {
      throw new BadRequestException({
        code: 'CHALLENGE_ALREADY_CLAIMED',
        message: 'Reward for this challenge has already been claimed.',
      });
    }

    // Check if eligible / completed
    const isCompleted =
      userChallenge?.isCompleted ||
      (userChallenge && userChallenge.currentProgress >= challenge.targetProgress);

    if (!isCompleted) {
      throw new BadRequestException({
        code: 'CHALLENGE_NOT_COMPLETED',
        message: 'Challenge is not completed yet.',
      });
    }

    const previousTotalXP = Math.max(0, user.xp || 0);
    const previousRankInfo = calculateRank(previousTotalXP);
    const claimedXP = challenge.rewardXp;
    const newTotalXP = previousTotalXP + claimedXP;
    const newRankInfo = calculateRank(newTotalXP);

    const rankChanged = newRankInfo.currentRank.number !== previousRankInfo.currentRank.number;

    // Transactionally mark claimed and award XP + rank to user
    await this.prisma.$transaction([
      this.prisma.userChallenge.upsert({
        where: { unique_user_challenge: { userId, challengeId } },
        update: {
          isClaimed: true,
          status: ChallengeStatus.CLAIMED,
          claimedAt: new Date(),
        },
        create: {
          userId,
          challengeId,
          currentProgress: challenge.targetProgress,
          isCompleted: true,
          isClaimed: true,
          status: ChallengeStatus.CLAIMED,
          claimedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          xp: newTotalXP,
          rank: newRankInfo.currentRank.number,
        },
      }),
    ]);

    const resultData: ClaimChallengeResponseData = {
      challengeId: challenge.id,
      claimedXP,
      totalXP: newTotalXP,
      rank: {
        number: newRankInfo.currentRank.number,
        name: newRankInfo.currentRank.name,
        minXP: newRankInfo.currentRank.minXP,
        nextRankMinXP: newRankInfo.nextRank ? newRankInfo.nextRank.minXP : null,
      },
      rankChanged,
    };

    if (rankChanged) {
      resultData.previousRank = {
        number: previousRankInfo.currentRank.number,
        name: previousRankInfo.currentRank.name,
        minXP: previousRankInfo.currentRank.minXP,
      };
    }

    return {
      success: true,
      data: resultData,
    };
  }

  async submitProof(
    userId: string,
    challengeId: string,
    file?: UploadedProofFile,
    resolution: string = '480p',
  ): Promise<SubmitProofResponse> {
    const challenge = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new NotFoundException(`Challenge with ID '${challengeId}' not found`);
    }

    if (!file) {
      throw new BadRequestException('Missing proof video file. An .mp4 match screen recording is required.');
    }

    // Validate mime / extension
    const allowedMime = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'application/octet-stream'];
    const isMp4Ext = file.originalname.toLowerCase().endsWith('.mp4');
    if (!allowedMime.includes(file.mimetype) && !isMp4Ext) {
      throw new BadRequestException('Invalid file type. Only video files (.mp4) are accepted as match proof.');
    }

    // Resolve the real video container/mime from the bytes so Google Drive stores a
    // playable type instead of the raw (often application/octet-stream) client mime.
    const { mimeType: videoMime, ext } = this.resolveVideoType(file.buffer, file.originalname, file.mimetype);

    const uniqueFilename = `${challengeId}_${userId}_${Date.now()}.${ext}`;
    const baseUrl = process.env.BASE_URL || 'https://blastx-esports-backend-production-4b5f.up.railway.app';
    let proofUrl = `${baseUrl}/uploads/proofs/${uniqueFilename}`;

    // 1. Primary: Google Drive (15TB Cloud Storage)
    const gdriveUrl = await this.uploadToGoogleDrive(uniqueFilename, videoMime, file.buffer);
    if (gdriveUrl) {
      proofUrl = gdriveUrl;
    } else {
      // 2. Fallback: Supabase Storage bucket 'proofs'
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
      let uploadedToSupabase = false;

      if (supabaseUrl && supabaseKey) {
        try {
          const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/proofs/${uniqueFilename}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': videoMime,
              'x-upsert': 'true',
            },
            body: new Uint8Array(file.buffer),
          });

          if (uploadRes.ok) {
            proofUrl = `${supabaseUrl}/storage/v1/object/public/proofs/${uniqueFilename}`;
            uploadedToSupabase = true;
            this.logger.log(`Video recording uploaded to Supabase Storage: ${proofUrl}`);
          }
        } catch (uploadErr) {
          this.logger.warn(`Supabase Storage upload error: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
        }
      }

      // 3. Fallback: Local disk (safe write)
      if (!uploadedToSupabase) {
        try {
          const uploadDir = path.join(process.cwd(), 'uploads', 'proofs');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const filePath = path.join(uploadDir, uniqueFilename);
          fs.writeFileSync(filePath, file.buffer);
        } catch (fsErr) {
          this.logger.warn(`Could not save proof locally to disk: ${fsErr instanceof Error ? fsErr.message : String(fsErr)}`);
        }
      }
    }

    // Update user challenge status to PROOF_SUBMITTED and mark completed for verification
    await this.prisma.userChallenge.upsert({
      where: { unique_user_challenge: { userId, challengeId } },
      update: {
        proofUrl,
        status: ChallengeStatus.PROOF_SUBMITTED,
        currentProgress: challenge.targetProgress,
        isCompleted: true,
        submittedAt: new Date(),
      },
      create: {
        userId,
        challengeId,
        proofUrl,
        status: ChallengeStatus.PROOF_SUBMITTED,
        currentProgress: challenge.targetProgress,
        isCompleted: true,
        isClaimed: false,
        submittedAt: new Date(),
      },
    });

    return {
      status: 'success',
      message: 'Proof uploaded successfully',
      challenge_id: challengeId,
      proof_url: proofUrl,
    };
  }

  async listAdminChallenges(
    query: ListChallengesQuery,
  ): Promise<PaginatedResult<AdminChallengeResponse>> {
    const where: Prisma.ChallengeWhereInput = {};
    if (query.type) where.type = query.type;
    if (typeof query.is_active === 'boolean') where.isActive = query.is_active;

    const [total, challenges] = await Promise.all([
      this.prisma.challenge.count({ where }),
      this.prisma.challenge.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return createPaginatedResponse(challenges.map(toAdminChallengeResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async createChallenge(
    dto: CreateChallengeDto,
  ): Promise<AdminChallengeResponse> {
    const challenge = await this.prisma.challenge.create({
      data: {
        title: dto.title,
        description: dto.description,
        rewardXp: dto.reward_xp,
        targetProgress: dto.target_progress ?? 1.0,
        game: dto.game ?? 'Free Fire',
        type: dto.type ?? ChallengeType.DAILY,
        requiresRecording: dto.requires_recording ?? true,
        gamePackage: dto.game_package ?? 'com.dts.freefireth',
        iconAsset: dto.icon_asset ?? null,
      },
    });

    return toAdminChallengeResponse(challenge);
  }

  async updateChallenge(
    id: string,
    dto: UpdateChallengeDto,
  ): Promise<AdminChallengeResponse> {
    const existing = await this.prisma.challenge.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Challenge with ID '${id}' not found`);
    }

    const data: Prisma.ChallengeUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.reward_xp !== undefined) data.rewardXp = dto.reward_xp;
    if (dto.target_progress !== undefined) data.targetProgress = dto.target_progress;
    if (dto.game !== undefined) data.game = dto.game;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.requires_recording !== undefined) data.requiresRecording = dto.requires_recording;
    if (dto.game_package !== undefined) data.gamePackage = dto.game_package;
    if (dto.icon_asset !== undefined) data.iconAsset = dto.icon_asset;
    if (dto.is_active !== undefined) data.isActive = dto.is_active;

    const updated = await this.prisma.challenge.update({
      where: { id },
      data,
    });

    return toAdminChallengeResponse(updated);
  }

  async deleteChallenge(id: string): Promise<{ message: string; soft_deleted: boolean }> {
    const existing = await this.prisma.challenge.findUnique({
      where: { id },
      include: { _count: { select: { userProgress: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Challenge with ID '${id}' not found`);
    }

    if (existing._count.userProgress > 0) {
      await this.prisma.challenge.update({
        where: { id },
        data: { isActive: false },
      });
      return { message: 'Challenge has user progress; deactivated (soft-deleted)', soft_deleted: true };
    } else {
      await this.prisma.challenge.delete({ where: { id } });
      return { message: 'Challenge deleted successfully', soft_deleted: false };
    }
  }

  async listProofs(
    query: ListProofsQuery,
  ): Promise<PaginatedResult<AdminProofResponse>> {
    const where: Prisma.UserChallengeWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }

    const [total, userChallenges] = await Promise.all([
      this.prisma.userChallenge.count({ where }),
      this.prisma.userChallenge.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { submittedAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          challenge: { select: { id: true, title: true, rewardXp: true } },
        },
      }),
    ]);

    return createPaginatedResponse(userChallenges.map(toAdminProofResponse), query.page ?? 1, query.limit ?? 20, total);
  }

  async approveProof(
    id: string,
    adminUserId: string,
  ): Promise<AdminProofResponse> {
    const userChallenge = await this.prisma.userChallenge.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        challenge: { select: { id: true, title: true, rewardXp: true } },
      },
    });

    if (!userChallenge) {
      throw new NotFoundException(`Proof with ID '${id}' not found`);
    }

    if (userChallenge.status === ChallengeStatus.COMPLETED || userChallenge.status === ChallengeStatus.CLAIMED) {
      throw new BadRequestException('Proof is already approved');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.userChallenge.update({
        where: { id },
        data: {
          status: ChallengeStatus.COMPLETED,
          isCompleted: true,
          reviewedAt: new Date(),
          reviewedBy: adminUserId,
          rejectionReason: null,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          challenge: { select: { id: true, title: true, rewardXp: true } },
        },
      }),
      this.prisma.user.update({
        where: { id: userChallenge.userId },
        data: {
          xp: { increment: userChallenge.challenge.rewardXp },
        },
      }),
    ]);

    return toAdminProofResponse(updated);
  }

  async rejectProof(
    id: string,
    dto: RejectProofDto,
    adminUserId: string,
  ): Promise<AdminProofResponse> {
    const userChallenge = await this.prisma.userChallenge.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        challenge: { select: { id: true, title: true, rewardXp: true } },
      },
    });

    if (!userChallenge) {
      throw new NotFoundException(`Proof with ID '${id}' not found`);
    }

    const updated = await this.prisma.userChallenge.update({
      where: { id },
      data: {
        status: ChallengeStatus.PROOF_REJECTED,
        rejectionReason: dto.reason,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        challenge: { select: { id: true, title: true, rewardXp: true } },
      },
    });

    return toAdminProofResponse(updated);
  }

  private async getGoogleDriveAccessToken(): Promise<string | null> {
    const clean = (val?: string) => val?.trim().replace(/^["']|["']$/g, '') || '';
    const refreshToken = clean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN);
    const clientId = clean(process.env.GOOGLE_DRIVE_CLIENT_ID) || clean(process.env.GOOGLE_CLIENT_IDS?.split(',')[0]);
    const clientSecret = clean(process.env.GOOGLE_DRIVE_CLIENT_SECRET);

    // 1. Primary: OAuth2 Refresh Token (uses personal 15TB My Drive quota)
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
          const data = (await tokenRes.json()) as { access_token: string };
          return data.access_token;
        } else {
          const err = await tokenRes.text();
          this.logger.error(`Google Drive OAuth2 token exchange failed (${tokenRes.status}): ${err}`);
        }
      } catch (err) {
        this.logger.error(`Google Drive OAuth2 refresh error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      const missing: string[] = [];
      if (!refreshToken) missing.push('GOOGLE_DRIVE_REFRESH_TOKEN');
      if (!clientId) missing.push('GOOGLE_DRIVE_CLIENT_ID');
      if (!clientSecret) missing.push('GOOGLE_DRIVE_CLIENT_SECRET');
      this.logger.warn(`Google Drive OAuth2 variables missing: ${missing.join(', ')}`);
    }

    return null;
  }

  /**
   * Determines the true video container/mime by sniffing the file's magic bytes,
   * falling back to the client-declared mime and finally to mp4. This prevents
   * generic types like application/octet-stream (common from mobile multipart
   * uploads) from being stored on Google Drive, which makes Drive reject the
   * inline preview and hand downloads off to an external player (e.g. VLC).
   */
  private resolveVideoType(
    buffer: Buffer,
    originalname: string,
    clientMime?: string,
  ): { mimeType: string; ext: string } {
    // MP4 / QuickTime: an ISO Base Media 'ftyp' box at byte offset 4.
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12).toLowerCase();
      if (brand.startsWith('qt')) {
        return { mimeType: 'video/quicktime', ext: 'mov' };
      }
      return { mimeType: 'video/mp4', ext: 'mp4' };
    }

    // Matroska / WebM: EBML header 0x1A45DFA3.
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return { mimeType: 'video/webm', ext: 'webm' };
    }

    const mimeExtMap: Record<string, string> = {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'video/x-matroska': 'mkv',
    };

    // Fall back to a real client-declared video type (ignore octet-stream/blank).
    if (clientMime && mimeExtMap[clientMime]) {
      return { mimeType: clientMime, ext: mimeExtMap[clientMime] };
    }

    // Last resort: honour a known extension on the original filename, else mp4.
    const lower = (originalname || '').toLowerCase();
    for (const [mime, e] of Object.entries(mimeExtMap)) {
      if (lower.endsWith(`.${e}`)) {
        return { mimeType: mime, ext: e };
      }
    }
    return { mimeType: 'video/mp4', ext: 'mp4' };
  }

  private async uploadToGoogleDrive(
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<string | null> {
    const accessToken = await this.getGoogleDriveAccessToken();
    if (!accessToken) return null;

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim().replace(/^["']|["']$/g, '');

    try {
      const boundary = '-------blastix3141592653589793';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const metadata: Record<string, any> = {
        name: filename,
        mimeType,
        description: 'BlastiX match proof recording',
      };
      if (folderId && folderId.trim()) {
        metadata.parents = [folderId.trim()];
      }

      const multipartRequestBody = Buffer.concat([
        Buffer.from(
          delimiter +
            'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${mimeType || 'video/mp4'}\r\n\r\n`,
        ),
        buffer,
        Buffer.from(closeDelimiter),
      ]);

      const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': String(multipartRequestBody.length),
        },
        body: multipartRequestBody,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Upload failed (${uploadRes.status}): ${errText}`);
      }

      const fileData = (await uploadRes.json()) as { id: string; webViewLink?: string };
      const fileId = fileData.id;

      // Make file readable so admin panel can preview it directly
      try {
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              role: 'reader',
              type: 'anyone',
            }),
          },
        );
      } catch (permErr) {
        this.logger.warn(`Could not set public permission on Google Drive file: ${permErr}`);
      }

      const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
      this.logger.log(`Proof video uploaded to 15TB Google Drive: ${previewUrl}`);
      return previewUrl;
    } catch (err) {
      this.logger.error(
        `Google Drive upload error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}



