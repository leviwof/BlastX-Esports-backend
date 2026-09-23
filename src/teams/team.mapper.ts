import { Team, TeamMember, User, GameProfile } from '@prisma/client';

export interface TeamMemberResponse {
  id: string;
  user_id: string;
  role: string;
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
  accepting_substitutes: boolean;
  created_at: Date;
  members?: TeamMemberResponse[];
}

export const toTeamMemberResponse = (
  member: TeamMember & { user?: User & { gameProfiles?: GameProfile[] } },
): TeamMemberResponse => {
  const profile = member.user?.gameProfiles?.[0];
  return {
    id: member.id,
    user_id: member.userId,
    role: member.role,
    joined_at: member.joinedAt,
    ...(member.user
      ? {
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
  accepting_substitutes: team.acceptingSubstitutes ?? true,
  created_at: team.createdAt,
  ...(team.members ? { members: team.members.map(toTeamMemberResponse) } : {}),
});
