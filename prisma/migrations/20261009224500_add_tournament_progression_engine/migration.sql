-- CreateEnum
CREATE TYPE "TournamentRoundType" AS ENUM ('ROUND_1', 'ROUND_2', 'ROUND_3', 'GRAND_FINAL');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SCHEDULED', 'LIVE', 'TIE_BREAKER_PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QualificationDestination" AS ENUM ('ROUND_2', 'ROUND_3', 'GRAND_FINAL', 'ELIMINATED');

-- CreateEnum
CREATE TYPE "WildCardStatus" AS ENUM ('CLOSED', 'OPEN', 'LOCKED');

-- AlterTable
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "group_id" TEXT;

-- CreateTable
CREATE TABLE "tournament_rounds" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "round_type" "TournamentRoundType" NOT NULL,
    "round_number" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tournament_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_groups" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "group_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "room_id" TEXT,
    "room_password" TEXT,
    "credentials_released_at" TIMESTAMP(3),

    CONSTRAINT "tournament_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_group_teams" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "tournament_team_id" TEXT NOT NULL,
    "seed" INTEGER,
    "rank" INTEGER,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "placement_points" INTEGER NOT NULL DEFAULT 0,
    "total_points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tournament_group_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_qualifications" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "tournament_team_id" TEXT NOT NULL,
    "destination" "QualificationDestination" NOT NULL,
    "is_manual_override" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "promoted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wild_card_windows" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "status" "WildCardStatus" NOT NULL DEFAULT 'CLOSED',
    "entry_fee" INTEGER NOT NULL DEFAULT 0,
    "max_slots" INTEGER NOT NULL DEFAULT 8,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "wild_card_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wild_card_slots" (
    "id" TEXT NOT NULL,
    "window_id" TEXT NOT NULL,
    "tournament_team_id" TEXT NOT NULL,
    "slot_number" INTEGER NOT NULL,
    "is_manual_admin_slot" BOOLEAN NOT NULL DEFAULT false,
    "assigned_by_user_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wild_card_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_tie_breakers" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "tied_team_ids" TEXT[] NOT NULL,
    "recommended_team_id" TEXT NOT NULL,
    "selected_team_id" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "tournament_tie_breakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_audit_logs" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_rounds_tournament_id_round_type_key" ON "tournament_rounds"("tournament_id", "round_type");

-- CreateIndex
CREATE INDEX "matches_group_id_idx" ON "matches"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_group_teams_group_id_tournament_team_id_key" ON "tournament_group_teams"("group_id", "tournament_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "wild_card_windows_tournament_id_key" ON "wild_card_windows"("tournament_id");

-- CreateIndex
CREATE UNIQUE INDEX "wild_card_slots_window_id_tournament_team_id_key" ON "wild_card_slots"("window_id", "tournament_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "wild_card_slots_window_id_slot_number_key" ON "wild_card_slots"("window_id", "slot_number");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "tournament_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_rounds" ADD CONSTRAINT "tournament_rounds_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_groups" ADD CONSTRAINT "tournament_groups_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "tournament_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_group_teams" ADD CONSTRAINT "tournament_group_teams_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "tournament_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_group_teams" ADD CONSTRAINT "tournament_group_teams_tournament_team_id_fkey" FOREIGN KEY ("tournament_team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_qualifications" ADD CONSTRAINT "round_qualifications_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "tournament_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_qualifications" ADD CONSTRAINT "round_qualifications_tournament_team_id_fkey" FOREIGN KEY ("tournament_team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wild_card_windows" ADD CONSTRAINT "wild_card_windows_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wild_card_slots" ADD CONSTRAINT "wild_card_slots_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "wild_card_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wild_card_slots" ADD CONSTRAINT "wild_card_slots_tournament_team_id_fkey" FOREIGN KEY ("tournament_team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_tie_breakers" ADD CONSTRAINT "tournament_tie_breakers_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "tournament_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_audit_logs" ADD CONSTRAINT "tournament_audit_logs_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
