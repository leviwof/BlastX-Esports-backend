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
  owner_role?: string;
  status?: string;
  registration_state?: string;
  roster_version?: number;
  require_join_approval?: boolean;
  pending_join_requests_count?: number;
  invite_code: string;
  code?: string;
  tournament_id?: string | null;
  is_registered?: boolean;
  accepting_substitutes: boolean;
  created_at: Date;
  members?: TeamMemberResponse[];
}

export interface PrivacySafeTeamMember {
  id?: string;
  name: string;
  avatar: string | null;
  role: string;
  roster_type: 'MAIN' | 'SUBSTITUTE';
}

export interface PrivacySafeTeamPreviewResponse {
  id: string;
  name: string;
  tag: string;
  logo_url: string | null;
  tournament_id: string | null;
  responsible_person: {
    name: string;
    role: string;
  };
  main_count: number;
  max_main: number;
  substitute_count: number;
  max_substitutes: number;
  accepting_substitutes: boolean;
  slots_available: number;
  registration_state: string;
  roster_locked: boolean;
  require_join_approval: boolean;
  is_member: boolean;
  my_request_status: 'NONE' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'APPROVED';
  members: PrivacySafeTeamMember[];
}

export const toPrivacySafeTeamPreview = (params: {
  team: Team & {
    captain?: { name: string } | null;
    members?: Array<TeamMember & { user?: { name: string; profilePic?: string | null } }>;
  };
  maxMain?: number;
  maxSub?: number;
  isRegistered?: boolean;
  currentUserId?: string;
  myRequestStatus?: 'NONE' | 'PENDING' | 'REJECTED' | 'CANCELLED' | 'APPROVED';
}): PrivacySafeTeamPreviewResponse => {
  const { team, isRegistered = false, currentUserId, myRequestStatus = 'NONE' } = params;
  const maxMain = params.maxMain ?? 4;
  const maxSub = params.maxSub ?? 1;

  const members = team.members ?? [];
  const mainCount = members.filter((m) => m.role !== 'SUBSTITUTE' && m.role !== 'MANAGER').length;
  const substituteCount = members.filter((m) => m.role === 'SUBSTITUTE').length;
  const acceptingSubstitutes = team.acceptingSubstitutes ?? true;

  const freeMainSlots = Math.max(0, maxMain - mainCount);
  const freeSubSlots = acceptingSubstitutes ? Math.max(0, maxSub - substituteCount) : 0;
  const slotsAvailable = freeMainSlots + freeSubSlots;

  const isRosterLocked =
    (team as any).registrationState === 'CONFIRMED' || isRegistered;

  const isMember = currentUserId
    ? members.some((m) => m.userId === currentUserId)
    : false;

  const responsiblePersonName =
    team.captain?.name ||
    members.find((m) => m.userId === team.captainId)?.user?.name ||
    'Team Leader';

  const role: 'LEADER' | 'MANAGER' =
    team.ownerRole === 'MANAGER' ? 'MANAGER' : 'LEADER';

  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    logo_url: team.logoUrl,
    tournament_id: team.tournamentId,
    responsible_person: {
      name: responsiblePersonName,
      role,
    },
    main_count: mainCount,
    max_main: maxMain,
    substitute_count: substituteCount,
    max_substitutes: maxSub,
    accepting_substitutes: acceptingSubstitutes,
    slots_available: slotsAvailable,
    registration_state: (team as any).registrationState ?? 'FORMING',
    roster_locked: isRosterLocked,
    require_join_approval: (team as any).requireJoinApproval ?? true,
    is_member: isMember,
    my_request_status: myRequestStatus,
    members: members.map((m) => ({
      name: m.user?.name ?? 'Player',
      avatar: m.user?.profilePic ?? null,
      role: m.role,
      roster_type: m.role === 'SUBSTITUTE' ? 'SUBSTITUTE' : 'MAIN',
    })),
  };
};

export interface TeamSummaryResponse {
  id: string;
  name: string;
  tag: string;
  logo_url: string | null;
  game_slug: string;
  owner_role?: string;
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
  owner_role?: string;
  registration_state?: string;
  roster_version?: number;
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
  team: Team & {
    ownerRole?: string;
    members?: (TeamMember & { user?: User & { gameProfiles?: GameProfile[] } })[];
    pendingJoinRequestsCount?: number;
    isOwnerView?: boolean;
  },
  callerUserId?: string | number,
): TeamResponse => {
  const callerIdStr = typeof callerUserId === 'string' ? callerUserId : undefined;
  const mainPlayingMembers = team.members
    ? team.members.filter((m) => m.role !== 'SUBSTITUTE' && m.role !== 'MANAGER')
    : [];
  const status = mainPlayingMembers.length >= 4 ? 'READY' : 'FORMING';
  const isOwner = (callerIdStr && team.captainId === callerIdStr) || (team as any).isOwnerView;
  const pendingCount = (team as any).pendingJoinRequestsCount ?? (team as any)._count?.joinRequests;

  return {
    id: team.id,
    game_id: team.gameId,
    name: team.name,
    tag: team.tag,
    logo_url: team.logoUrl,
    captain_id: team.captainId,
    owner_role: team.ownerRole ?? 'LEADER',
    status,
    registration_state: (team as any).registrationState ?? 'FORMING',
    roster_version: (team as any).rosterVersion ?? 1,
    require_join_approval: (team as any).requireJoinApproval ?? true,
    ...(isOwner ? { pending_join_requests_count: pendingCount ?? 0 } : {}),
    invite_code: team.inviteCode,
    code: team.inviteCode,
    tournament_id: team.tournamentId,
    accepting_substitutes: team.acceptingSubstitutes ?? true,
    created_at: team.createdAt,
    ...(team.members ? { members: team.members.map((member) => toTeamMemberResponse(member, team.gameId)) } : {}),
  };
};

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
  registration_state: (team as any).registrationState ?? 'FORMING',
  roster_version: (team as any).rosterVersion ?? 1,
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
