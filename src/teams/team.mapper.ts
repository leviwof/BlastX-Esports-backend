import { Team, TeamMember, User, GameProfile, Game } from '@prisma/client';

export interface TeamMemberResponse {
  id: string;
  user_id: string;
  name?: string;
  ign?: string | null;
  uid?: string | null;
  role: string;
  roster_type: 'MAIN' | 'SUBSTITUTE';
  joined_at: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    profile_pic: string | null;
    game_profile?: {
      in_game_uid: string;
      in_game_name: string;
    } | null;
  };
}

export interface TeamResponse {
  id: string;
  game_id: string;
  name: string;
  tag: string;
  logo_url: string | null;
  captain_id: string;
  invite_code: string;
  code?: string;
  tournament_id?: string | null;
  is_registered?: boolean;
  accepting_substitutes: boolean;
  created_at: Date;
  members?: TeamMemberResponse[];
}

export interface TeamSummaryResponse {
  id: string;
  name: string;
  tag: string;
  logo_url: string | null;
  game_slug: string;
  captain: {
    id: string;
    name: string;
  };
  member_count: number;
  accepting_substitutes: boolean;
  created_at: Date;
}

export interface TeamDetailMemberResponse {
  id: string;
  user_id: string;
  name: string;
  in_game_name: string | null;
  role: string;
  joined_at: Date;
}

export interface TeamDetailResponse {
  id: string;
  name: string;
  tag: string;
  logo_url: string | null;
  game_slug: string;
  accepting_substitutes: boolean;
  captain: {
    id: string;
    name: string;
  };
  members: TeamDetailMemberResponse[];
  created_at: Date;
}

export const toTeamMemberResponse = (
  member: TeamMember & { user?: User & { gameProfiles?: GameProfile[] } },
  gameId?: string,
): TeamMemberResponse => {
  const profile = gameId
    ? member.user?.gameProfiles?.find((gameProfile) => gameProfile.gameId === gameId)
    : member.user?.gameProfiles?.[0];
  return {
    id: member.id,
    user_id: member.userId,
    role: member.role,
    roster_type: member.role === 'SUBSTITUTE' ? 'SUBSTITUTE' : 'MAIN',
    joined_at: member.joinedAt,
    ...(member.user
      ? {
          name: member.user.name,
          ign: profile?.inGameName ?? null,
          uid: profile?.inGameUid ?? null,
          user: {
            id: member.user.id,
            name: member.user.name,
            email: member.user.email,
            profile_pic: member.user.profilePic,
            game_profile: profile
              ? {
                  in_game_uid: profile.inGameUid,
                  in_game_name: profile.inGameName,
                }
              : null,
          },
        }
      : {}),
  };
};

export const toTeamResponse = (
  team: Team & { members?: (TeamMember & { user?: User & { gameProfiles?: GameProfile[] } })[] },
): TeamResponse => ({
  id: team.id,
  game_id: team.gameId,
  name: team.name,
  tag: team.tag,
  logo_url: team.logoUrl,
  captain_id: team.captainId,
  invite_code: team.inviteCode,
  code: team.inviteCode,
  tournament_id: team.tournamentId,
  accepting_substitutes: team.acceptingSubstitutes ?? true,
  created_at: team.createdAt,
  ...(team.members ? { members: team.members.map((member) => toTeamMemberResponse(member, team.gameId)) } : {}),
});

export const toTeamSummaryResponse = (
  team: Team & {
    game: Pick<Game, 'slug'>;
    captain: Pick<User, 'id' | 'name'>;
    _count?: { members: number };
  },
): TeamSummaryResponse => ({
  id: team.id,
  name: team.name,
  tag: team.tag,
  logo_url: team.logoUrl,
  game_slug: team.game.slug,
  captain: {
    id: team.captain.id,
    name: team.captain.name,
  },
  member_count: team._count?.members ?? 0,
  accepting_substitutes: team.acceptingSubstitutes ?? true,
  created_at: team.createdAt,
});

export const toTeamDetailResponse = (
  team: Team & {
    game: Pick<Game, 'slug'>;
    captain: Pick<User, 'id' | 'name'>;
    members: (TeamMember & {
      user: Pick<User, 'id' | 'name'> & {
        gameProfiles?: Pick<GameProfile, 'gameId' | 'inGameName'>[];
      };
    })[];
  },
): TeamDetailResponse => ({
  id: team.id,
  name: team.name,
  tag: team.tag,
  logo_url: team.logoUrl,
  game_slug: team.game.slug,
  accepting_substitutes: team.acceptingSubstitutes ?? true,
  captain: {
    id: team.captain.id,
    name: team.captain.name,
  },
  members: team.members.map((m) => {
    const gameProfile = m.user.gameProfiles?.find((gp) => gp.gameId === team.gameId);
    return {
      id: m.id,
      user_id: m.userId,
      name: m.user.name,
      in_game_name: gameProfile?.inGameName ?? null,
      role: m.role,
      joined_at: m.joinedAt,
    };
  }),
  created_at: team.createdAt,
});
