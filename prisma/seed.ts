import { PrismaClient, TournamentFormat, TeamMode, TournamentStatus, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Database...');

  // 1. App Config
  await prisma.appConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      minVersion: '1.0.0',
      latestVersion: '1.0.5',
      isMaintenance: false,
      maintenanceMessage: 'Server is under maintenance. Please try later.',
      updateUrl: 'https://play.google.com/store/apps/details?id=com.blastix.esports',
    },
  });

  // 2. Games
  const game = await prisma.game.upsert({
    where: { slug: 'free_fire' },
    update: { name: 'Free Fire' },
    create: {
      slug: 'free_fire',
      name: 'Free Fire',
    },
  });

  // 3. Admin User
  const admin = await prisma.user.upsert({
    where: { email: 'admin@blastixesports.com' },
    update: { role: UserRole.ADMIN },
    create: {
      name: 'BlastiX Admin',
      email: 'admin@blastixesports.com',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  // 4. Sample Tournaments
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Tournament 1: Solo Battle Royale
  await prisma.tournament.upsert({
    where: { id: 'tourney-ff-solo-01' },
    update: {},
    create: {
      id: 'tourney-ff-solo-01',
      gameId: game.id,
      title: 'Free Fire Solo Daily Showdown',
      description: 'Battle Royale Solo tournament open for all survivors!',
      bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e',
      format: TournamentFormat.BATTLE_ROYALE,
      teamMode: TeamMode.SOLO,
      map: 'BERMUDA',
      maxSlots: 48,
      registeredCount: 0,
      entryFee: 0,
      prizePool: 50000, // 500 INR in paise
      prizeDistribution: [{ rank: 1, amount: 25000 }, { rank: 2, amount: 15000 }, { rank: 3, amount: 10000 }],
      rules: { note: 'No hacking, emulator restricted' },
      registrationOpensAt: new Date(now.getTime() - 3600000),
      registrationClosesAt: tomorrow,
      startsAt: new Date(tomorrow.getTime() + 3600000),
      status: TournamentStatus.REGISTRATION_OPEN,
      createdBy: admin.id,
    },
  });

  // Tournament 2: Squad Battle Royale
  await prisma.tournament.upsert({
    where: { id: 'tourney-ff-squad-01' },
    update: {},
    create: {
      id: 'tourney-ff-squad-01',
      gameId: game.id,
      title: 'Free Fire Squad Championship',
      description: '4v4 Battle Royale Squad championship.',
      bannerUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420',
      format: TournamentFormat.BATTLE_ROYALE,
      teamMode: TeamMode.SQUAD,
      map: 'PURGATORY',
      maxSlots: 12,
      registeredCount: 0,
      entryFee: 0,
      prizePool: 200000, // 2000 INR in paise
      prizeDistribution: [{ rank: 1, amount: 120000 }, { rank: 2, amount: 80000 }],
      rules: { note: 'Squad of 4 players required + 1 optional sub' },
      registrationOpensAt: now,
      registrationClosesAt: nextWeek,
      startsAt: new Date(nextWeek.getTime() + 3600000),
      status: TournamentStatus.UPCOMING,
      createdBy: admin.id,
    },
  });

  console.log('Database Seeding Complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
