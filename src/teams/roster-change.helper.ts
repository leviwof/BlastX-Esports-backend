import { Prisma, TeamRegistrationState, RegistrationSubmissionStatus, RegistrationApprovalStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface RosterBeforeState {
  captainId: string;
  mainUserIds: string[];
}

/**
 * Compares main-member ids and captain_id before and after a mutation.
 * If they differ and the team is not CONFIRMED/WAITLISTED:
 * - bumps team.rosterVersion += 1;
 * - if state is PENDING_PLAYER_APPROVAL or ROSTER_CHANGE_REQUIRED:
 *     marks ACTIVE submission SUPERSEDED,
 *     resets registrationState to FORMING,
 *     writes registration_events row,
 *     emits registration.invalidated to affected approvers and owner.
 * - if state is FORMING:
 *     only bumps team.rosterVersion += 1.
 * Joining/leaving as substitute does NOT bump rosterVersion or invalidate anything.
 */
export async function handleRosterChange(
  tx: Prisma.TransactionClient,
  teamId: string,
  before: RosterBeforeState,
  events?: EventEmitter2,
  actorUserId?: string,
): Promise<{ changed: boolean; newVersion?: number }> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    include: { members: true },
  });

  if (!team || !team.tournamentId) {
    return { changed: false };
  }

  // If already locked in CONFIRMED or WAITLISTED, do not mutate
  if (
    team.registrationState === TeamRegistrationState.CONFIRMED ||
    team.registrationState === TeamRegistrationState.WAITLISTED
  ) {
    return { changed: false };
  }

  const afterMainUserIds = team.members
    .filter((m) => m.role !== 'SUBSTITUTE' && m.role !== 'MANAGER')
    .map((m) => m.userId)
    .sort();
  const afterCaptainId = team.captainId;

  const sortedBeforeMain = [...before.mainUserIds].sort();
  const mainChanged =
    sortedBeforeMain.join(',') !== afterMainUserIds.join(',') ||
    before.captainId !== afterCaptainId;

  if (!mainChanged) {
    return { changed: false };
  }

  const newRosterVersion = team.rosterVersion + 1;

  if (
    team.registrationState === TeamRegistrationState.PENDING_PLAYER_APPROVAL ||
    team.registrationState === TeamRegistrationState.ROSTER_CHANGE_REQUIRED
  ) {
    const activeSubmission = await tx.registrationSubmission.findFirst({
      where: {
        teamId,
        status: RegistrationSubmissionStatus.ACTIVE,
      },
      include: {
        approvals: true,
      },
    });

    let pendingApproverUserIds: string[] = [];

    if (activeSubmission) {
      await tx.registrationSubmission.update({
        where: { id: activeSubmission.id },
        data: {
          status: RegistrationSubmissionStatus.SUPERSEDED,
        },
      });

      pendingApproverUserIds = activeSubmission.approvals
        .filter((a) => a.status === RegistrationApprovalStatus.PENDING)
        .map((a) => a.userId);
    }

    await tx.team.update({
      where: { id: teamId },
      data: {
        rosterVersion: newRosterVersion,
        registrationState: TeamRegistrationState.FORMING,
      },
    });

    await tx.registrationEvent.create({
      data: {
        tournamentId: team.tournamentId,
        teamId,
        submissionId: activeSubmission?.id ?? null,
        actorUserId: actorUserId ?? null,
        eventType: 'ROSTER_CHANGED_SUBMISSION_SUPERSEDED',
        rosterVersion: newRosterVersion,
        details: {
          previousState: team.registrationState,
          beforeMain: sortedBeforeMain,
          afterMain: afterMainUserIds,
          beforeCaptain: before.captainId,
          afterCaptain: afterCaptainId,
        },
      },
    });

    const notifyUserIds = Array.from(
      new Set([...pendingApproverUserIds, team.captainId]),
    );

    if (events && notifyUserIds.length > 0) {
      events.emit('registration.invalidated', {
        userIds: notifyUserIds,
        tournamentId: team.tournamentId,
        teamId,
        teamName: team.name,
      });
    }

    return { changed: true, newVersion: newRosterVersion };
  }

  // If in FORMING state: only bump rosterVersion
  await tx.team.update({
    where: { id: teamId },
    data: {
      rosterVersion: newRosterVersion,
    },
  });

  await tx.registrationEvent.create({
    data: {
      tournamentId: team.tournamentId,
      teamId,
      actorUserId: actorUserId ?? null,
      eventType: 'ROSTER_VERSION_BUMPED',
      rosterVersion: newRosterVersion,
      details: {
        previousState: team.registrationState,
        beforeMain: sortedBeforeMain,
        afterMain: afterMainUserIds,
      },
    },
  });

  return { changed: true, newVersion: newRosterVersion };
}
