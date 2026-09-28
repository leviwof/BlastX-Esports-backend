const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function run() {
  console.log('Connecting to database...');
  await prisma.$connect();
  console.log('Connected! Executing DDL statements...');

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
        CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'PROOF_SUBMITTED', 'PROOF_REJECTED', 'COMPLETED', 'CLAIMED');
    EXCEPTION
        WHEN duplicate_object THEN
            ALTER TYPE "ChallengeStatus" ADD VALUE IF NOT EXISTS 'PROOF_REJECTED';
    END $$;
  `);
  console.log('ChallengeStatus enum ensured');

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
        CREATE TYPE "ChallengeType" AS ENUM ('DAILY', 'WEEKLY', 'SPECIAL');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "challenges" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "reward_xp" INTEGER NOT NULL,
        "target_progress" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        "game" TEXT NOT NULL DEFAULT 'Free Fire',
        "type" "ChallengeType" NOT NULL DEFAULT 'DAILY',
        "requires_recording" BOOLEAN NOT NULL DEFAULT true,
        "game_package" TEXT NOT NULL DEFAULT 'com.dts.freefireth',
        "icon_asset" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "user_challenges" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "challenge_id" TEXT NOT NULL,
        "current_progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
        "is_completed" BOOLEAN NOT NULL DEFAULT false,
        "is_claimed" BOOLEAN NOT NULL DEFAULT false,
        "proof_url" TEXT,
        "rejection_reason" TEXT,
        "reviewed_at" TIMESTAMP(3),
        "reviewed_by" TEXT,
        "submitted_at" TIMESTAMP(3),
        "claimed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "user_challenges_pkey" PRIMARY KEY ("id")
    );
  `);

  await prisma.$executeRawUnsafe(`ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "user_challenges" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;`);
  console.log('user_challenges columns updated');

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
        CREATE TYPE "NoticeSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;
  `);
  console.log('NoticeSeverity enum created');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "banners" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "image_url" TEXT NOT NULL,
        "link_url" TEXT,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "starts_at" TIMESTAMP(3),
        "ends_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
    );
  `);
  console.log('banners table created');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "announcements" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "is_published" BOOLEAN NOT NULL DEFAULT true,
        "published_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
    );
  `);
  console.log('announcements table created');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "notices" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "severity" "NoticeSeverity" NOT NULL DEFAULT 'INFO',
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
    );
  `);
  console.log('notices table created');

  await prisma.$disconnect();
  console.log('Done!');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
