-- AlterTable
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "group_name" TEXT;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "room_id" TEXT;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "room_password" TEXT;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "room_released_at" TIMESTAMP(3);
