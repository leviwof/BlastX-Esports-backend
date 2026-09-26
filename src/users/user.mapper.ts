import { User, GameProfile } from '@prisma/client';

export interface UserGameProfileSummary {
  id: string;
  game_slug: string;
  game_name: string;
  in_game_uid: string;
  in_game_name: string;
}

export interface UserStats {
  tournaments_played: number;
  tournaments_won: number;
  total_kills: number;
  win_rate: string;
  xp: number;
  rank: number;
  game_profile: UserGameProfileSummary | null;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  profile_pic: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at?: Date;
  token?: string;
  tournaments_played: number;
  tournaments_won: number;
  total_kills: number;
  win_rate: string;
  xp: number;
  rank: number;
  game_profile: UserGameProfileSummary | null;
}

export interface GameProfileResponse {
  id: string;
  user_id: string;
  game_id: string;
  game_slug?: string;
  in_game_uid: string;
  in_game_name: string;
  created_at: Date;
  updated_at: Date;
}

export const toUserResponse = (
  user: User,
  token?: string,
  stats?: Partial<UserStats>,
): UserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profile_pic: user.profilePic,
  role: user.role === 'USER' ? 'PLAYER' : user.role,
  is_active: user.isActive,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
  ...(token ? { token } : {}),
  tournaments_played: stats?.tournaments_played ?? 0,
  tournaments_won: stats?.tournaments_won ?? 0,
  total_kills: stats?.total_kills ?? 0,
  win_rate: stats?.win_rate ?? '0.0%',
  xp: stats?.xp ?? ((user as any).xp ?? 0),
  rank: stats?.rank ?? ((user as any).rank ?? 0),
  game_profile: stats?.game_profile ?? null,
});

export const toGameProfileResponse = (profile: GameProfile & { game?: { slug: string } }): GameProfileResponse => ({
  id: profile.id,
  user_id: profile.userId,
  game_id: profile.gameId,
  ...(profile.game?.slug ? { game_slug: profile.game.slug } : {}),
  in_game_uid: profile.inGameUid,
  in_game_name: profile.inGameName,
  created_at: profile.createdAt,
  updated_at: profile.updatedAt,
});
