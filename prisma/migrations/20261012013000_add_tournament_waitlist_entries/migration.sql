-- CreateEnum
CREATE TYPE "WaitlistEntryStatus" AS ENUM ('WAITING', 'PROMOTED', 'REMOVED', 'INVALID');

-- CreateTable
CREATE TABLE "tournament_waitlist_entries" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "status" "WaitlistEntryStatus" NOT NULL DEFAULT 'WAITING',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "tournament_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_waitlist_entries_tournament_id_team_id_key" ON "tournament_waitlist_entries"("tournament_id", "team_id");

-- CreateIndex
CREATE INDEX "tournament_waitlist_entries_tournament_id_status_created_at_idx" ON "tournament_waitlist_entries"("tournament_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "tournament_waitlist_entries" ADD CONSTRAINT "tournament_waitlist_entries_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_waitlist_entries" ADD CONSTRAINT "tournament_waitlist_entries_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index on CONFIRMED slot numbers (Task 1)
CREATE UNIQUE INDEX "tournament_registrations_tournament_id_slot_number_key" ON "tournament_registrations"("tournament_id", "slot_number") WHERE "status" = 'CONFIRMED';

-- Backfill: every team currently in registration_state WAITLISTED without an entry gets a WAITING entry ordered by created_at (Task 1)
INSERT INTO "tournament_waitlist_entries" ("id", "tournament_id", "team_id", "status", "created_at")
SELECT 'waitlist_' || t."id", t."tournament_id", t."id", 'WAITING'::"WaitlistEntryStatus", t."created_at"
FROM "teams" t
WHERE t."registration_state" = 'WAITLISTED'
  AND t."tournament_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tournament_waitlist_entries" we
    WHERE we."tournament_id" = t."tournament_id" AND we."team_id" = t."id"
  )
ORDER BY t."created_at" ASC;
