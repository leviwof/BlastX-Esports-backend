-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "rank" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ChallengeType" AS ENUM ('DAILY', 'WEEKLY', 'SPECIAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ChallengeStatus" AS ENUM ('ACTIVE', 'PROOF_SUBMITTED', 'COMPLETED', 'CLAIMED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "current_progress" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "is_claimed" BOOLEAN NOT NULL DEFAULT false,
    "proof_url" TEXT,
    "submitted_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "unique_user_challenge" ON "user_challenges"("user_id", "challenge_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "user_challenges" ADD CONSTRAINT "user_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "user_challenges" ADD CONSTRAINT "user_challenges_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
