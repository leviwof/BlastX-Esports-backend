import { Match, MatchResult, TournamentRegistration, Team, User } from '@prisma/client';

export interface MatchResultResponse {
  id: string;
  match_id: string;
  registration_id: string;
  placement: number;
  kills: number;
  placement_points: number;
  kill_points: number;
  total_points: number;
  participant_name?: string;
  team_tag?: string;
}

export interface MatchResponse {
  id: string;
  tournament_id: string;
  round: string;
  group_name: string | null;
  group: string | null;
  match_number: number;
  map: string;
  status: string; // 'upcoming' | 'live' | 'completed'
  starts_at: string;
  scheduled_at: Date;
  ended_at: string | null;
  winner_team_name: string | null;
  top_killer_name: string | null;
  stream_url: string | null;
  room_id: string | null;
  room_password: string | null;
  password: string | null;
  is_room_released: boolean;
  created_at: Date;
  results?: MatchResultResponse[];
}

export interface LeaderboardEntry {
  rank: number;
  prev_rank?: number | null;
  team_id?: string;
  registration_id: string;
  participant_name: string;
  team_name?: string | null;
  logo_url?: string | null;
  kills?: number;
  placement_points: number;
  total_points: number;
  status?: 'active' | 'eliminated' | 'qualified';
  team_tag?: string | null;
  kill_points?: number;
  total_kills?: number;
  booyahs?: number;
  last_match_placement?: number;
}

export interface LeaderboardResponse {
  tournament_id: string;
  updated_at: string;
  round: string;
  entries: LeaderboardEntry[];
}

export const toMatchResultResponse = (
  res: MatchResult & { registration?: TournamentRegistration & { user?: User; team?: Team | null } },
): MatchResultResponse => ({
  id: res.id,
  match_id: res.matchId,
  registration_id: res.registrationId,
  placement: res.placement,
  kills: res.kills,
  placement_points: res.placementPoints,
  kill_points: res.killPoints,
  total_points: res.totalPoints,
  participant_name: res.registration?.team ? res.registration.team.name : res.registration?.user?.name,
  team_tag: res.registration?.team?.tag,
});

export const toMatchResponse = (
  m: Match & {
    round?: string;
    groupName?: string | null;
    roomId?: string | null;
    roomPassword?: string | null;
    roomReleasedAt?: Date | null;
    endedAt?: Date | null;
    streamUrl?: string | null;
    winnerTeamName?: string | null;
    topKillerName?: string | null;
    tournament?: { roomId?: string | null; roomPassword?: string | null; roomReleasedAt?: Date | null };
    results?: (MatchResult & { registration?: TournamentRegistration & { user?: User; team?: Team | null } })[];
  },
): MatchResponse => {
  let statusStr = 'upcoming';
  const rawStatus = (m.status || '').toUpperCase();
  if (rawStatus === 'LIVE') statusStr = 'live';
  else if (rawStatus === 'COMPLETED') statusStr = 'completed';

  let winnerTeamName = (m as any).winnerTeamName ?? null;
  let topKillerName = (m as any).topKillerName ?? null;

  if (statusStr === 'completed' && m.results && m.results.length > 0) {
    if (!winnerTeamName) {
      const winner = m.results.find((r) => r.placement === 1);
      if (winner?.registration) {
        winnerTeamName = winner.registration.team?.name || winner.registration.user?.name || null;
      }
    }
    if (!topKillerName) {
      const sortedByKills = [...m.results].sort((a, b) => b.kills - a.kills);
      const topKiller = sortedByKills[0];
      if (topKiller && topKiller.kills > 0 && topKiller.registration) {
        topKillerName = topKiller.registration.user?.name || topKiller.registration.team?.name || null;
      }
    }
  }

  const groupName = m.groupName || (m as any).group || null;
  const roomId = m.roomId || m.tournament?.roomId || null;
  const roomPassword = m.roomPassword || m.tournament?.roomPassword || null;
  const roomReleasedAt = m.roomReleasedAt || m.tournament?.roomReleasedAt;
  const now = new Date();
  const isRoomReleased = roomReleasedAt ? new Date(roomReleasedAt) <= now : true;

  return {
    id: m.id,
    tournament_id: m.tournamentId,
    round: (m as any).round || `Round ${m.matchNumber}`,
    group_name: groupName,
    group: groupName,
    match_number: m.matchNumber,
    map: m.map,
    status: statusStr,
    starts_at: m.scheduledAt ? m.scheduledAt.toISOString() : new Date().toISOString(),
    scheduled_at: m.scheduledAt,
    ended_at: (m as any).endedAt ? (m as any).endedAt.toISOString() : null,
    winner_team_name: winnerTeamName,
    top_killer_name: topKillerName,
    stream_url: (m as any).streamUrl ?? null,
    room_id: isRoomReleased ? roomId : null,
    room_password: isRoomReleased ? roomPassword : null,
    password: isRoomReleased ? roomPassword : null,
    is_room_released: isRoomReleased,
    created_at: m.createdAt,
    ...(m.results ? { results: m.results.map(toMatchResultResponse) } : {}),
  };
};
