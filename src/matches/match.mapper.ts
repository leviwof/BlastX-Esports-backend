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
  match_number: number;
  map: string;
  status: string;
  scheduled_at: Date;
  created_at: Date;
  results?: MatchResultResponse[];
}

export interface LeaderboardEntry {
  rank: number;
  registration_id: string;
  participant_name: string;
  team_name?: string | null;
  team_tag?: string | null;
  total_points: number;
  placement_points: number;
  kill_points: number;
  total_kills: number;
  booyahs: number;
  last_match_placement: number;
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
  m: Match & { results?: (MatchResult & { registration?: TournamentRegistration & { user?: User; team?: Team | null } })[] },
): MatchResponse => ({
  id: m.id,
  tournament_id: m.tournamentId,
  match_number: m.matchNumber,
  map: m.map,
  status: m.status,
  scheduled_at: m.scheduledAt,
  created_at: m.createdAt,
  ...(m.results ? { results: m.results.map(toMatchResultResponse) } : {}),
});
