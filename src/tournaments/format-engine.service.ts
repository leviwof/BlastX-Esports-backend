import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { recommendFormats, RecommendRequest } from './format-engine/recommendation-engine';
import { validateBRPath, validateClashCapacity } from './format-engine/format-validator';
import { deriveModeFromPrisma, getModeConfig, TournamentMode } from './format-engine/mode-registry';
import { FormatRecommendDto, FormatValidateDto } from './dto/format-engine.dto';
import { TournamentStatus } from '@prisma/client';

@Injectable()
export class FormatEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /api/admin/tournaments/format/recommend
   * Pure calculation — no DB writes.
   */
  recommend(dto: FormatRecommendDto) {
    const req: RecommendRequest = {
      mode: dto.mode as TournamentMode,
      registrationUnitCount: dto.registrationUnitCount,
      maxRounds: dto.maxRounds ?? 5,
      exactRounds: dto.exactRounds ?? false,
    };
    return recommendFormats(req);
  }

  /**
   * POST /api/admin/tournaments/format/validate
   * Validates a proposed path without creating anything.
   */
  validate(dto: FormatValidateDto) {
    if (!dto.proposedStages || dto.proposedStages.length === 0) {
      // Run full recommendation and return validation for all paths
      return this.recommend(dto);
    }

    const mode = dto.mode as TournamentMode;
    const config = getModeConfig(mode);

    if (config.strategy === 'CLASH_SQUAD') {
      const clashVal = validateClashCapacity(dto.registrationUnitCount);
      return {
        valid: clashVal.valid,
        errors: clashVal.errors,
        mode,
        requestedCapacity: dto.registrationUnitCount,
      };
    }

    const path = {
      stages: dto.proposedStages.map((s) => ({
        roundNumber: s.round,
        lobbyUnits: s.units,
        groupCount: s.groups,
        qualifiersPerGroup: s.qualifyPerGroup,
        nextLobbyUnits: s.isFinal ? 0 : s.groups * s.qualifyPerGroup,
        isFinal: s.isFinal,
      })),
      totalRounds: dto.proposedStages.length,
    };

    const result = validateBRPath(path, mode);
    return {
      valid: result.valid,
      errors: result.errors,
      mode,
      requestedCapacity: dto.registrationUnitCount,
    };
  }

  /**
   * POST /api/admin/tournaments/format/preview
   * Returns full round-by-round preview for a given mode + capacity.
   */
  preview(dto: FormatRecommendDto) {
    const result = this.recommend(dto);
    if (result.status === 'NO_VALID_FORMAT') {
      return result;
    }
    return {
      status: 'OK',
      mode: result.mode,
      requestedCapacity: result.requestedCapacity,
      pathCount: result.previewPaths?.length ?? 0,
      paths: result.previewPaths,
    };
  }

  /**
   * POST /api/admin/tournaments/:id/publish
   * Re-validates the stored format plan, then locks the tournament.
   */
  async publish(tournamentId: string, adminUserId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { formatPlan: true },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament ${tournamentId} not found`);
    }

    if (tournament.isFormatLocked) {
      throw new BadRequestException('Tournament format is already published and locked.');
    }

    // Must have a format plan saved
    if (!tournament.formatPlan) {
      throw new BadRequestException(
        'No format plan found. Call format/recommend, select a path, then save it before publishing.',
      );
    }

    // Re-validate the saved plan
    const mode = ((tournament.formatPlan.mode as TournamentMode) || deriveModeFromPrisma(
      tournament.format as any,
      tournament.teamMode as any,
    ));
    const config = getModeConfig(mode);
    const stages = tournament.formatPlan.stages as any[];

    if (config.strategy === 'CLASH_SQUAD') {
      const clashVal = validateClashCapacity(tournament.registrationUnitCount || tournament.maxSlots);
      if (!clashVal.valid) {
        throw new BadRequestException(`Format validation failed: ${clashVal.errors.join('; ')}`);
      }
    } else {
      const path = {
        stages: stages.map((s: any) => ({
          roundNumber: s.round,
          lobbyUnits: s.units,
          groupCount: s.groups,
          qualifiersPerGroup: s.qualifyPerGroup,
          nextLobbyUnits: s.isFinal ? 0 : s.groups * s.qualifyPerGroup,
          isFinal: s.isFinal,
        })),
        totalRounds: stages.length,
      };
      const validation = validateBRPath(path, mode);
      if (!validation.valid) {
        throw new BadRequestException(`Format validation failed: ${validation.errors.join('; ')}`);
      }
    }

    // Lock the tournament
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          isFormatLocked: true,
          lockedCapacity: tournament.registrationUnitCount ?? tournament.maxSlots,
          formatVersion: { increment: 1 },
          status: TournamentStatus.UPCOMING,
        },
      });

      await tx.tournamentAuditLog.create({
        data: {
          tournamentId,
          action: 'FORMAT_PUBLISHED',
          details: {
            formatVersion: t.formatVersion,
            mode,
            lockedCapacity: t.lockedCapacity,
            stages,
          },
          adminUserId,
        },
      });

      return t;
    });

    return {
      success: true,
      message: 'Tournament format published and locked.',
      formatVersion: updated.formatVersion,
      tournamentId,
    };
  }

  /**
   * Save selected format path to the tournament's format plan.
   * Called before publish — lets admin pick one path from recommendations.
   */
  async saveFormatPlan(
    tournamentId: string,
    stages: any[],
    adminUserId: string,
  ) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    if (tournament.isFormatLocked) {
      throw new BadRequestException('Cannot change a locked tournament format.');
    }

    // Validate the plan before saving
    const mode = deriveModeFromPrisma(tournament.format as any, tournament.teamMode as any);
    const config = getModeConfig(mode);

    if (config.strategy === 'CLASH_SQUAD') {
      const clashVal = validateClashCapacity(tournament.registrationUnitCount || tournament.maxSlots);
      if (!clashVal.valid) {
        throw new BadRequestException(`Invalid format plan: ${clashVal.errors.join('; ')}`);
      }
    } else {
      const path = {
        stages: stages.map((s) => ({
          roundNumber: s.round,
          lobbyUnits: s.units,
          groupCount: s.groups,
          qualifiersPerGroup: s.qualifyPerGroup,
          nextLobbyUnits: s.isFinal ? 0 : s.groups * s.qualifyPerGroup,
          isFinal: s.isFinal,
        })),
        totalRounds: stages.length,
      };
      const validation = validateBRPath(path, mode);
      if (!validation.valid) {
        throw new BadRequestException(`Invalid format plan: ${validation.errors.join('; ')}`);
      }
    }

    await this.prisma.tournamentFormatPlan.upsert({
      where: { tournamentId },
      create: { tournamentId, mode, stages },
      update: { stages, mode, updatedAt: new Date() },
    });

    await this.prisma.tournamentAuditLog.create({
      data: {
        tournamentId,
        action: 'FORMAT_PLAN_SAVED',
        details: { mode, stages },
        adminUserId,
      },
    });

    return { success: true, message: 'Format plan saved.' };
  }
}
