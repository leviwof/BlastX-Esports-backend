require('dotenv').config();
const { PrismaClient, UserRole, TournamentStatus } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanDatabase(dryRun = true, deleteCancelledOnly = true) {
  console.log(`\n======================================================`);
  console.log(`  BLASTIX DATABASE CLEANUP SCRIPT`);
  console.log(`  Mode: ${dryRun ? '🔍 DRY RUN (Preview only)' : '⚠️ EXECUTE (Permanent Deletion)'}`);
  console.log(`======================================================\n`);

  // 1. Find admin users to preserve
  const adminUsers = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true, email: true, name: true, role: true },
  });
  const adminIds = adminUsers.map((u) => u.id);

  console.log(`🛡️  Admin Accounts to KEEP (${adminUsers.length}):`);
  adminUsers.forEach((u) => console.log(`   - ${u.email} (${u.name}, ID: ${u.id})`));

  // 2. Find non-admin users to delete
  const nonAdminUsers = await prisma.user.findMany({
    where: { role: { not: UserRole.ADMIN } },
    select: { id: true, email: true, name: true },
  });
  const nonAdminUserIds = nonAdminUsers.map((u) => u.id);

  console.log(`\n🗑️  Non-Admin Users to DELETE (${nonAdminUsers.length}):`);
  nonAdminUsers.forEach((u) => console.log(`   - ${u.email} (${u.name})`));

  // 3. Tournaments
  const allTournaments = await prisma.tournament.findMany({
    select: { id: true, title: true, status: true },
  });

  const tournamentsToDelete = deleteCancelledOnly
    ? allTournaments.filter((t) => t.status === TournamentStatus.CANCELLED)
    : allTournaments;

  const tournamentsToKeep = allTournaments.filter(
    (t) => !tournamentsToDelete.some((del) => del.id === t.id)
  );

  console.log(`\n🏆 Tournaments:`);
  console.log(`   - Total tournaments: ${allTournaments.length}`);
  console.log(`   - Tournaments to DELETE (${tournamentsToDelete.length}):`);
  tournamentsToDelete.forEach((t) => console.log(`     * [${t.status}] ${t.title} (${t.id})`));
  console.log(`   - Tournaments to KEEP (${tournamentsToKeep.length}):`);
  tournamentsToKeep.forEach((t) => console.log(`     * [${t.status}] ${t.title} (${t.id})`));

  if (dryRun) {
    console.log(`\n======================================================`);
    console.log(`✅ DRY RUN COMPLETE. No data was deleted.`);
    console.log(`To execute deletion, run: node scripts/clean-database.js --execute`);
    console.log(`======================================================\n`);
    return;
  }

  console.log(`\n⏳ Executing deletion in safe cascade order...`);

  // Step A: Delete tournaments marked for deletion (using cascade transaction)
  for (const t of tournamentsToDelete) {
    const tournamentId = t.id;
    console.log(`   Deleting tournament: ${t.title} (${tournamentId})...`);

    // Delete match results
    const matches = await prisma.match.findMany({ where: { tournamentId }, select: { id: true } });
    const matchIds = matches.map((m) => m.id);
    if (matchIds.length > 0) {
      await prisma.matchResult.deleteMany({ where: { matchId: { in: matchIds } } });
    }

    await prisma.matchRecording.deleteMany({ where: { tournamentId } });
    await prisma.match.deleteMany({ where: { tournamentId } });
    await prisma.tournamentFormatPlan.deleteMany({ where: { tournamentId } });

    const rounds = await prisma.tournamentRound.findMany({ where: { tournamentId }, select: { id: true } });
    const roundIds = rounds.map((r) => r.id);
    if (roundIds.length > 0) {
      await prisma.tournamentTieBreaker.deleteMany({ where: { roundId: { in: roundIds } } });
      await prisma.roundQualification.deleteMany({ where: { roundId: { in: roundIds } } });
      const groups = await prisma.tournamentGroup.findMany({ where: { roundId: { in: roundIds } }, select: { id: true } });
      const groupIds = groups.map((g) => g.id);
      if (groupIds.length > 0) {
        await prisma.tournamentGroupTeam.deleteMany({ where: { groupId: { in: groupIds } } });
        await prisma.tournamentGroup.deleteMany({ where: { id: { in: groupIds } } });
      }
      await prisma.tournamentRound.deleteMany({ where: { id: { in: roundIds } } });
    }

    const wildcards = await prisma.wildCardWindow.findMany({ where: { tournamentId }, select: { id: true } });
    const wcIds = wildcards.map((w) => w.id);
    if (wcIds.length > 0) {
      await prisma.wildCardSlot.deleteMany({ where: { windowId: { in: wcIds } } });
      await prisma.wildCardWindow.deleteMany({ where: { tournamentId } });
    }

    const submissions = await prisma.registrationSubmission.findMany({ where: { tournamentId }, select: { id: true } });
    const subIds = submissions.map((s) => s.id);
    if (subIds.length > 0) {
      await prisma.registrationApproval.deleteMany({ where: { submissionId: { in: subIds } } });
      await prisma.registrationSubmission.deleteMany({ where: { tournamentId } });
    }
    await prisma.registrationEvent.deleteMany({ where: { tournamentId } });

    await prisma.tournamentWaitlistEntry.deleteMany({ where: { tournamentId } });
    await prisma.tournamentWaitlist.deleteMany({ where: { tournamentId } });
    await prisma.tournamentInvitation.deleteMany({ where: { tournamentId } });
    await prisma.tournamentRegistration.deleteMany({ where: { tournamentId } });

    const tTeams = await prisma.team.findMany({ where: { tournamentId }, select: { id: true } });
    const tTeamIds = tTeams.map((tm) => tm.id);
    if (tTeamIds.length > 0) {
      await prisma.teamMember.deleteMany({ where: { teamId: { in: tTeamIds } } });
      await prisma.teamJoinRequest.deleteMany({ where: { teamId: { in: tTeamIds } } });
      await prisma.team.deleteMany({ where: { id: { in: tTeamIds } } });
    }

    await prisma.tournamentAuditLog.deleteMany({ where: { tournamentId } });
    await prisma.tournament.delete({ where: { id: tournamentId } });
  }

  // Step B: Delete all user-specific data for non-admin users
  console.log(`   Deleting non-admin user data...`);
  await prisma.userChallenge.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.deviceToken.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.issueReport.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.supportTicket.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.tournamentWaitlistEntry.deleteMany({ where: { team: { captainId: { in: nonAdminUserIds } } } });
  await prisma.tournamentRegistration.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.tournamentInvitation.deleteMany({
    where: { OR: [{ inviteeUserId: { in: nonAdminUserIds } }, { leaderId: { in: nonAdminUserIds } }] },
  });
  await prisma.registrationApproval.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.teamMember.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.teamJoinRequest.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.team.deleteMany({ where: { captainId: { in: nonAdminUserIds } } });
  await prisma.squadMember.deleteMany({ where: { userId: { in: nonAdminUserIds } } });
  await prisma.squad.deleteMany({ where: { leaderId: { in: nonAdminUserIds } } });
  await prisma.gameProfile.deleteMany({ where: { userId: { in: nonAdminUserIds } } });

  // Step C: Delete non-admin users themselves
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { in: nonAdminUserIds } },
  });
  console.log(`   Deleted ${deletedUsers.count} non-admin users.`);

  console.log(`\n======================================================`);
  console.log(`🎉 DATABASE CLEANUP COMPLETED SUCCESSFULLY!`);
  console.log(`======================================================\n`);
}

const isExecute = process.argv.includes('--execute');
const deleteAllTourneys = process.argv.includes('--all-tournaments');

cleanDatabase(!isExecute, !deleteAllTourneys)
  .catch((err) => {
    console.error('Error during cleanup:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
