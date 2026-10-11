-- CreateEnum
CREATE TYPE "RegistrationSubmissionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegistrationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN "require_player_approval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "registration_submissions" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "roster_version" INTEGER NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "playing_user_ids" TEXT[],
    "status" "RegistrationSubmissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "registration_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_approvals" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "RegistrationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_events" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "actor_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "roster_version" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registration_submissions_team_id_status_idx" ON "registration_submissions"("team_id", "status");

-- CreateIndex
CREATE INDEX "registration_submissions_tournament_id_idx" ON "registration_submissions"("tournament_id");

-- Partial unique index: one ACTIVE submission per team
CREATE UNIQUE INDEX "registration_submissions_team_id_active_key" ON "registration_submissions"("team_id") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "registration_approvals_user_id_status_idx" ON "registration_approvals"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "registration_approvals_submission_id_user_id_key" ON "registration_approvals"("submission_id", "user_id");

-- CreateIndex
CREATE INDEX "registration_events_team_id_created_at_idx" ON "registration_events"("team_id", "created_at");

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_approvals" ADD CONSTRAINT "registration_approvals_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "registration_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_approvals" ADD CONSTRAINT "registration_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
