-- CreateEnum
CREATE TYPE "TeamRegistrationState" AS ENUM ('FORMING', 'PENDING_PLAYER_APPROVAL', 'PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED', 'ROSTER_CHANGE_REQUIRED');

-- AlterTable
ALTER TABLE "teams" ADD COLUMN "registration_state" "TeamRegistrationState" NOT NULL DEFAULT 'FORMING',
ADD COLUMN "roster_version" INTEGER NOT NULL DEFAULT 1;

-- Backfill existing team registration_state
UPDATE "teams" t
SET "registration_state" = 'CONFIRMED'
FROM "tournament_registrations" tr
WHERE tr."team_id" = t."id" AND tr."status" = 'CONFIRMED';

UPDATE "teams" t
SET "registration_state" = 'WAITLISTED'
FROM "tournament_registrations" tr
WHERE tr."team_id" = t."id" AND tr."status" = 'WAITLIST' AND t."registration_state" != 'CONFIRMED';
