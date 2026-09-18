import { Team, TeamMember, User } from '@prisma/client';

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
  created_at: Date;
  members?: TeamMemberResponse[];
}

export const toTeamMemberResponse = (member: TeamMember & { user?: User }): TeamMemberResponse => ({
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
        },
      }
    : {}),
});

export const toTeamResponse = (team: Team & { members?: (TeamMember & { user?: User })[] }): TeamResponse => ({
  id: team.id,
  game_id: team.gameId,
  name: team.name,
  tag: team.tag,
  logo_url: team.logoUrl,
  captain_id: team.captainId,
  invite_code: team.inviteCode,
  created_at: team.createdAt,
  ...(team.members ? { members: team.members.map(toTeamMemberResponse) } : {}),
});
