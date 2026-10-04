CREATE TYPE "SquadRole" AS ENUM ('LEADER', 'MEMBER');
CREATE TYPE "SquadRosterType" AS ENUM ('MAIN', 'SUBSTITUTE');
CREATE TYPE "TournamentInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

CREATE TABLE "squads" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "tag" VARCHAR(10) NOT NULL DEFAULT '',
    "logo_url" VARCHAR(255),
    "leader_id" TEXT NOT NULL,
    "max_main_players" INTEGER NOT NULL DEFAULT 4,
    "max_substitutes" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "squads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "squad_members" (
    "id" TEXT NOT NULL,
    "squad_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "SquadRole" NOT NULL DEFAULT 'MEMBER',
    "roster_type" "SquadRosterType" NOT NULL DEFAULT 'MAIN',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "squad_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tournament_invitations" (
    "id" TEXT NOT NULL,
    "squad_id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "leader_id" TEXT NOT NULL,
    "invitee_user_id" TEXT NOT NULL,
    "status" "TournamentInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_invitations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "teams" ADD COLUMN "persistent_squad_id" TEXT;
DROP INDEX "teams_game_id_name_key";

CREATE UNIQUE INDEX "squads_game_leader_key" ON "squads"("game_id", "leader_id");
CREATE INDEX "squads_leader_id_idx" ON "squads"("leader_id");
CREATE UNIQUE INDEX "squad_members_user_id_key" ON "squad_members"("user_id");
CREATE UNIQUE INDEX "squad_members_squad_user_key" ON "squad_members"("squad_id", "user_id");
CREATE INDEX "squad_members_squad_id_roster_type_idx" ON "squad_members"("squad_id", "roster_type");
CREATE UNIQUE INDEX "tournament_invites_squad_tournament_user_key"
    ON "tournament_invitations"("squad_id", "tournament_id", "invitee_user_id");
CREATE INDEX "tournament_invitations_invitee_user_id_status_created_at_idx"
    ON "tournament_invitations"("invitee_user_id", "status", "created_at");
CREATE INDEX "tournament_invitations_tournament_id_status_idx"
    ON "tournament_invitations"("tournament_id", "status");
CREATE INDEX "teams_persistent_squad_id_idx" ON "teams"("persistent_squad_id");
CREATE UNIQUE INDEX "teams_game_id_tournament_id_name_key"
    ON "teams"("game_id", "tournament_id", "name");
CREATE UNIQUE INDEX "teams_tournament_id_persistent_squad_id_key"
    ON "teams"("tournament_id", "persistent_squad_id");

ALTER TABLE "squads"
    ADD CONSTRAINT "squads_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squads"
    ADD CONSTRAINT "squads_leader_id_fkey"
    FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "squad_members"
    ADD CONSTRAINT "squad_members_squad_id_fkey"
    FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "squad_members"
    ADD CONSTRAINT "squad_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_invitations"
    ADD CONSTRAINT "tournament_invitations_squad_id_fkey"
    FOREIGN KEY ("squad_id") REFERENCES "squads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_invitations"
    ADD CONSTRAINT "tournament_invitations_tournament_id_fkey"
    FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_invitations"
    ADD CONSTRAINT "tournament_invitations_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_invitations"
    ADD CONSTRAINT "tournament_invitations_leader_id_fkey"
    FOREIGN KEY ("leader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_invitations"
    ADD CONSTRAINT "tournament_invitations_invitee_user_id_fkey"
    FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams"
    ADD CONSTRAINT "teams_persistent_squad_id_fkey"
    FOREIGN KEY ("persistent_squad_id") REFERENCES "squads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
