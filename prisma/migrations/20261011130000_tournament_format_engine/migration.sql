-- AlterEnum
ALTER TYPE "TournamentRoundType" ADD VALUE IF NOT EXISTS 'ROUND_4';
ALTER TYPE "TournamentRoundType" ADD VALUE IF NOT EXISTS 'ROUND_5';
ALTER TYPE "TournamentRoundType" ADD VALUE IF NOT EXISTS 'CLASH_ROUND';

-- AlterEnum
ALTER TYPE "QualificationDestination" ADD VALUE IF NOT EXISTS 'ROUND_4';
ALTER TYPE "QualificationDestination" ADD VALUE IF NOT EXISTS 'ROUND_5';

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "registration_unit_count" INTEGER;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "max_rounds" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "exact_rounds" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "format_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "locked_capacity" INTEGER;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "format_config" JSONB;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "is_format_locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tournament_rounds" ADD COLUMN IF NOT EXISTS "lobby_units" INTEGER;
ALTER TABLE "tournament_rounds" ADD COLUMN IF NOT EXISTS "group_count" INTEGER;
ALTER TABLE "tournament_rounds" ADD COLUMN IF NOT EXISTS "qualifiers_per_group" INTEGER;
ALTER TABLE "tournament_rounds" ADD COLUMN IF NOT EXISTS "matches_per_group" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tournament_rounds" ADD COLUMN IF NOT EXISTS "is_final" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "verified_by" TEXT;
ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "verification_status" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE IF NOT EXISTS "tournament_format_plans" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_format_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_format_plans_tournament_id_key" ON "tournament_format_plans"("tournament_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tournament_format_plans_tournament_id_fkey'
    ) THEN
        ALTER TABLE "tournament_format_plans" ADD CONSTRAINT "tournament_format_plans_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
