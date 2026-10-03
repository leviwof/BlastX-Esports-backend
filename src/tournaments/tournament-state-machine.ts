import { TournamentStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

const ALLOWED_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  [TournamentStatus.DRAFT]: [TournamentStatus.UPCOMING, TournamentStatus.LIVE, TournamentStatus.CANCELLED],
  // Upcoming events are countdown/notification-only. Registration opens only
  // when the tournament becomes LIVE.
  [TournamentStatus.UPCOMING]: [TournamentStatus.LIVE, TournamentStatus.CANCELLED],
  // Retain transitions for tournaments that were already in these legacy states.
  [TournamentStatus.REGISTRATION_OPEN]: [TournamentStatus.LIVE, TournamentStatus.CANCELLED],
  [TournamentStatus.REGISTRATION_CLOSED]: [TournamentStatus.LIVE, TournamentStatus.CANCELLED],
  [TournamentStatus.LIVE]: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED],
  [TournamentStatus.COMPLETED]: [],
  [TournamentStatus.CANCELLED]: [],
};

export function validateStatusTransition(currentStatus: TournamentStatus, newStatus: TournamentStatus): void {
  if (currentStatus === newStatus) return;

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(newStatus)) {
    throw new BadRequestException(
      `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowed.join(', ') || 'none'}`,
    );
  }
}
