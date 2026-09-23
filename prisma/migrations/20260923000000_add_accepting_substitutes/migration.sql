-- AlterTable
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "accepting_substitutes" BOOLEAN NOT NULL DEFAULT true;
