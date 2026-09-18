import { User, GameProfile } from '@prisma/client';

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  profile_pic: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  token?: string;
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

export const toUserResponse = (user: User, token?: string): UserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profile_pic: user.profilePic,
  role: user.role,
  is_active: user.isActive,
  created_at: user.createdAt,
  updated_at: user.updatedAt,
  ...(token ? { token } : {}),
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
