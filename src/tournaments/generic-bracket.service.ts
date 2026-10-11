import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoundStatus, TournamentRoundType, QualificationDestination } from '@prisma/client';

@Injectable()
export class GenericBracketService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Given a tournament with a saved format plan, generate the initial round.
   * Works for any BR mode and any valid path.
   */
  async generateStage(tournamentId: string, roundNumber: number, adminUserId: string) {
    const formatPlan = await this.prisma.tournamentFormatPlan.findUnique({
      where: { tournamentId },
    });

    if (!formatPlan) {
      throw new BadRequestException(
        'No format plan found. Publish the format before generating rounds.',
      );
    }

    const stages = formatPlan.stages as any[];
    const stageConfig = stages.find((s) => s.round === roundNumber);
    if (!stageConfig) {
      throw new BadRequestException(`Stage ${roundNumber} not found in format plan.`);
    }

    if (stageConfig.isFinal && roundNumber > 1) {
      return this.generateFinalStage(tournamentId, roundNumber, stageConfig, adminUserId);
    }

    // Get participants for this stage
    let participantIds: string[];

    if (roundNumber === 1) {
      // First round: read from confirmed registrations
      participantIds = await this.getConfirmedRegistrations(
        tournamentId,
        stageConfig.units,
      );
    } else {
      // Subsequent rounds: read qualifiers from previous round
      participantIds = await this.getPreviousRoundQualifiers(
        tournamentId,
        roundNumber - 1,
        stageConfig.units,
      );
    }

    if (participantIds.length !== stageConfig.units) {
      throw new BadRequestException(
        `Stage ${roundNumber} requires ${stageConfig.units} participants. Found ${participantIds.length}.`,
      );
    }

    return this.createRoundWithGroups(
      tournamentId,
      roundNumber,
      stageConfig,
      participantIds,
      adminUserId,
    );
  }

  private async getConfirmedRegistrations(tournamentId: string, expectedCount: number) {
    const registrations = await this.prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'CONFIRMED' },
      orderBy: { slotNumber: 'asc' },
    });

    const teamIds = Array.from(
      new Set(
        registrations
          .map((r) => r.teamId)
          .filter((id): id is string => id !== null),
      ),
    );

    if (teamIds.length < expectedCount) {
      throw new BadRequestException(
        `Expected ${expectedCount} confirmed registrations. Found ${teamIds.length}.`,
      );
    }

    return teamIds.slice(0, expectedCount);
  }

  private async getPreviousRoundQualifiers(
    tournamentId: string,
    prevRoundNumber: number,
    expectedCount: number,
  ): Promise<string[]> {
    const prevRound = await this.prisma.tournamentRound.findFirst({
      where: { tournamentId, roundNumber: prevRoundNumber },
      include: {
        qualifications: {
          where: {
            destination: {
              notIn: ['ELIMINATED' as any],
            },
          },
        },
      },
    });

    if (!prevRound || prevRound.status !== RoundStatus.COMPLETED) {
      throw new BadRequestException(`Round ${prevRoundNumber} must be COMPLETED first.`);
    }

    const qualIds = prevRound.qualifications.map((q) => q.tournamentTeamId);

    if (qualIds.length !== expectedCount) {
      throw new BadRequestException(
        `Expected ${expectedCount} qualifiers from round ${prevRoundNumber}. Got ${qualIds.length}.`,
      );
    }

    return qualIds;
  }

  private async createRoundWithGroups(
    tournamentId: string,
    roundNumber: number,
    stageConfig: any,
    participantIds: string[],
    adminUserId: string,
  ) {
    const roundTypeMap: Record<number, TournamentRoundType> = {
      1: TournamentRoundType.ROUND_1,
      2: TournamentRoundType.ROUND_2,
      3: TournamentRoundType.ROUND_3,
      4: TournamentRoundType.ROUND_4,
      5: TournamentRoundType.ROUND_5,
    };
    const roundType = stageConfig.isFinal
      ? TournamentRoundType.GRAND_FINAL
      : (roundTypeMap[roundNumber] ?? TournamentRoundType.ROUND_1);

    // Shuffle participants
    const shuffled = [...participantIds].sort(() => Math.random() - 0.5);
    const G = stageConfig.groups;
    const lobbySize = stageConfig.units / G;

    return this.prisma.$transaction(async (tx) => {
      const round = await tx.tournamentRound.upsert({
        where: { tournamentId_roundType: { tournamentId, roundType } },
        create: {
          tournamentId,
          roundType,
          roundNumber,
          status: RoundStatus.LIVE,
          startedAt: new Date(),
          lobbyUnits: stageConfig.units,
          groupCount: G,
          qualifiersPerGroup: stageConfig.qualifyPerGroup ?? (stageConfig.isFinal ? 0 : null),
          isFinal: stageConfig.isFinal ?? false,
        },
        update: {
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
      });

      await tx.tournamentGroup.deleteMany({ where: { roundId: round.id } });

      for (let gIdx = 0; gIdx < G; gIdx++) {
        const groupParticipants = shuffled.slice(gIdx * lobbySize, (gIdx + 1) * lobbySize);
        const group = await tx.tournamentGroup.create({
          data: {
            roundId: round.id,
            groupNumber: gIdx + 1,
            name: `Group ${String.fromCharCode(65 + gIdx)}`, // A, B, C ...
          },
        });

        for (let pIdx = 0; pIdx < groupParticipants.length; pIdx++) {
          await tx.tournamentGroupTeam.create({
            data: {
              groupId: group.id,
              tournamentTeamId: groupParticipants[pIdx],
              seed: pIdx + 1,
              kills: 0,
              placementPoints: 0,
              totalPoints: 0,
            },
          });
        }
      }

      await tx.tournamentAuditLog.create({
        data: {
          tournamentId,
          action: `GENERATE_ROUND_${roundNumber}`,
          details: { roundId: round.id, groups: G, participantsCount: shuffled.length },
          adminUserId,
        },
      });

      return tx.tournamentRound.findUnique({
        where: { id: round.id },
        include: {
          groups: {
            include: { groupTeams: { include: { tournamentTeam: true } } },
          },
        },
      });
    });
  }

  private async generateFinalStage(
    tournamentId: string,
    roundNumber: number,
    stageConfig: any,
    adminUserId: string,
  ) {
    // Final stage for the generic engine
    const qualifierIds = await this.getPreviousRoundQualifiers(
      tournamentId,
      roundNumber - 1,
      stageConfig.units,
    );

    return this.createRoundWithGroups(
      tournamentId,
      roundNumber,
      stageConfig,
      qualifierIds,
      adminUserId,
    );
  }

  /**
   * Finalize a round: compute standings, write qualifiers, mark COMPLETED, create next round.
   * Idempotent: if round is already COMPLETED, returns existing result.
   */
  async finalizeRound(tournamentId: string, roundId: string, adminUserId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: { id: roundId },
      include: {
        groups: { include: { groupTeams: true } },
        qualifications: true,
      },
    });

    if (!round || round.tournamentId !== tournamentId) {
      throw new NotFoundException(`Round ${roundId} not found`);
    }

    // Idempotency check
    if (round.status === RoundStatus.COMPLETED) {
      return { message: `Round ${round.roundNumber} already finalized.`, status: 'ALREADY_DONE' };
    }

    if (!round.isFinal && !round.qualifiersPerGroup) {
      throw new BadRequestException('This round has no qualifiersPerGroup configured.');
    }

    // Check for existing qualifications (idempotency)
    if (round.qualifications.length > 0) {
      throw new BadRequestException(
        'Qualifications have already been written for this round. Idempotency guard: cannot finalize twice.',
      );
    }

    const Q = round.qualifiersPerGroup ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const nextRoundQualifiers: string[] = [];

      for (const group of round.groups) {
        const sorted = [...group.groupTeams].sort((a, b) => {
          if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
          if (b.kills !== a.kills) return b.kills - a.kills;
          return b.placementPoints - a.placementPoints;
        });

        // Write ranks
        for (let i = 0; i < sorted.length; i++) {
          await tx.tournamentGroupTeam.update({
            where: { groupId_tournamentTeamId: { groupId: group.id, tournamentTeamId: sorted[i].tournamentTeamId } },
            data: { rank: i + 1 },
          });
        }

        const qualifiers = sorted.slice(0, Q);
        const eliminated = sorted.slice(Q);

        for (const team of qualifiers) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: team.tournamentTeamId,
              destination: round.isFinal ? QualificationDestination.GRAND_FINAL : QualificationDestination.ROUND_2,
              // Note: destination ROUND_2 is a placeholder; the generic service
              // reads "all non-ELIMINATED qualifications" for the next stage
            },
          });
          nextRoundQualifiers.push(team.tournamentTeamId);
        }

        for (const team of eliminated) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: team.tournamentTeamId,
              destination: QualificationDestination.ELIMINATED,
            },
          });
        }
      }

      await tx.tournamentRound.update({
        where: { id: roundId },
        data: { status: RoundStatus.COMPLETED, completedAt: new Date() },
      });

      await tx.tournamentAuditLog.create({
        data: {
          tournamentId,
          action: `FINALIZE_ROUND_${round.roundNumber}`,
          details: {
            qualifiersCount: nextRoundQualifiers.length,
            roundId,
          },
          adminUserId,
        },
      });

      return {
        status: 'SUCCESS',
        message: `Round ${round.roundNumber} finalized. ${nextRoundQualifiers.length} qualifiers advanced.`,
        qualifiersCount: nextRoundQualifiers.length,
      };
    });
  }
}
