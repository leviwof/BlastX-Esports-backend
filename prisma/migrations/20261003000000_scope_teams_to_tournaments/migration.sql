ALTER TABLE "teams"
ADD COLUMN "tournament_id" TEXT;

ALTER TABLE "teams"
ADD CONSTRAINT "teams_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "teams_tournament_id_idx" ON "teams"("tournament_id");
