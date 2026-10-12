-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADING', 'UPLOADED', 'FAILED', 'REJECTED');

-- AlterTable
ALTER TABLE "app_config" ADD COLUMN "recording_config" JSONB;

-- CreateTable
CREATE TABLE "match_recordings" (
    "id" TEXT NOT NULL,
    "client_recording_id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "team_id" TEXT,
    "user_id" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "match_id" TEXT,
    "group_id" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "storage_provider" TEXT,
    "storage_file_id" TEXT,
    "file_url" TEXT,
    "size_bytes" BIGINT,
    "uploaded_bytes" BIGINT NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "mime_type" TEXT,
    "resolution" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "stopped_at" TIMESTAMP(3) NOT NULL,
    "device_model" TEXT,
    "app_version" TEXT,
    "failure_reason" TEXT,
    "upload_session_expires_at" TIMESTAMP(3),
    "keep" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,

    CONSTRAINT "match_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "match_recordings_tournament_id_match_key_idx" ON "match_recordings"("tournament_id", "match_key");

-- CreateIndex
CREATE INDEX "match_recordings_tournament_id_status_idx" ON "match_recordings"("tournament_id", "status");

-- CreateIndex
CREATE INDEX "match_recordings_team_id_idx" ON "match_recordings"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_recordings_user_id_client_recording_id_key" ON "match_recordings"("user_id", "client_recording_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_recordings_user_id_match_key_key" ON "match_recordings"("user_id", "match_key");

-- AddForeignKey
ALTER TABLE "match_recordings" ADD CONSTRAINT "match_recordings_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_recordings" ADD CONSTRAINT "match_recordings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_recordings" ADD CONSTRAINT "match_recordings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
