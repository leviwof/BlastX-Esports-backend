import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TournamentRoundType,
  RoundStatus,
  QualificationDestination,
  WildCardStatus,
  TournamentStatus,
  RegistrationStatus,
} from '@prisma/client';
import {
  SetGroupRoomCredentialsDto,
} from './dto/bracket.dto';

@Injectable()
export class TournamentBracketService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // AUDIT LOG HELPER
  // ==========================================
  private async logAudit(
    tx: any,
    tournamentId: string,
    action: string,
    details: any,
    adminUserId: string,
  ) {
    return tx.tournamentAuditLog.create({
      data: {
        tournamentId,
        action,
        details,
        adminUserId: adminUserId || 'system',
      },
    });
  }

  // ==========================================
  // 1. GENERATE ROUND 1 (96 Teams -> 8 Groups x 12)
  // ==========================================
  async generateRound1(tournamentId: string, adminUserId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        rounds: {
          where: { roundType: TournamentRoundType.ROUND_1 },
          include: { groups: { include: { groupTeams: { include: { tournamentTeam: true } } } } },
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament ${tournamentId} not found`);
    }

    // Idempotency: if already created and live, return it
    if (tournament.rounds.length > 0) {
      const existingRound = tournament.rounds[0];
      if (existingRound.status === RoundStatus.LIVE || existingRound.status === RoundStatus.COMPLETED) {
        return {
          message: 'Round 1 has already been generated',
          round: existingRound,
        };
      }
    }

    // Fetch confirmed registrations
    const confirmedRegistrations = await this.prisma.tournamentRegistration.findMany({
      where: {
        tournamentId,
        status: RegistrationStatus.CONFIRMED,
        teamId: { not: null },
      },
      include: {
        team: true,
      },
      orderBy: { slotNumber: 'asc' },
    });

    const teamIds = Array.from(
      new Set(confirmedRegistrations.map((r) => r.teamId).filter((id): id is string => id !== null)),
    );

    if (teamIds.length < 96) {
      throw new BadRequestException(
        `Round 1 generation requires exactly 96 confirmed teams. Currently confirmed: ${teamIds.length}`,
      );
    }

    // Pick 96 teams (in case there are more) and shuffle
    const selectedTeamIds = teamIds.slice(0, 96);
    const shuffledTeams = [...selectedTeamIds].sort(() => Math.random() - 0.5);

    return this.prisma.$transaction(async (tx) => {
      // Create or update TournamentRound for Round 1
      const round = await tx.tournamentRound.upsert({
        where: {
          tournamentId_roundType: {
            tournamentId,
            roundType: TournamentRoundType.ROUND_1,
          },
        },
        create: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_1,
          roundNumber: 1,
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
        update: {
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
      });

      // Clear any prior groups if regenerating
      await tx.tournamentGroup.deleteMany({
        where: { roundId: round.id },
      });

      const groupNames = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E', 'Group F', 'Group G', 'Group H'];
      const groupsCreated = [];

      for (let gIdx = 0; gIdx < 8; gIdx++) {
        const groupTeamIds = shuffledTeams.slice(gIdx * 12, (gIdx + 1) * 12);
        const group = await tx.tournamentGroup.create({
          data: {
            roundId: round.id,
            groupNumber: gIdx + 1,
            name: groupNames[gIdx],
          },
        });

        // Insert group teams
        for (let tIdx = 0; tIdx < groupTeamIds.length; tIdx++) {
          await tx.tournamentGroupTeam.create({
            data: {
              groupId: group.id,
              tournamentTeamId: groupTeamIds[tIdx],
              seed: tIdx + 1,
              kills: 0,
              placementPoints: 0,
              totalPoints: 0,
            },
          });
        }
        groupsCreated.push(group);
      }

      // Update tournament status to LIVE if needed
      if (tournament.status !== TournamentStatus.LIVE && tournament.status !== TournamentStatus.COMPLETED) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.LIVE },
        });
      }

      await this.logAudit(
        tx,
        tournamentId,
        'GENERATE_ROUND_1',
        { roundId: round.id, totalTeams: 96, groupsCount: 8 },
        adminUserId,
      );

      return tx.tournamentRound.findUnique({
        where: { id: round.id },
        include: {
          groups: {
            include: {
              groupTeams: {
                include: { tournamentTeam: true },
                orderBy: { seed: 'asc' },
              },
            },
          },
        },
      });
    });
  }

  // ==========================================
  // TIE BREAKER EVALUATION HELPER
  // ==========================================
  private evaluateGroupStandings(groupTeams: any[]) {
    // Sort by totalPoints desc, then kills desc, then placementPoints desc
    return [...groupTeams].sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (b.placementPoints !== a.placementPoints) return b.placementPoints - a.placementPoints;
      return 0;
    });
  }

  // ==========================================
  // 2. ADVANCE ROUND 1 (Top 6 to R2, Ranks 7-12 Eliminated)
  // ==========================================
  async advanceRound1(tournamentId: string, adminUserId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_1,
        },
      },
      include: {
        groups: {
          include: {
            groupTeams: { include: { tournamentTeam: true } },
          },
        },
        tieBreakers: true,
      },
    });

    if (!round) {
      throw new NotFoundException(`Round 1 for tournament ${tournamentId} not found`);
    }

    if (round.status === RoundStatus.COMPLETED) {
      return {
        message: 'Round 1 has already been completed and advanced',
        status: RoundStatus.COMPLETED,
      };
    }

    const pendingTieBreakers: any[] = [];
    const groupAdvancements: {
      groupId: string;
      groupName: string;
      top6TeamIds: string[];
      eliminatedTeamIds: string[];
      rankedTeams: any[];
    }[] = [];

    // Check each of the 8 groups
    for (const group of round.groups) {
      if (group.groupTeams.length === 0) {
        throw new BadRequestException(`Group ${group.name} has no teams configured`);
      }

      const sorted = this.evaluateGroupStandings(group.groupTeams);

      // Check tie at rank 6 (index 5) vs rank 7 (index 6)
      const rank6Team = sorted[5];
      const rank7Team = sorted[6];

      if (
        rank6Team &&
        rank7Team &&
        rank6Team.totalPoints === rank7Team.totalPoints &&
        rank6Team.kills === rank7Team.kills &&
        rank6Team.placementPoints === rank7Team.placementPoints
      ) {
        // Potential tie at qualification boundary
        const existingTb = round.tieBreakers.find(
          (tb) => tb.groupId === group.id && tb.isResolved,
        );

        if (!existingTb) {
          // Identify all teams tied with rank 6
          const tiedTeams = sorted.filter(
            (t) =>
              t.totalPoints === rank6Team.totalPoints &&
              t.kills === rank6Team.kills &&
              t.placementPoints === rank6Team.placementPoints,
          );

          // Find recommended team based on highest placement points or seed
          const recommended = [...tiedTeams].sort((a, b) => (b.placementPoints || 0) - (a.placementPoints || 0))[0];

          // Record or retrieve tie breaker
          let tbRecord = round.tieBreakers.find(
            (tb) => tb.groupId === group.id && !tb.isResolved,
          );
          if (!tbRecord) {
            tbRecord = await this.prisma.tournamentTieBreaker.create({
              data: {
                roundId: round.id,
                groupId: group.id,
                tiedTeamIds: tiedTeams.map((t) => t.tournamentTeamId),
                recommendedTeamId: recommended.tournamentTeamId,
                isResolved: false,
              },
            });
          }
          pendingTieBreakers.push(tbRecord);
          continue;
        } else {
          // Move selectedTeam to rank 6 slot if not already
          const selectedIdx = sorted.findIndex(
            (t) => t.tournamentTeamId === existingTb.selectedTeamId,
          );
          if (selectedIdx > 5) {
            const [selectedTeam] = sorted.splice(selectedIdx, 1);
            sorted.splice(5, 0, selectedTeam);
          }
        }
      }

      const top6 = sorted.slice(0, 6);
      const eliminated = sorted.slice(6);

      groupAdvancements.push({
        groupId: group.id,
        groupName: group.name,
        top6TeamIds: top6.map((t) => t.tournamentTeamId),
        eliminatedTeamIds: eliminated.map((t) => t.tournamentTeamId),
        rankedTeams: sorted,
      });
    }

    if (pendingTieBreakers.length > 0) {
      await this.prisma.tournamentRound.update({
        where: { id: round.id },
        data: { status: RoundStatus.TIE_BREAKER_PENDING },
      });
      return {
        status: RoundStatus.TIE_BREAKER_PENDING,
        needsAdminTieResolution: true,
        message: 'Round advancement paused due to ties at Rank 6 cutoff. Admin resolution required.',
        pendingTieBreakers,
      };
    }

    // All 8 groups are clean! Execute qualification & generate Round 2
    return this.prisma.$transaction(async (tx) => {
      const qualifiedForR2: { teamId: string; groupIndex: number; rank: number }[] = [];

      for (let gIdx = 0; gIdx < groupAdvancements.length; gIdx++) {
        const ga = groupAdvancements[gIdx];

        // Update rank in TournamentGroupTeam
        for (let rIdx = 0; rIdx < ga.rankedTeams.length; rIdx++) {
          const t = ga.rankedTeams[rIdx];
          await tx.tournamentGroupTeam.update({
            where: {
              groupId_tournamentTeamId: {
                groupId: ga.groupId,
                tournamentTeamId: t.tournamentTeamId,
              },
            },
            data: { rank: rIdx + 1 },
          });
        }

        // Record qualifications
        for (let idx = 0; idx < ga.top6TeamIds.length; idx++) {
          const teamId = ga.top6TeamIds[idx];
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.ROUND_2,
            },
          });
          qualifiedForR2.push({ teamId, groupIndex: gIdx, rank: idx + 1 });
        }

        for (const teamId of ga.eliminatedTeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.ELIMINATED,
            },
          });
        }
      }

      // Mark Round 1 as COMPLETED
      await tx.tournamentRound.update({
        where: { id: round.id },
        data: {
          status: RoundStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      // Generate Round 2 (4 Groups x 12 Teams) using snake/balanced seeding
      const round2 = await tx.tournamentRound.upsert({
        where: {
          tournamentId_roundType: {
            tournamentId,
            roundType: TournamentRoundType.ROUND_2,
          },
        },
        create: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_2,
          roundNumber: 2,
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
        update: {
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
      });

      await tx.tournamentGroup.deleteMany({
        where: { roundId: round2.id },
      });

      const r2GroupNames = ['Group A', 'Group B', 'Group C', 'Group D'];
      const r2Groups = [];
      for (let i = 0; i < 4; i++) {
        const g = await tx.tournamentGroup.create({
          data: {
            roundId: round2.id,
            groupNumber: i + 1,
            name: r2GroupNames[i],
          },
        });
        r2Groups.push(g);
      }

      // Snake distribute teams across 4 groups by rank:
      // rank 1s (8 teams) -> 2 each in groups 0..3
      // rank 2s (8 teams) -> 2 each in groups 3..0, etc.
      for (let rank = 1; rank <= 6; rank++) {
        const teamsAtRank = qualifiedForR2
          .filter((q) => q.rank === rank)
          .map((q) => q.teamId);

        const isReversed = rank % 2 === 0;
        const groupOrder = isReversed ? [3, 2, 1, 0, 3, 2, 1, 0] : [0, 1, 2, 3, 0, 1, 2, 3];

        for (let i = 0; i < teamsAtRank.length; i++) {
          const targetGroup = r2Groups[groupOrder[i % 8]];
          await tx.tournamentGroupTeam.create({
            data: {
              groupId: targetGroup.id,
              tournamentTeamId: teamsAtRank[i],
              seed: rank,
              kills: 0,
              placementPoints: 0,
              totalPoints: 0,
            },
          });
        }
      }

      await this.logAudit(
        tx,
        tournamentId,
        'ADVANCE_ROUND_1',
        {
          qualifiedCount: qualifiedForR2.length,
          round2Id: round2.id,
        },
        adminUserId,
      );

      return {
        status: 'SUCCESS',
        message: 'Round 1 successfully completed. 48 teams advanced to Round 2 (4 groups created).',
        round2: await tx.tournamentRound.findUnique({
          where: { id: round2.id },
          include: {
            groups: {
              include: {
                groupTeams: {
                  include: { tournamentTeam: true },
                },
              },
            },
          },
        }),
      };
    });
  }

  // ==========================================
  // 3. ADVANCE ROUND 2 (Dual-Exit: Top 2 -> GF, 3-9 -> R3, 10-12 -> Eliminated)
  // ==========================================
  async advanceRound2(tournamentId: string, adminUserId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_2,
        },
      },
      include: {
        groups: {
          include: {
            groupTeams: { include: { tournamentTeam: true } },
          },
        },
        tieBreakers: true,
      },
    });

    if (!round) {
      throw new NotFoundException(`Round 2 for tournament ${tournamentId} not found`);
    }

    if (round.status === RoundStatus.COMPLETED) {
      return {
        message: 'Round 2 has already been completed and advanced',
        status: RoundStatus.COMPLETED,
      };
    }

    const pendingTieBreakers: any[] = [];
    const groupAdvancements: {
      groupId: string;
      groupName: string;
      grandFinalTeamIds: string[];
      round3TeamIds: string[];
      eliminatedTeamIds: string[];
      rankedTeams: any[];
    }[] = [];

    for (const group of round.groups) {
      if (group.groupTeams.length === 0) {
        throw new BadRequestException(`Group ${group.name} has no teams configured`);
      }

      const sorted = this.evaluateGroupStandings(group.groupTeams);

      // Boundary 1: Rank 2 vs Rank 3 (Direct Grand Finalist cutoff)
      const rank2 = sorted[1];
      const rank3 = sorted[2];
      if (
        rank2 &&
        rank3 &&
        rank2.totalPoints === rank3.totalPoints &&
        rank2.kills === rank3.kills &&
        rank2.placementPoints === rank3.placementPoints
      ) {
        const resolved = round.tieBreakers.find(
          (tb) => tb.groupId === group.id && tb.isResolved && (tb.tiedTeamIds.includes(rank2.tournamentTeamId)),
        );
        if (!resolved) {
          const tied = sorted.filter(
            (t) =>
              t.totalPoints === rank2.totalPoints &&
              t.kills === rank2.kills &&
              t.placementPoints === rank2.placementPoints,
          );
          let tbRecord = round.tieBreakers.find(
            (tb) => tb.groupId === group.id && !tb.isResolved,
          );
          if (!tbRecord) {
            tbRecord = await this.prisma.tournamentTieBreaker.create({
              data: {
                roundId: round.id,
                groupId: group.id,
                tiedTeamIds: tied.map((t) => t.tournamentTeamId),
                recommendedTeamId: tied[0].tournamentTeamId,
                isResolved: false,
              },
            });
          }
          pendingTieBreakers.push(tbRecord);
          continue;
        } else {
          const selIdx = sorted.findIndex((t) => t.tournamentTeamId === resolved.selectedTeamId);
          if (selIdx > 1) {
            const [sel] = sorted.splice(selIdx, 1);
            sorted.splice(1, 0, sel);
          }
        }
      }

      // Boundary 2: Rank 9 vs Rank 10 (Round 3 Qualifiers cutoff)
      const rank9 = sorted[8];
      const rank10 = sorted[9];
      if (
        rank9 &&
        rank10 &&
        rank9.totalPoints === rank10.totalPoints &&
        rank9.kills === rank10.kills &&
        rank9.placementPoints === rank10.placementPoints
      ) {
        const resolved = round.tieBreakers.find(
          (tb) => tb.groupId === group.id && tb.isResolved && tb.tiedTeamIds.includes(rank9.tournamentTeamId),
        );
        if (!resolved) {
          const tied = sorted.filter(
            (t) =>
              t.totalPoints === rank9.totalPoints &&
              t.kills === rank9.kills &&
              t.placementPoints === rank9.placementPoints,
          );
          let tbRecord = round.tieBreakers.find(
            (tb) => tb.groupId === group.id && !tb.isResolved,
          );
          if (!tbRecord) {
            tbRecord = await this.prisma.tournamentTieBreaker.create({
              data: {
                roundId: round.id,
                groupId: group.id,
                tiedTeamIds: tied.map((t) => t.tournamentTeamId),
                recommendedTeamId: tied[0].tournamentTeamId,
                isResolved: false,
              },
            });
          }
          pendingTieBreakers.push(tbRecord);
          continue;
        } else {
          const selIdx = sorted.findIndex((t) => t.tournamentTeamId === resolved.selectedTeamId);
          if (selIdx > 8) {
            const [sel] = sorted.splice(selIdx, 1);
            sorted.splice(8, 0, sel);
          }
        }
      }

      const top2 = sorted.slice(0, 2);
      const ranks3to9 = sorted.slice(2, 9);
      const ranks10to12 = sorted.slice(9);

      groupAdvancements.push({
        groupId: group.id,
        groupName: group.name,
        grandFinalTeamIds: top2.map((t) => t.tournamentTeamId),
        round3TeamIds: ranks3to9.map((t) => t.tournamentTeamId),
        eliminatedTeamIds: ranks10to12.map((t) => t.tournamentTeamId),
        rankedTeams: sorted,
      });
    }

    if (pendingTieBreakers.length > 0) {
      await this.prisma.tournamentRound.update({
        where: { id: round.id },
        data: { status: RoundStatus.TIE_BREAKER_PENDING },
      });
      return {
        status: RoundStatus.TIE_BREAKER_PENDING,
        needsAdminTieResolution: true,
        message: 'Round 2 advancement paused due to ties. Admin resolution required.',
        pendingTieBreakers,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      let totalGf = 0;
      let totalR3 = 0;
      let totalElim = 0;

      for (const ga of groupAdvancements) {
        for (let rIdx = 0; rIdx < ga.rankedTeams.length; rIdx++) {
          const t = ga.rankedTeams[rIdx];
          await tx.tournamentGroupTeam.update({
            where: {
              groupId_tournamentTeamId: {
                groupId: ga.groupId,
                tournamentTeamId: t.tournamentTeamId,
              },
            },
            data: { rank: rIdx + 1 },
          });
        }

        // Top 2 to Grand Final (Total: 4 * 2 = 8)
        for (const teamId of ga.grandFinalTeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.GRAND_FINAL,
            },
          });
          totalGf++;
        }

        // Ranks 3 to 9 to Round 3 (Total: 4 * 7 = 28)
        for (const teamId of ga.round3TeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.ROUND_3,
            },
          });
          totalR3++;
        }

        // Ranks 10 to 12 eliminated (Total: 4 * 3 = 12)
        for (const teamId of ga.eliminatedTeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.ELIMINATED,
            },
          });
          totalElim++;
        }
      }

      await tx.tournamentRound.update({
        where: { id: round.id },
        data: {
          status: RoundStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'ADVANCE_ROUND_2',
        { grandFinalCount: totalGf, round3Count: totalR3, eliminatedCount: totalElim },
        adminUserId,
      );

      return {
        status: 'SUCCESS',
        message: 'Round 2 completed. 8 teams qualified for Grand Final, 28 teams qualified for Round 3.',
        grandFinalistsCount: totalGf,
        round3QualifiersCount: totalR3,
        eliminatedCount: totalElim,
      };
    });
  }

  // ==========================================
  // 4. WILD CARD LIFECYCLE
  // ==========================================
  async openWildCard(tournamentId: string, entryFee: number = 0, adminUserId: string) {
    const r1 = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_1,
        },
      },
    });

    if (!r1 || r1.status !== RoundStatus.COMPLETED) {
      throw new BadRequestException('Wild Card registration can only be opened AFTER Round 1 is completed.');
    }

    return this.prisma.$transaction(async (tx) => {
      const window = await tx.wildCardWindow.upsert({
        where: { tournamentId },
        create: {
          tournamentId,
          status: WildCardStatus.OPEN,
          entryFee: entryFee || 0,
          maxSlots: 8,
          openedAt: new Date(),
        },
        update: {
          status: WildCardStatus.OPEN,
          entryFee: entryFee || 0,
          openedAt: new Date(),
          closedAt: null,
        },
        include: { slots: true },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'OPEN_WILDCARD',
        { windowId: window.id, entryFee },
        adminUserId,
      );

      return window;
    });
  }

  async closeWildCard(tournamentId: string, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const window = await tx.wildCardWindow.findUnique({
        where: { tournamentId },
      });

      if (!window) {
        throw new NotFoundException(`No Wild Card window found for tournament ${tournamentId}`);
      }

      const updated = await tx.wildCardWindow.update({
        where: { tournamentId },
        data: {
          status: WildCardStatus.LOCKED,
          closedAt: new Date(),
        },
        include: { slots: true },
      });

      await this.logAudit(tx, tournamentId, 'CLOSE_WILDCARD', { windowId: window.id }, adminUserId);

      return updated;
    });
  }

  async getWildCardSlots(tournamentId: string) {
    const window = await this.prisma.wildCardWindow.findUnique({
      where: { tournamentId },
      include: {
        slots: {
          include: { tournamentTeam: true },
          orderBy: { slotNumber: 'asc' },
        },
      },
    });

    if (!window) {
      return {
        status: WildCardStatus.CLOSED,
        maxSlots: 8,
        slots: [],
      };
    }

    return window;
  }

  async adminAssignWildCardSlot(
    tournamentId: string,
    teamId: string,
    slotNumber: number,
    adminUserId: string,
  ) {
    if (slotNumber < 1 || slotNumber > 8) {
      throw new BadRequestException('Slot number must be between 1 and 8');
    }

    // Verify team exists and is part of this tournament
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });
    if (!team) {
      throw new NotFoundException(`Team ${teamId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      let window = await tx.wildCardWindow.findUnique({
        where: { tournamentId },
      });

      if (!window) {
        window = await tx.wildCardWindow.create({
          data: {
            tournamentId,
            status: WildCardStatus.OPEN,
            maxSlots: 8,
          },
        });
      }

      // Upsert slot
      const slot = await tx.wildCardSlot.upsert({
        where: {
          windowId_slotNumber: {
            windowId: window.id,
            slotNumber,
          },
        },
        create: {
          windowId: window.id,
          tournamentTeamId: teamId,
          slotNumber,
          isManualAdminSlot: true,
          assignedByUserId: adminUserId,
          assignedAt: new Date(),
        },
        update: {
          tournamentTeamId: teamId,
          isManualAdminSlot: true,
          assignedByUserId: adminUserId,
          assignedAt: new Date(),
        },
        include: { tournamentTeam: true },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'ASSIGN_WILDCARD_SLOT',
        { slotNumber, teamId, teamName: team.name },
        adminUserId,
      );

      return slot;
    });
  }

  async adminRemoveWildCardSlot(tournamentId: string, slotNumber: number, adminUserId: string) {
    const window = await this.prisma.wildCardWindow.findUnique({
      where: { tournamentId },
    });

    if (!window) {
      throw new NotFoundException(`Wild Card window not found for tournament ${tournamentId}`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.wildCardSlot.deleteMany({
        where: {
          windowId: window.id,
          slotNumber,
        },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'REMOVE_WILDCARD_SLOT',
        { slotNumber },
        adminUserId,
      );

      return {
        success: true,
        message: `Wild card slot ${slotNumber} has been cleared`,
      };
    });
  }

  // ==========================================
  // 5. GENERATE ROUND 3 (28 R2 Qualifiers + 8 Wild Cards = 36 Teams -> 3 Groups x 12)
  // ==========================================
  async generateRound3(tournamentId: string, adminUserId: string) {
    const r2 = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_2,
        },
      },
    });

    if (!r2 || r2.status !== RoundStatus.COMPLETED) {
      throw new BadRequestException('Round 3 generation requires Round 2 to be COMPLETED');
    }

    return this.prisma.$transaction(async (tx) => {
      // Auto-lock Wild Card window if still open
      const window = await tx.wildCardWindow.findUnique({
        where: { tournamentId },
        include: { slots: true },
      });

      if (window && window.status === WildCardStatus.OPEN) {
        await tx.wildCardWindow.update({
          where: { tournamentId },
          data: {
            status: WildCardStatus.LOCKED,
            closedAt: new Date(),
          },
        });
      }

      const wildCardSlots = window?.slots || [];
      if (wildCardSlots.length !== 8) {
        throw new BadRequestException(
          `Wild Card window must have exactly 8 filled slots before generating Round 3. Currently filled: ${wildCardSlots.length}. Admin can use wildcard assignment endpoint to fill remaining slots.`,
        );
      }

      // Fetch 28 qualified teams from Round 2
      const r2Quals = await tx.roundQualification.findMany({
        where: {
          roundId: r2.id,
          destination: QualificationDestination.ROUND_3,
        },
        include: { tournamentTeam: true },
      });

      if (r2Quals.length !== 28) {
        throw new BadRequestException(
          `Expected 28 qualified teams from Round 2, found ${r2Quals.length}`,
        );
      }

      const wildCardTeamIds = wildCardSlots.map((s) => s.tournamentTeamId);
      const r2TeamIds = r2Quals.map((q) => q.tournamentTeamId);

      // Create Round 3
      const round3 = await tx.tournamentRound.upsert({
        where: {
          tournamentId_roundType: {
            tournamentId,
            roundType: TournamentRoundType.ROUND_3,
          },
        },
        create: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_3,
          roundNumber: 3,
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
        update: {
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
      });

      await tx.tournamentGroup.deleteMany({
        where: { roundId: round3.id },
      });

      const r3GroupNames = ['Group A', 'Group B', 'Group C'];
      const r3Groups = [];
      for (let i = 0; i < 3; i++) {
        const g = await tx.tournamentGroup.create({
          data: {
            roundId: round3.id,
            groupNumber: i + 1,
            name: r3GroupNames[i],
          },
        });
        r3Groups.push(g);
      }

      // Distribute 8 Wild Card teams evenly across 3 groups:
      // Group A: 3 Wild Cards
      // Group B: 3 Wild Cards
      // Group C: 2 Wild Cards
      const wcDistribution = [
        wildCardTeamIds.slice(0, 3),
        wildCardTeamIds.slice(3, 6),
        wildCardTeamIds.slice(6, 8),
      ];

      // Distribute 28 Round 2 teams across 3 groups:
      // Group A: 9 teams (Total: 3 + 9 = 12)
      // Group B: 9 teams (Total: 3 + 9 = 12)
      // Group C: 10 teams (Total: 2 + 10 = 12)
      const r2Distribution: string[][] = [[], [], []];
      for (let i = 0; i < r2TeamIds.length; i++) {
        r2Distribution[i % 3].push(r2TeamIds[i]);
      }

      for (let gIdx = 0; gIdx < 3; gIdx++) {
        const group = r3Groups[gIdx];
        const allTeamsForGroup = [...r2Distribution[gIdx], ...wcDistribution[gIdx]];

        for (let sIdx = 0; sIdx < allTeamsForGroup.length; sIdx++) {
          await tx.tournamentGroupTeam.create({
            data: {
              groupId: group.id,
              tournamentTeamId: allTeamsForGroup[sIdx],
              seed: sIdx + 1,
              kills: 0,
              placementPoints: 0,
              totalPoints: 0,
            },
          });
        }
      }

      await this.logAudit(
        tx,
        tournamentId,
        'GENERATE_ROUND_3',
        { round3Id: round3.id, totalTeams: 36, groupsCount: 3 },
        adminUserId,
      );

      return tx.tournamentRound.findUnique({
        where: { id: round3.id },
        include: {
          groups: {
            include: {
              groupTeams: {
                include: { tournamentTeam: true },
              },
            },
          },
        },
      });
    });
  }

  // ==========================================
  // 6. ADVANCE ROUND 3 (Top 3 from 3 Groups = 9 -> Grand Final, Ranks 4-12 Eliminated)
  // ==========================================
  async advanceRound3(tournamentId: string, adminUserId: string) {
    const round = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_3,
        },
      },
      include: {
        groups: {
          include: {
            groupTeams: { include: { tournamentTeam: true } },
          },
        },
        tieBreakers: true,
      },
    });

    if (!round) {
      throw new NotFoundException(`Round 3 for tournament ${tournamentId} not found`);
    }

    if (round.status === RoundStatus.COMPLETED) {
      return {
        message: 'Round 3 has already been completed and advanced',
        status: RoundStatus.COMPLETED,
      };
    }

    const pendingTieBreakers: any[] = [];
    const groupAdvancements: {
      groupId: string;
      groupName: string;
      top3TeamIds: string[];
      eliminatedTeamIds: string[];
      rankedTeams: any[];
    }[] = [];

    for (const group of round.groups) {
      const sorted = this.evaluateGroupStandings(group.groupTeams);

      // Check Rank 3 vs Rank 4 cutoff
      const rank3 = sorted[2];
      const rank4 = sorted[3];

      if (
        rank3 &&
        rank4 &&
        rank3.totalPoints === rank4.totalPoints &&
        rank3.kills === rank4.kills &&
        rank3.placementPoints === rank4.placementPoints
      ) {
        const resolved = round.tieBreakers.find(
          (tb) => tb.groupId === group.id && tb.isResolved,
        );
        if (!resolved) {
          const tied = sorted.filter(
            (t) =>
              t.totalPoints === rank3.totalPoints &&
              t.kills === rank3.kills &&
              t.placementPoints === rank3.placementPoints,
          );
          let tbRecord = round.tieBreakers.find(
            (tb) => tb.groupId === group.id && !tb.isResolved,
          );
          if (!tbRecord) {
            tbRecord = await this.prisma.tournamentTieBreaker.create({
              data: {
                roundId: round.id,
                groupId: group.id,
                tiedTeamIds: tied.map((t) => t.tournamentTeamId),
                recommendedTeamId: tied[0].tournamentTeamId,
                isResolved: false,
              },
            });
          }
          pendingTieBreakers.push(tbRecord);
          continue;
        } else {
          const selIdx = sorted.findIndex((t) => t.tournamentTeamId === resolved.selectedTeamId);
          if (selIdx > 2) {
            const [sel] = sorted.splice(selIdx, 1);
            sorted.splice(2, 0, sel);
          }
        }
      }

      const top3 = sorted.slice(0, 3);
      const eliminated = sorted.slice(3);

      groupAdvancements.push({
        groupId: group.id,
        groupName: group.name,
        top3TeamIds: top3.map((t) => t.tournamentTeamId),
        eliminatedTeamIds: eliminated.map((t) => t.tournamentTeamId),
        rankedTeams: sorted,
      });
    }

    if (pendingTieBreakers.length > 0) {
      await this.prisma.tournamentRound.update({
        where: { id: round.id },
        data: { status: RoundStatus.TIE_BREAKER_PENDING },
      });
      return {
        status: RoundStatus.TIE_BREAKER_PENDING,
        needsAdminTieResolution: true,
        message: 'Round 3 advancement paused due to ties at Rank 3 cutoff. Admin resolution required.',
        pendingTieBreakers,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      let grandFinalCount = 0;
      let eliminatedCount = 0;

      for (const ga of groupAdvancements) {
        for (let rIdx = 0; rIdx < ga.rankedTeams.length; rIdx++) {
          const t = ga.rankedTeams[rIdx];
          await tx.tournamentGroupTeam.update({
            where: {
              groupId_tournamentTeamId: {
                groupId: ga.groupId,
                tournamentTeamId: t.tournamentTeamId,
              },
            },
            data: { rank: rIdx + 1 },
          });
        }

        for (const teamId of ga.top3TeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.GRAND_FINAL,
            },
          });
          grandFinalCount++;
        }

        for (const teamId of ga.eliminatedTeamIds) {
          await tx.roundQualification.create({
            data: {
              roundId: round.id,
              tournamentTeamId: teamId,
              destination: QualificationDestination.ELIMINATED,
            },
          });
          eliminatedCount++;
        }
      }

      await tx.tournamentRound.update({
        where: { id: round.id },
        data: {
          status: RoundStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'ADVANCE_ROUND_3',
        { grandFinalCount, eliminatedCount },
        adminUserId,
      );

      return {
        status: 'SUCCESS',
        message: 'Round 3 completed. 9 teams qualified for the Grand Final.',
        qualifiedGrandFinal: grandFinalCount,
        eliminatedCount,
      };
    });
  }

  // ==========================================
  // 7. ASSEMBLE GRAND FINAL (8 from R2 + 9 from R3 + 1 Special/Admin = 18 Teams)
  // ==========================================
  async assembleGrandFinal(
    tournamentId: string,
    specialInviteTeamId?: string,
    adminUserId: string = 'system',
  ) {
    const rounds = await this.prisma.tournamentRound.findMany({
      where: {
        tournamentId,
        roundType: { in: [TournamentRoundType.ROUND_2, TournamentRoundType.ROUND_3] },
        status: RoundStatus.COMPLETED,
      },
      include: {
        qualifications: {
          where: { destination: QualificationDestination.GRAND_FINAL },
          include: { tournamentTeam: true },
        },
      },
    });

    const r2Round = rounds.find((r) => r.roundType === TournamentRoundType.ROUND_2);
    const r3Round = rounds.find((r) => r.roundType === TournamentRoundType.ROUND_3);

    if (!r2Round || !r3Round) {
      throw new BadRequestException('Grand Final assembly requires both Round 2 and Round 3 to be COMPLETED');
    }

    const r2Finalists = r2Round.qualifications.map((q) => q.tournamentTeamId);
    const r3Finalists = r3Round.qualifications.map((q) => q.tournamentTeamId);

    const finalistTeamIds = new Set<string>([...r2Finalists, ...r3Finalists]);

    // Check manual override qualifications
    const manualQuals = await this.prisma.roundQualification.findMany({
      where: {
        round: { tournamentId },
        destination: QualificationDestination.GRAND_FINAL,
        isManualOverride: true,
      },
    });
    for (const mq of manualQuals) {
      finalistTeamIds.add(mq.tournamentTeamId);
    }

    if (specialInviteTeamId) {
      const inviteTeam = await this.prisma.team.findUnique({
        where: { id: specialInviteTeamId },
      });
      if (!inviteTeam) {
        throw new NotFoundException(`Special invite team ${specialInviteTeamId} not found`);
      }
      finalistTeamIds.add(specialInviteTeamId);
    }

    const allFinalistIds = Array.from(finalistTeamIds);

    if (allFinalistIds.length < 18) {
      return {
        status: 'PENDING_SLOTS',
        currentCount: allFinalistIds.length,
        requiredCount: 18,
        shortageCount: 18 - allFinalistIds.length,
        message: `Grand Final requires exactly 18 teams. Currently have ${allFinalistIds.length}. Admin can use the fill-slot endpoint to fill remaining slots.`,
        currentFinalists: allFinalistIds,
      };
    }

    if (allFinalistIds.length > 18) {
      throw new BadRequestException(
        `Too many teams qualify for Grand Final (${allFinalistIds.length} > 18). Please adjust qualifications.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const gfRound = await tx.tournamentRound.upsert({
        where: {
          tournamentId_roundType: {
            tournamentId,
            roundType: TournamentRoundType.GRAND_FINAL,
          },
        },
        create: {
          tournamentId,
          roundType: TournamentRoundType.GRAND_FINAL,
          roundNumber: 4,
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
        update: {
          status: RoundStatus.LIVE,
          startedAt: new Date(),
        },
      });

      await tx.tournamentGroup.deleteMany({
        where: { roundId: gfRound.id },
      });

      const gfGroup = await tx.tournamentGroup.create({
        data: {
          roundId: gfRound.id,
          groupNumber: 1,
          name: 'Grand Final',
        },
      });

      for (let i = 0; i < allFinalistIds.length; i++) {
        await tx.tournamentGroupTeam.create({
          data: {
            groupId: gfGroup.id,
            tournamentTeamId: allFinalistIds[i],
            seed: i + 1,
            kills: 0,
            placementPoints: 0,
            totalPoints: 0,
          },
        });
      }

      await this.logAudit(
        tx,
        tournamentId,
        'ASSEMBLE_GRAND_FINAL',
        { grandFinalRoundId: gfRound.id, teamsCount: 18 },
        adminUserId,
      );

      return tx.tournamentRound.findUnique({
        where: { id: gfRound.id },
        include: {
          groups: {
            include: {
              groupTeams: {
                include: { tournamentTeam: true },
              },
            },
          },
        },
      });
    });
  }

  // ==========================================
  // 8. GRAND FINAL MANUAL SLOT FILL
  // ==========================================
  async adminFillGrandFinalSlot(
    tournamentId: string,
    teamId: string,
    reason: string = 'Manual Grand Final slot override',
    adminUserId: string,
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
    });
    if (!team) {
      throw new NotFoundException(`Team ${teamId} not found`);
    }

    const r3 = await this.prisma.tournamentRound.findUnique({
      where: {
        tournamentId_roundType: {
          tournamentId,
          roundType: TournamentRoundType.ROUND_3,
        },
      },
    });

    const targetRoundId = r3?.id || (
      await this.prisma.tournamentRound.findFirst({
        where: { tournamentId },
      })
    )?.id;

    if (!targetRoundId) {
      throw new BadRequestException('No rounds found to attach qualification');
    }

    return this.prisma.$transaction(async (tx) => {
      const qual = await tx.roundQualification.create({
        data: {
          roundId: targetRoundId,
          tournamentTeamId: teamId,
          destination: QualificationDestination.GRAND_FINAL,
          isManualOverride: true,
          reason,
          promotedByUserId: adminUserId,
        },
      });

      await this.logAudit(
        tx,
        tournamentId,
        'FILL_GRAND_FINAL_SLOT',
        { teamId, teamName: team.name, reason },
        adminUserId,
      );

      return {
        success: true,
        message: `Team ${team.name} successfully assigned to Grand Final slot`,
        qualification: qual,
      };
    });
  }

  // ==========================================
  // 9. TIE BREAKER RESOLUTION
  // ==========================================
  async getPendingTieBreakers(tournamentId: string) {
    return this.prisma.tournamentTieBreaker.findMany({
      where: {
        round: { tournamentId },
        isResolved: false,
      },
      include: {
        round: true,
      },
    });
  }

  async resolveTieBreaker(
    tournamentId: string,
    tieBreakerId: string,
    selectedTeamId: string,
    adminUserId: string,
  ) {
    const tb = await this.prisma.tournamentTieBreaker.findUnique({
      where: { id: tieBreakerId },
      include: { round: true },
    });

    if (!tb) {
      throw new NotFoundException(`Tie breaker ${tieBreakerId} not found`);
    }

    if (tb.round.tournamentId !== tournamentId) {
      throw new BadRequestException(`Tie breaker does not belong to tournament ${tournamentId}`);
    }

    if (!tb.tiedTeamIds.includes(selectedTeamId)) {
      throw new BadRequestException(
        `Selected team ${selectedTeamId} is not among the tied teams: [${tb.tiedTeamIds.join(', ')}]`,
      );
    }

    const updatedTb = await this.prisma.tournamentTieBreaker.update({
      where: { id: tieBreakerId },
      data: {
        selectedTeamId,
        isResolved: true,
        resolvedByUserId: adminUserId,
        resolvedAt: new Date(),
      },
    });

    await this.logAudit(
      this.prisma,
      tournamentId,
      'RESOLVE_TIE_BREAKER',
      { tieBreakerId, selectedTeamId },
      adminUserId,
    );

    // Auto-resume round advancement if no other tie-breakers pending
    const remainingPending = await this.prisma.tournamentTieBreaker.count({
      where: {
        roundId: tb.roundId,
        isResolved: false,
      },
    });

    let autoAdvancementResult = null;
    if (remainingPending === 0) {
      if (tb.round.roundType === TournamentRoundType.ROUND_1) {
        autoAdvancementResult = await this.advanceRound1(tournamentId, adminUserId);
      } else if (tb.round.roundType === TournamentRoundType.ROUND_2) {
        autoAdvancementResult = await this.advanceRound2(tournamentId, adminUserId);
      } else if (tb.round.roundType === TournamentRoundType.ROUND_3) {
        autoAdvancementResult = await this.advanceRound3(tournamentId, adminUserId);
      }
    }

    return {
      success: true,
      resolvedTieBreaker: updatedTb,
      remainingPendingInRound: remainingPending,
      advancementResult: autoAdvancementResult,
    };
  }

  // ==========================================
  // 10. GROUP ROOM CREDENTIALS & ISOLATION
  // ==========================================
  async updateGroupRoomCredentials(
    tournamentId: string,
    groupId: string,
    dto: SetGroupRoomCredentialsDto,
    adminUserId: string,
  ) {
    const group = await this.prisma.tournamentGroup.findUnique({
      where: { id: groupId },
      include: { round: true },
    });

    if (!group || group.round.tournamentId !== tournamentId) {
      throw new NotFoundException(`Group ${groupId} not found in tournament ${tournamentId}`);
    }

    const releasedAt = dto.releaseNow
      ? new Date()
      : dto.credentialsReleasedAt
      ? new Date(dto.credentialsReleasedAt)
      : new Date();

    const updated = await this.prisma.tournamentGroup.update({
      where: { id: groupId },
      data: {
        roomId: dto.roomId,
        roomPassword: dto.roomPassword,
        credentialsReleasedAt: releasedAt,
      },
    });

    await this.logAudit(
      this.prisma,
      tournamentId,
      'UPDATE_GROUP_ROOM_CREDENTIALS',
      { groupId, groupName: group.name, roomId: dto.roomId },
      adminUserId,
    );

    return updated;
  }

  async getPlayerMatchCredentials(tournamentId: string, userId: string) {
    // Find player's team in this tournament
    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        team: {
          registrations: {
            some: { tournamentId, status: RegistrationStatus.CONFIRMED },
          },
        },
      },
      include: { team: true },
    });

    if (!membership) {
      throw new ForbiddenException('You are not registered in any team for this tournament.');
    }

    const teamId = membership.teamId;

    // Find the latest active group team assignment
    const groupTeam = await this.prisma.tournamentGroupTeam.findFirst({
      where: {
        tournamentTeamId: teamId,
        group: {
          round: {
            tournamentId,
            status: { in: [RoundStatus.LIVE, RoundStatus.SCHEDULED, RoundStatus.TIE_BREAKER_PENDING] },
          },
        },
      },
      include: {
        group: {
          include: { round: true },
        },
      },
      orderBy: { group: { round: { roundNumber: 'desc' } } },
    });

    if (!groupTeam) {
      throw new NotFoundException('No active match or group found for your team in this tournament.');
    }

    const group = groupTeam.group;
    const now = new Date();

    // Check credentials release isolation
    if (!group.credentialsReleasedAt) {
      throw new ForbiddenException('Room credentials have not yet been released for your group.');
    }

    // Allow access if releasedAt <= now
    if (group.credentialsReleasedAt > now) {
      const minutesUntil = Math.round(
        (group.credentialsReleasedAt.getTime() - now.getTime()) / 60000,
      );
      throw new ForbiddenException(
        `Room credentials will be released in ${minutesUntil} minute(s).`,
      );
    }

    return {
      round: group.round.roundType,
      roundNumber: group.round.roundNumber,
      groupName: group.name,
      roomId: group.roomId,
      roomPassword: group.roomPassword,
      credentialsReleasedAt: group.credentialsReleasedAt,
    };
  }
}
