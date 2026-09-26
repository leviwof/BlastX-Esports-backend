import { Challenge, UserChallenge } from '@prisma/client';

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
