import { Tournament, TournamentRegistration, Team, User } from '@prisma/client';

export interface TournamentRegistrationResponse {
  id: string;
  tournament_id: string;
  user_id: string;
  team_id: string | null;
  status: string;
  slot_number: number;
  final_rank: number | null;
  created_at: Date;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  team?: {
    id: string;
    name: string;
    tag: string;
  } | null;
}

export interface TournamentResponse {
  id: string;
  game_id: string;
  game_slug?: string;
  title: string;
  description: string | null;
  banner_url: string | null;
  format: string;
  team_mode: string;
  map: string;
  max_slots: number;
  registered_count: number;
  slots_left: number;
  entry_fee: number;
  prize_pool: number;
  prize_distribution: any;
  rules: any;
  registration_opens_at: Date;
  registration_closes_at: Date;
  starts_at: Date;
  status: string;
  room_id?: string | null;
  room_password?: string | null;
  room_released_at?: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  is_registered?: boolean;
  my_registration?: TournamentRegistrationResponse | null;
}

export interface StageTeam {
  id: string;
  name: string;
  logo_url: string | null;
  points: number;
  kills: number;
  rank: number;
  is_eliminated: boolean;
  is_qualified: boolean;
  is_winner: boolean;
}

export interface TournamentStage {
  stage_id: string;
  stage_name: string;
  stage_number: number;
  is_current: boolean;
  is_completed: boolean;
  teams: StageTeam[];
}

export interface TournamentBracketResponse {
  id: string;
  title: string;
  status: string;
  stages: TournamentStage[];
}

export const toTournamentRegistrationResponse = (
  reg: TournamentRegistration & { user?: User; team?: Team | null },
): TournamentRegistrationResponse => ({
  id: reg.id,
  tournament_id: reg.tournamentId,
  user_id: reg.userId,
  team_id: reg.teamId,
  status: reg.status,
  slot_number: reg.slotNumber,
  final_rank: reg.finalRank,
  created_at: reg.createdAt,
  ...(reg.user ? { user: { id: reg.user.id, name: reg.user.name, email: reg.user.email } } : {}),
  ...(reg.team ? { team: { id: reg.team.id, name: reg.team.name, tag: reg.team.tag } } : { team: null }),
});

export const toTournamentResponse = (
  t: Tournament & { game?: { slug: string }; registrations?: TournamentRegistration[] },
  currentUserId?: string,
  includeRoom: boolean = false,
): TournamentResponse => {
  const slotsLeft = Math.max(0, t.maxSlots - t.registeredCount);

  let isRegistered = false;
  let myRegistration: TournamentRegistrationResponse | null = null;

  if (currentUserId && t.registrations) {
    const found = t.registrations.find((r) => r.userId === currentUserId && r.status === 'CONFIRMED');
    if (found) {
      isRegistered = true;
      myRegistration = toTournamentRegistrationResponse(found);
    }
  }

  return {
    id: t.id,
    game_id: t.gameId,
    ...(t.game?.slug ? { game_slug: t.game.slug } : {}),
    title: t.title,
    description: t.description,
    banner_url: t.bannerUrl,
    format: t.format,
    team_mode: t.teamMode,
    map: t.map,
    max_slots: t.maxSlots,
    registered_count: t.registeredCount,
    slots_left: slotsLeft,
    entry_fee: t.entryFee,
    prize_pool: t.prizePool,
    prize_distribution: t.prizeDistribution,
    rules: t.rules,
    registration_opens_at: t.registrationOpensAt,
    registration_closes_at: t.registrationClosesAt,
    starts_at: t.startsAt,
    status: t.status,
    ...(includeRoom
      ? {
          room_id: t.roomId,
          room_password: t.roomPassword,
          room_released_at: t.roomReleasedAt,
        }
      : {}),
    created_by: t.createdBy,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    ...(currentUserId !== undefined ? { is_registered: isRegistered, my_registration: myRegistration } : {}),
  };
};
