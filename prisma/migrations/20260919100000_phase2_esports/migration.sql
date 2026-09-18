-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TeamMemberRole" AS ENUM ('CAPTAIN', 'PLAYER', 'SUBSTITUTE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TournamentFormat" AS ENUM ('BATTLE_ROYALE', 'CLASH_SQUAD');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TeamMode" AS ENUM ('SOLO', 'DUO', 'SQUAD');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'UPCOMING', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "RegistrationStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'DISQUALIFIED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable games
CREATE TABLE IF NOT EXISTS "games" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "games_slug_key" ON "games"("slug");

-- CreateTable game_profiles
CREATE TABLE IF NOT EXISTS "game_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "in_game_uid" TEXT NOT NULL,
    "in_game_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_profiles_user_id_game_id_key" ON "game_profiles"("user_id", "game_id");
CREATE UNIQUE INDEX IF NOT EXISTS "game_profiles_game_id_in_game_uid_key" ON "game_profiles"("game_id", "in_game_uid");

-- CreateTable teams
CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "logo_url" TEXT,
    "captain_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "teams_invite_code_key" ON "teams"("invite_code");
CREATE UNIQUE INDEX IF NOT EXISTS "teams_game_id_name_key" ON "teams"("game_id", "name");

-- CreateTable team_members
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'PLAYER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_id_user_id_key" ON "team_members"("team_id", "user_id");

-- CreateTable tournaments
CREATE TABLE IF NOT EXISTS "tournaments" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "banner_url" TEXT,
    "format" "TournamentFormat" NOT NULL,
    "team_mode" "TeamMode" NOT NULL,
    "map" TEXT NOT NULL,
    "max_slots" INTEGER NOT NULL,
    "registered_count" INTEGER NOT NULL DEFAULT 0,
    "entry_fee" INTEGER NOT NULL DEFAULT 0,
    "prize_pool" INTEGER NOT NULL DEFAULT 0,
    "prize_distribution" JSONB,
    "rules" JSONB,
    "registration_opens_at" TIMESTAMP(3) NOT NULL,
    "registration_closes_at" TIMESTAMP(3) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "room_id" TEXT,
    "room_password" TEXT,
    "room_released_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tournaments_game_id_status_starts_at_idx" ON "tournaments"("game_id", "status", "starts_at");

-- CreateTable tournament_registrations
CREATE TABLE IF NOT EXISTS "tournament_registrations" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "slot_number" INTEGER NOT NULL,
    "final_rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournament_registrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_registrations_tournament_id_user_id_key" ON "tournament_registrations"("tournament_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tournament_registrations_tournament_id_team_id_key" ON "tournament_registrations"("tournament_id", "team_id");

-- CreateTable matches
CREATE TABLE IF NOT EXISTS "matches" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "match_number" INTEGER NOT NULL,
    "map" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "matches_tournament_id_match_number_key" ON "matches"("tournament_id", "match_number");

-- CreateTable match_results
CREATE TABLE IF NOT EXISTS "match_results" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "placement_points" INTEGER NOT NULL DEFAULT 0,
    "kill_points" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "match_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "match_results_match_id_registration_id_key" ON "match_results"("match_id", "registration_id");

-- AddForeignKeys
ALTER TABLE "game_profiles" DROP CONSTRAINT IF EXISTS "game_profiles_user_id_fkey";
ALTER TABLE "game_profiles" ADD CONSTRAINT "game_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "game_profiles" DROP CONSTRAINT IF EXISTS "game_profiles_game_id_fkey";
ALTER TABLE "game_profiles" ADD CONSTRAINT "game_profiles_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_game_id_fkey";
ALTER TABLE "teams" ADD CONSTRAINT "teams_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_captain_id_fkey";
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_team_id_fkey";
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_user_id_fkey";
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournaments" DROP CONSTRAINT IF EXISTS "tournaments_game_id_fkey";
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tournaments" DROP CONSTRAINT IF EXISTS "tournaments_created_by_fkey";
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tournament_registrations" DROP CONSTRAINT IF EXISTS "tournament_registrations_tournament_id_fkey";
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_registrations" DROP CONSTRAINT IF EXISTS "tournament_registrations_user_id_fkey";
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tournament_registrations" DROP CONSTRAINT IF EXISTS "tournament_registrations_team_id_fkey";
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_tournament_id_fkey";
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_results" DROP CONSTRAINT IF EXISTS "match_results_match_id_fkey";
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "match_results" DROP CONSTRAINT IF EXISTS "match_results_registration_id_fkey";
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "tournament_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
