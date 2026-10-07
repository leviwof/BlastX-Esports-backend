CREATE TYPE "TournamentWaitlistStatus" AS ENUM ('WAITLISTED', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "tournament_waitlists" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "squad_id" TEXT NOT NULL,
    "position_in_queue" INTEGER NOT NULL,
    "status" "TournamentWaitlistStatus" NOT NULL DEFAULT 'WAITLISTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_waitlists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_waitlists_tournament_squad_key"
    ON "tournament_waitlists"("tournament_id", "squad_id");
CREATE INDEX "tournament_waitlists_queue_idx"
    ON "tournament_waitlists"("tournament_id", "status", "position_in_queue");
CREATE INDEX "tournament_waitlists_squad_idx"
    ON "tournament_waitlists"("squad_id");

ALTER TABLE "tournament_waitlists"
    ADD CONSTRAINT "tournament_waitlists_tournament_id_fkey"
    FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_waitlists"
    ADD CONSTRAINT "tournament_waitlists_squad_id_fkey"
    FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH linked_squads AS (
    SELECT
        t."tournament_id",
        t."persistent_squad_id" AS "squad_id",
        ROW_NUMBER() OVER (PARTITION BY t."tournament_id" ORDER BY t."created_at", t."id")::INTEGER AS "position_in_queue",
        COUNT(sm."id") FILTER (
            WHERE sm."roster_type" = 'MAIN' AND sm."role" <> 'MANAGER'
        ) AS "main_players_count",
        t."created_at"
    FROM "teams" t
    JOIN "tournaments" tour ON tour."id" = t."tournament_id" AND tour."status" = 'LIVE'
    LEFT JOIN "squad_members" sm ON sm."squad_id" = t."persistent_squad_id"
    WHERE t."persistent_squad_id" IS NOT NULL
    GROUP BY t."id", t."tournament_id", t."persistent_squad_id", t."created_at"
)
INSERT INTO "tournament_waitlists" (
    "id", "tournament_id", "squad_id", "position_in_queue", "status", "created_at"
)
SELECT
    'waitlist_' || "squad_id" || '_' || "tournament_id",
    "tournament_id",
    "squad_id",
    "position_in_queue",
    CASE WHEN "main_players_count" < 4 THEN 'WAITLISTED'::"TournamentWaitlistStatus"
         ELSE 'CONFIRMED'::"TournamentWaitlistStatus" END,
    "created_at"
FROM linked_squads
ON CONFLICT ("tournament_id", "squad_id") DO NOTHING;
