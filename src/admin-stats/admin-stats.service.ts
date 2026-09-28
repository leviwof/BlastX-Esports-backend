import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TournamentStatus, RegistrationStatus, ChallengeStatus, UserRole } from '@prisma/client';

export interface DashboardStatsResponse {
  users: {
    total: number;
    active: number;
    admins: number;
  };
  tournaments: {
    total: number;
    live: number;
    upcoming: number;
    by_status: Record<string, number>;
  };
  teams: {
    total: number;
  };
  registrations: {
    total: number;
    confirmed: number;
  };
  proofs: {
    pending: number;
  };
  challenges: {
    active: number;
  };
}

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(): Promise<DashboardStatsResponse> {
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      totalTournaments,
      liveTournaments,
      upcomingTournaments,
      tournamentStatusGroups,
      totalTeams,
      totalRegistrations,
      confirmedRegistrations,
      pendingProofs,
      activeChallenges,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
      this.prisma.tournament.count(),
      this.prisma.tournament.count({ where: { status: TournamentStatus.LIVE } }),
      this.prisma.tournament.count({ where: { status: TournamentStatus.UPCOMING } }),
      this.prisma.tournament.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      this.prisma.team.count(),
      this.prisma.tournamentRegistration.count(),
      this.prisma.tournamentRegistration.count({ where: { status: RegistrationStatus.CONFIRMED } }),
      this.prisma.userChallenge.count({ where: { status: ChallengeStatus.PROOF_SUBMITTED } }),
      this.prisma.challenge.count({ where: { isActive: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const status of Object.values(TournamentStatus)) {
      byStatus[status] = 0;
    }
    for (const group of tournamentStatusGroups) {
      byStatus[group.status] = group._count.status;
    }

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
      },
      tournaments: {
        total: totalTournaments,
        live: liveTournaments,
        upcoming: upcomingTournaments,
        by_status: byStatus,
      },
      teams: {
        total: totalTeams,
      },
      registrations: {
        total: totalRegistrations,
        confirmed: confirmedRegistrations,
      },
      proofs: {
        pending: pendingProofs,
      },
      challenges: {
        active: activeChallenges,
      },
    };
  }
}
