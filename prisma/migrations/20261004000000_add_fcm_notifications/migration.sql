ALTER TABLE "users"
ADD COLUMN "fcm_token" TEXT,
ADD COLUMN "fcm_updated_at" TIMESTAMP(3),
ADD COLUMN "device_type" TEXT;

CREATE INDEX "users_fcm_token_idx" ON "users"("fcm_token");

ALTER TABLE "matches"
ADD COLUMN "reminder_sent_at" TIMESTAMP(3);

CREATE INDEX "matches_scheduled_reminder_idx"
ON "matches"("status", "scheduled_at", "reminder_sent_at");
