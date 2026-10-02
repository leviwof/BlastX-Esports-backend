-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "stream_url" TEXT;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "viewers_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "organizer_name" TEXT;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "organizer_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "accent_color_hex" TEXT;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "per_kill_reward" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "booyah_bonus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "points_system" JSONB;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "schedule" JSONB;
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "announcements" JSONB;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "round" TEXT NOT NULL DEFAULT 'Round 1';
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3);
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "stream_url" TEXT;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "winner_team_name" TEXT;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "top_killer_name" TEXT;
