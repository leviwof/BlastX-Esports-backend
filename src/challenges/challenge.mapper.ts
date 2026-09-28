import { Challenge, UserChallenge, User } from '@prisma/client';

export interface ChallengeResponse {
  id: string;
  title: string;
  description: string;
  reward_xp: number;
  current_progress: number;
  target_progress: number;
  game: string;
  type: string;
  is_completed: boolean;
  is_claimed: boolean;
  requires_recording: boolean;
  game_package: string;
  icon_asset: string;
  status: string;
}

export interface AdminChallengeResponse {
  id: string;
  title: string;
  description: string;
  reward_xp: number;
  target_progress: number;
  game: string;
  type: string;
  requires_recording: boolean;
  game_package: string;
  icon_asset: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface AdminProofResponse {
  id: string;
  proof_url: string | null;
  status: string;
  current_progress: number;
  submitted_at: Date | null;
  rejection_reason?: string | null;
  reviewed_at?: Date | null;
  reviewed_by?: string | null;
  user: {
    id: string;
    name: string;
    email: string;
  };
  challenge: {
    id: string;
    title: string;
    reward_xp: number;
  };
}

export interface SubmitProofResponse {
  status: string;
  message: string;
  challenge_id: string;
  proof_url: string;
}

export const toChallengeResponse = (
  challenge: Challenge,
  userChallenge?: UserChallenge | null,
): ChallengeResponse => {
  const currentProgress = userChallenge?.currentProgress ?? 0.0;
  const isCompleted = userChallenge?.isCompleted ?? (currentProgress >= challenge.targetProgress);
  const isClaimed = userChallenge?.isClaimed ?? false;

  let status: string;
  if (userChallenge?.status) {
    status = userChallenge.status;
  } else if (isClaimed) {
    status = 'CLAIMED';
  } else if (isCompleted) {
    status = 'COMPLETED';
  } else {
    status = 'ACTIVE';
  }

  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    reward_xp: challenge.rewardXp,
    current_progress: currentProgress,
    target_progress: challenge.targetProgress,
    game: challenge.game,
    type: challenge.type,
    is_completed: isCompleted,
    is_claimed: isClaimed,
    requires_recording: challenge.requiresRecording,
    game_package: challenge.gamePackage,
    icon_asset: challenge.iconAsset || 'assets/icons/trophy.png',
    status,
  };
};

export const toAdminChallengeResponse = (challenge: Challenge): AdminChallengeResponse => ({
  id: challenge.id,
  title: challenge.title,
  description: challenge.description,
  reward_xp: challenge.rewardXp,
  target_progress: challenge.targetProgress,
  game: challenge.game,
  type: challenge.type,
  requires_recording: challenge.requiresRecording,
  game_package: challenge.gamePackage,
  icon_asset: challenge.iconAsset,
  is_active: challenge.isActive,
  created_at: challenge.createdAt,
});

export const toAdminProofResponse = (
  userChallenge: UserChallenge & {
    user: Pick<User, 'id' | 'name' | 'email'>;
    challenge: Pick<Challenge, 'id' | 'title' | 'rewardXp'>;
  },
): AdminProofResponse => ({
  id: userChallenge.id,
  proof_url: userChallenge.proofUrl,
  status: userChallenge.status,
  current_progress: userChallenge.currentProgress,
  submitted_at: userChallenge.submittedAt,
  rejection_reason: userChallenge.rejectionReason,
  reviewed_at: userChallenge.reviewedAt,
  reviewed_by: userChallenge.reviewedBy,
  user: {
    id: userChallenge.user.id,
    name: userChallenge.user.name,
    email: userChallenge.user.email,
  },
  challenge: {
    id: userChallenge.challenge.id,
    title: userChallenge.challenge.title,
    reward_xp: userChallenge.challenge.rewardXp,
  },
});
