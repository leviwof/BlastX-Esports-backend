CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "profile_pic" TEXT,
  "google_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
CREATE TABLE "app_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "min_version" TEXT NOT NULL,
  "latest_version" TEXT NOT NULL,
  "is_maintenance" BOOLEAN NOT NULL DEFAULT false,
  "maintenance_message" TEXT NOT NULL,
  "update_url" TEXT NOT NULL,
  CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);
INSERT INTO "app_config" ("id", "min_version", "latest_version", "is_maintenance", "maintenance_message", "update_url")
VALUES (1, '1.0.0', '1.0.5', false, 'Server is under maintenance. Please try later.', 'https://play.google.com/store/apps/details?id=com.blastx.esports');
