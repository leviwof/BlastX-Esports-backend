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
  game?: string;
  gameLogoUrl?: string | null;
  title: string;
  name?: string;
  description: string | null;
  banner_url: string | null;
  bannerImageUrl?: string | null;
  format: string;
  matchType?: string;
  team_mode: string;
  mode?: string;
  map: string;
  mapName?: string;
  max_slots: number;
  maxSlots?: number;
  registered_count: number;
  registeredCount?: number;
  slots_left: number;
  slotsLeft?: number;
  entry_fee: number;
  entryFee?: number;
  prize_pool: number;
  prizePool?: number;
  currency?: string;
  prize_distribution: any;
  rules: any;
  registration_opens_at: Date;
  registration_closes_at: Date;
  starts_at: Date;
  startsAt?: Date;
  status: string;
  /** YouTube / streaming URL for "Watch Live". Null when no stream is set. */
  stream_url: string | null;
  streamUrl?: string | null;
  viewers_count: number;
  viewersCount?: number;
  organizer: string | null;
  organizer_verified: boolean;
  organizerVerified?: boolean;
  tournamentCode?: string;
  accent_color_hex: string | null;
  accentColorHex?: string | null;
  per_kill_reward: number;
  perKillReward?: number;
  booyah_bonus: number;
  booyahBonus?: number;
  points_system: any;
  pointsSystem?: any;
  schedule: any;
  announcements: any;
  // room_id and room_password are intentionally excluded from the public response
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
  t: Tournament & { game?: { slug: string; name?: string }; registrations?: TournamentRegistration[] },
  currentUserId?: string,
  /**
   * includeRoom is only set to true on the admin endpoint and the
   * authenticated GET /tournaments/:id/room endpoint.
   * The public tournament list and detail endpoints NEVER include room creds.
   */
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

  const stream = (t as any).streamUrl ?? null;
  const viewers = (t as any).viewersCount ?? 0;
  const orgName = (t as any).organizerName || 'BlastX Esports';
  const orgVerified = (t as any).organizerVerified ?? true;
  const accentColor = (t as any).accentColorHex ?? null;
  const perKill = (t as any).perKillReward ?? 0;
  const booyah = (t as any).booyahBonus ?? 0;
  const points = (t as any).pointsSystem ?? null;

  const base: TournamentResponse = {
    id: t.id,
    game_id: t.gameId,
    ...(t.game?.slug ? { game_slug: t.game.slug } : {}),
    game: t.game?.name || 'Free Fire',
    gameLogoUrl: null,
    title: t.title,
    name: t.title,
    description: t.description,
    banner_url: t.bannerUrl,
    bannerImageUrl: t.bannerUrl,
    format: t.format,
    matchType: t.format,
    team_mode: t.teamMode,
    mode: t.teamMode,
    map: t.map,
    mapName: t.map,
    max_slots: t.maxSlots,
    maxSlots: t.maxSlots,
    registered_count: t.registeredCount,
    registeredCount: t.registeredCount,
    slots_left: slotsLeft,
    slotsLeft,
    entry_fee: t.entryFee,
    entryFee: t.entryFee,
    prize_pool: t.prizePool,
    prizePool: t.prizePool,
    currency: '₹',
    prize_distribution: t.prizeDistribution,
    rules: t.rules,
    registration_opens_at: t.registrationOpensAt,
    registration_closes_at: t.registrationClosesAt,
    starts_at: t.startsAt,
    startsAt: t.startsAt,
    status: t.status,
    stream_url: stream,
    streamUrl: stream,
    viewers_count: viewers,
    viewersCount: viewers,
    organizer: orgName,
    organizer_verified: orgVerified,
    organizerVerified: orgVerified,
    tournamentCode: t.id,
    accent_color_hex: accentColor,
    accentColorHex: accentColor,
    per_kill_reward: perKill,
    perKillReward: perKill,
    booyah_bonus: booyah,
    booyahBonus: booyah,
    points_system: points,
    pointsSystem: points,
    schedule: (t as any).schedule ?? null,
    announcements: (t as any).announcements ?? null,
    created_by: t.createdBy,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    ...(currentUserId !== undefined ? { is_registered: isRegistered, my_registration: myRegistration } : {}),
  };

  // Room credentials are only surfaced on the admin path or the dedicated /room endpoint.
  // They must NEVER appear in the public tournament list or detail response.
  if (includeRoom) {
    (base as any).room_id = t.roomId;
    (base as any).room_password = t.roomPassword;
    (base as any).room_released_at = t.roomReleasedAt;
  }

  return base;
};
