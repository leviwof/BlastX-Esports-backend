-- Segregates Free Fire Live tournaments from the primary BlastX catalogue.
-- Existing rows default to BLASTX to preserve their current visibility.
DO $$ BEGIN
  CREATE TYPE "TournamentSection" AS ENUM ('FREEFIRE_LIVE', 'BLASTX');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "tournaments"
  ADD COLUMN IF NOT EXISTS "section" "TournamentSection" NOT NULL DEFAULT 'BLASTX';

CREATE INDEX IF NOT EXISTS "tournaments_section_status_starts_at_idx"
  ON "tournaments"("section", "status", "starts_at");
