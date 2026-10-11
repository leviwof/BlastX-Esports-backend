-- CreateEnum
CREATE TYPE "TeamJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "teams" ADD COLUMN "require_join_approval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "team_join_requests" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_as_substitute" BOOLEAN NOT NULL DEFAULT false,
    "status" "TeamJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "team_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_join_requests_team_id_status_idx" ON "team_join_requests"("team_id", "status");

-- CreateIndex
CREATE INDEX "team_join_requests_user_id_status_idx" ON "team_join_requests"("user_id", "status");

-- Partial unique index: only one PENDING request per (team_id, user_id)
CREATE UNIQUE INDEX "team_join_requests_team_id_user_id_pending_key" ON "team_join_requests"("team_id", "user_id") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
